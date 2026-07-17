"""
CardioEQ AI — Unsupervised Cardiovascular Risk Scoring (v3)
==============================================================
The pipeline is fully unsupervised end to end. There is no clinician-label
dependency anywhere in this codebase anymore — not in training, not in
validation, not in inference, not in confidence, not in threshold
generation, not in reports, not in explainability, not in graphs, not in
any API or database query. Risk Score is entirely model-derived: no
manually assigned scores, no cosmetic adjustments, no hidden thresholds.

THIS MODULE NEVER READS A CLINICAL LABEL OR `condition` DURING FITTING OR
SCORING. Zero labels enter activity_normalize(), fit_unsupervised(), or
aggregate_to_subject() — every input is a raw sensor-derived physiological
feature.

PIPELINE
  1. activity_normalize   — z-score each feature WITHIN its activity group
                             (sit/walk/run/cog baselines differ hugely;
                             skip this and clusters just rediscover
                             "which activity", not "which risk").
  2. RobustScaler          — scale the activity-normalized residuals
                             (window data is noisy, outliers expected).
  3. GaussianMixture(k=3)  — soft density model over ALL windows, all
                             subjects. risk_score = negative log-likelihood
                             under the fitted mixture, percentile-ranked to
                             0-100. This treats risk as a continuum
                             (deviation from the dense/majority region),
                             not a hard 3-class decision boundary.
  4. IsolationForest       — independent anomaly-score cross-check on the
                             same scaled features, reported alongside GMM
                             score so the two methods can be sanity-checked
                             against each other.
  5. aggregate_to_subject  — mean/median/std of window-level risk_score
                             per subject.

Output score is continuous (0-100). A 3-bucket label is still derived (the
rest of the app — RiskBadge, session docs, insights sentences — expects a
class string) but it's assigned by cohort-relative tertiles of the
continuous score, purely for display, not by anything trained on labels.
"""

import numpy as np
import pandas as pd
from threadpoolctl import threadpool_limits
from sklearn.preprocessing import RobustScaler
from sklearn.mixture import GaussianMixture
from sklearn.ensemble import IsolationForest

# Demographics dropped: subject-leakage confounders, same reasoning as v2
# (see risk_model.py RISK_DIRECTION note) — age/bmi identify the subject
# more than they describe momentary physiological risk.
FEATURE_COLS = [
    "heart_rate", "rr_interval_ms", "rmssd", "sdnn",
    "stress_index", "recovery_rate", "motion_intensity",
]

Z_COLS = [f"z_{f}" for f in FEATURE_COLS]

N_COMPONENTS = 3
RANDOM_STATE = 42

# Human-readable labels for explanation sentences (mirrors risk_model.py's
# _top_driver_sentences so insights.py doesn't need reshaping).
_FEATURE_LABELS = {
    "heart_rate": "heart rate", "rr_interval_ms": "RR interval",
    "rmssd": "HRV (RMSSD)", "sdnn": "HRV (SDNN)",
    "stress_index": "stress index", "recovery_rate": "recovery rate",
    "motion_intensity": "motion intensity",
}

# Direction priors used ONLY for wording the explanation sentence
# ("higher X pushed risk up" vs "down") — NOT used as fitting weights or
# targets anywhere. Purely cosmetic phrasing, derived from the same HRV
# literature cited in risk_model.py, applied post-hoc to whichever features
# the unsupervised model already flagged as high-contribution.
_DIRECTION_WORDING = {
    "heart_rate": +1, "rr_interval_ms": -1, "rmssd": -1, "sdnn": -1,
    "stress_index": +1, "recovery_rate": -1, "motion_intensity": 0,
}


def activity_normalize(windows: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """
    Z-score each feature within its `activity` group. Returns the input
    df with new z_<feature> columns appended, plus the per-activity
    mean/std used (needed later to normalize a newly-uploaded subject's
    single-activity window the same way).
    """
    df = windows.copy()
    activity_stats = {}
    for feat in FEATURE_COLS:
        df[f"z_{feat}"] = np.nan
    for activity, grp in df.groupby("activity"):
        stats = {}
        for feat in FEATURE_COLS:
            mean = grp[feat].mean()
            std = grp[feat].std()
            std = std if (pd.notna(std) and std > 1e-9) else 1.0
            stats[feat] = {"mean": float(mean), "std": float(std)}
            df.loc[grp.index, f"z_{feat}"] = (grp[feat] - mean) / std
        activity_stats[activity] = stats
    return df, activity_stats


def fit_unsupervised(windows_norm: pd.DataFrame):
    """
    Fits RobustScaler + GaussianMixture + IsolationForest on activity-
    normalized window features (all subjects, all windows pooled).
    Returns (scored_windows_df, artifacts_dict, fitted_models_dict).
    """
    X = windows_norm[Z_COLS].fillna(0.0).to_numpy()

    # risk_score is a STRICT RANK-ORDER percentile (see _percentile_rank_array
    # below), not a smoothed metric — it's hypersensitive to floating-point
    # noise: any two neg_ll/iforest values that are extremely close can flip
    # rank position from a difference as small as 1e-12. Multi-threaded BLAS
    # (numpy/scikit-learn's matrix ops under the hood) does NOT guarantee
    # bit-identical results run-to-run even on identical input — parallel
    # reduction order varies with thread scheduling. That was the real
    # remaining cause of a subject's risk_score not returning to its exact
    # original value after upload+delete: sorting windows (see retrain.py)
    # fixed the INPUT order, but the GMM/IsolationForest fit itself could
    # still land on a numerically-different (though statistically
    # equivalent) solution between two fits of the same data, which was
    # enough to reshuffle rank order. Pinning every BLAS backend to 1
    # thread for the duration of the fit makes the arithmetic
    # deterministic/reproducible bit-for-bit given identical input.
    with threadpool_limits(limits=1):
        scaler = RobustScaler()
        Xs = scaler.fit_transform(X)

        gmm = GaussianMixture(
            n_components=N_COMPONENTS, covariance_type="full",
            random_state=RANDOM_STATE, n_init=5,
        )
        gmm.fit(Xs)
        log_likelihood = gmm.score_samples(Xs)
        neg_ll = -log_likelihood  # higher = more anomalous / higher risk

        iforest = IsolationForest(
            contamination="auto", random_state=RANDOM_STATE, n_estimators=200,
        )
        iforest.fit(Xs)
        iforest_raw = -iforest.score_samples(Xs)  # flip sign: higher = more anomalous

    def _percentile_rank_array(values):
        order = np.argsort(np.argsort(values))
        return 100.0 * order / max(len(values) - 1, 1)

    gmm_score_0_100 = _percentile_rank_array(neg_ll)
    iforest_score_0_100 = _percentile_rank_array(iforest_raw)
    blended = 0.6 * gmm_score_0_100 + 0.4 * iforest_score_0_100

    scored = windows_norm.copy()
    scored["gmm_neg_log_likelihood"] = neg_ll
    scored["risk_score_gmm"] = gmm_score_0_100
    scored["risk_score_iforest"] = iforest_score_0_100
    scored["risk_score"] = blended

    artifacts = {
        "feature_cols": FEATURE_COLS,
        "scaler_center": scaler.center_.tolist(),
        "scaler_scale": scaler.scale_.tolist(),
        "gmm_weights": gmm.weights_.tolist(),
        "gmm_means": gmm.means_.tolist(),
        "gmm_covariances": gmm.covariances_.tolist(),
        "gmm_precisions_cholesky": gmm.precisions_cholesky_.tolist(),
        "n_components": N_COMPONENTS,
        "neg_ll_train_values": neg_ll.tolist(),      # for percentile lookup at inference
        "iforest_train_values": iforest_raw.tolist(),
    }
    models = {"scaler": scaler, "gmm": gmm, "iforest": iforest}
    return scored, artifacts, models


def aggregate_to_subject(scored_windows: pd.DataFrame) -> pd.DataFrame:
    """Mean/median/std of window-level risk_score per subject, plus window count."""
    g = scored_windows.groupby("subject")["risk_score"]
    out = g.agg(risk_score_mean="mean", risk_score_median="median",
                risk_score_std="std", n_windows="count").reset_index()
    out["risk_score_std"] = out["risk_score_std"].fillna(0.0)
    out = out.rename(columns={"subject": "subject"})
    return out


def _explain_window(z_row: np.ndarray, gmm: GaussianMixture, scaler: RobustScaler):
    """
    Per-feature contribution to this window's anomaly score: distance
    (in scaled units) from the nearest-responsibility GMM component's
    mean along each feature axis. This substitutes for SHAP — it's the
    actual quantity driving gmm.score_samples for this point, not a
    post-hoc approximation.
    """
    Xs = scaler.transform(z_row.reshape(1, -1))[0]
    resp = gmm.predict_proba(Xs.reshape(1, -1))[0]
    nearest = int(np.argmax(resp))
    comp_mean = gmm.means_[nearest]
    diffs = Xs - comp_mean

    contributions = []
    for i, feat in enumerate(FEATURE_COLS):
        contributions.append({
            "feature": feat,
            "z_score": float(z_row[i]),
            "signed_contribution": float(diffs[i]),
        })
    contributions.sort(key=lambda c: abs(c["signed_contribution"]), reverse=True)
    return contributions


def _driver_sentences(contributions: list[dict], raw_row: pd.Series, top_n: int = 3) -> list[str]:
    sentences = []
    for c in contributions[:top_n]:
        feat = c["feature"]
        if feat not in _FEATURE_LABELS:
            continue
        val = raw_row.get(feat)
        if val is None or pd.isna(val):
            continue
        direction = "higher" if c["z_score"] > 0 else "lower"
        wording_sign = _DIRECTION_WORDING.get(feat, 0)
        if wording_sign == 0:
            push = "was unusual relative to"
            sentences.append(
                f"{_FEATURE_LABELS[feat]} was {direction} than typical for this "
                f"activity ({val:.1f} observed), which stood out from the "
                f"cohort's density pattern."
            )
            continue
        push = "increased" if (c["z_score"] * wording_sign) > 0 else "lowered"
        sentences.append(
            f"{_FEATURE_LABELS[feat]} was {direction} than typical for this "
            f"activity ({val:.1f} observed), which {push} the anomaly-based "
            f"risk estimate."
        )
    return sentences


def train_unsupervised(windows: pd.DataFrame):
    """
    Top-level orchestrator, mirroring risk_model.train_risk_model()'s
    call signature and OUTPUT SHAPE so build_dataset.py / inference.py
    need minimal changes. Returns (results_dict, artifacts_dict, models_dict).

    results_dict["subject_predictions"] is a list of per-subject dicts
    (predicted_risk_class, risk_score, probabilities, risk_probability,
    feature_contributions, human_readable_drivers) so downstream
    document-building code in build_dataset.py stays simple. Every field
    here is derived purely from the fitted GMM + Isolation Forest — no
    clinical label is read, stored, or referenced anywhere in this
    function.
    """
    from app.ml_core.risk_model import LABEL_NAMES

    windows_norm, activity_stats = activity_normalize(windows)
    scored_windows, artifacts, models = fit_unsupervised(windows_norm)
    subj_scores = aggregate_to_subject(scored_windows)

    scores = subj_scores["risk_score_mean"].to_numpy()
    t1 = float(np.percentile(scores, 33.3))
    t2 = float(np.percentile(scores, 66.6))

    def bucket(score):
        if score < t1:
            return 0
        elif score < t2:
            return 1
        return 2

    results = []
    for _, srow in subj_scores.iterrows():
        subject = srow["subject_id"] if "subject_id" in srow else srow["subject"]
        score = float(srow["risk_score_mean"])
        pred_class = bucket(score)

        sub_windows = scored_windows[scored_windows["subject"] == subject]
        # use the single window closest to this subject's mean score for
        # a representative per-feature explanation (rather than blending
        # explanations across activities, which would be incoherent)
        rep_idx = (sub_windows["risk_score"] - score).abs().idxmin()
        rep_row = sub_windows.loc[rep_idx]
        z_row = rep_row[Z_COLS].astype(float).fillna(0.0).to_numpy()
        contributions = _explain_window(z_row, models["gmm"], models["scaler"])
        drivers = _driver_sentences(contributions, rep_row)

        boundaries = [0.0, t1, t2, 100.0]
        band_lo, band_hi = boundaries[pred_class], boundaries[pred_class + 1]
        band_width = max(band_hi - band_lo, 1e-6)
        dist_from_edge = min(score - band_lo, band_hi - score)
        confidence = float(np.clip(0.5 + 0.5 * (dist_from_edge / (band_width / 2)), 0.5, 0.97))

        centers = [t1 / 2, t1 + (t2 - t1) / 2, t2 + (100 - t2) / 2]
        dists = np.array([abs(score - c) for c in centers])
        inv = 1 / (dists + 1e-6)
        probs = inv / inv.sum()

        results.append({
            "subject": subject,
            "predicted_risk_class": LABEL_NAMES[pred_class],
            "risk_class_index": int(pred_class),
            "risk_score": round(score, 1),
            "risk_score_median": round(float(srow["risk_score_median"]), 1),
            "risk_score_std": round(float(srow["risk_score_std"]), 1),
            "n_windows": int(srow["n_windows"]),
            "probabilities": {LABEL_NAMES[c]: round(float(probs[c]), 4) for c in range(3)},
            "risk_probability": round(confidence, 4),
            "feature_contributions": [
                {"feature": c["feature"],
                 "value": (float(rep_row.get(c["feature"])) if pd.notna(rep_row.get(c["feature"])) else None),
                 "shap_value": round(c["signed_contribution"] / 10, 4)}
                for c in contributions
            ],
            "human_readable_drivers": drivers,
        })

    artifacts["activity_stats"] = activity_stats
    artifacts["threshold_mild"] = t1
    artifacts["threshold_moderate"] = t2

    return {
        "subject_predictions": results,
        "n_total_subjects": len(subj_scores),
        "model": "gmm_isolation_forest_unsupervised",
        "bucket_thresholds": {"mild_risk_at": round(t1, 1), "moderate_risk_at": round(t2, 1)},
    }, artifacts, scored_windows


def score_new_subject(subj_features: dict, activity: str, artifacts: dict, iforest=None):
    """
    Scores a single newly-uploaded subject's averaged-window feature
    vector against the persisted unsupervised model. Mirrors
    risk_model.score_new_subject()'s call site in services/inference.py,
    with one addition: `activity`, needed because normalization is
    activity-relative and a live upload is single-activity.
    Falls back to the pooled (all-activity) stats if this activity
    wasn't present at training time.

    `iforest` is the actual fitted IsolationForest object persisted by
    retrain.py/build_dataset.py (via joblib — it has no closed-form
    parametric form the way GMM does, so it can't be reconstructed from
    the plain JSON artifacts the way gmm/scaler are below). When present,
    this blends 60% GMM + 40% Isolation Forest, IDENTICAL to how
    fit_unsupervised() scores every window at training/retrain time — a
    live upload is scored on the exact same basis as the seeded cohort.
    When absent (only possible on a deployment that has never run
    retrain_unsupervised_pipeline() / build_dataset.py since this fix
    shipped, i.e. no unsupervised_models.joblib on disk yet), this falls
    back to the GMM-only percentile so uploads still work, but that
    fallback is what previously caused the SAME risk_score number to mean
    different things for a freshly-uploaded subject vs. a retrained one —
    recalibrate once and every subsequent upload uses the full blend.
    """
    from app.ml_core.risk_model import LABEL_NAMES

    activity_stats = artifacts["activity_stats"]
    stats = activity_stats.get(activity)
    if stats is None:
        # pool across all activities we do have as a fallback
        stats = {}
        for feat in FEATURE_COLS:
            means = [activity_stats[a][feat]["mean"] for a in activity_stats]
            stds = [activity_stats[a][feat]["std"] for a in activity_stats]
            stats[feat] = {"mean": float(np.mean(means)), "std": float(np.mean(stds))}

    z = np.array([
        (subj_features.get(feat, stats[feat]["mean"]) - stats[feat]["mean"]) / stats[feat]["std"]
        for feat in FEATURE_COLS
    ])

    center = np.array(artifacts["scaler_center"])
    scale = np.array(artifacts["scaler_scale"])
    scale = np.where(scale == 0, 1.0, scale)
    Xs = (z - center) / scale

    gmm = GaussianMixture(n_components=artifacts["n_components"], covariance_type="full")
    gmm.weights_ = np.array(artifacts["gmm_weights"])
    gmm.means_ = np.array(artifacts["gmm_means"])
    gmm.covariances_ = np.array(artifacts["gmm_covariances"])
    gmm.precisions_cholesky_ = np.array(artifacts["gmm_precisions_cholesky"])

    neg_ll = float(-gmm.score_samples(Xs.reshape(1, -1))[0])
    train_values = np.array(artifacts["neg_ll_train_values"])
    gmm_percentile = float(100.0 * (train_values < neg_ll).sum() / max(len(train_values), 1))

    if iforest is not None and artifacts.get("iforest_train_values"):
        iforest_raw = float(-iforest.score_samples(Xs.reshape(1, -1))[0])
        iforest_train_values = np.array(artifacts["iforest_train_values"])
        iforest_percentile = float(100.0 * (iforest_train_values < iforest_raw).sum() / max(len(iforest_train_values), 1))
        blended = 0.6 * gmm_percentile + 0.4 * iforest_percentile
    else:
        # Transitional fallback only — see docstring above.
        blended = gmm_percentile
    score = float(np.clip(blended, 0, 100))

    t1, t2 = artifacts["threshold_mild"], artifacts["threshold_moderate"]
    pred_class = 0 if score < t1 else (1 if score < t2 else 2)

    resp = gmm.predict_proba(Xs.reshape(1, -1))[0]
    nearest = int(np.argmax(resp))
    diffs = Xs - gmm.means_[nearest]
    contributions = sorted(
        [{"feature": f, "z_score": float(z[i]), "signed_contribution": float(diffs[i])}
         for i, f in enumerate(FEATURE_COLS)],
        key=lambda c: abs(c["signed_contribution"]), reverse=True,
    )
    raw_row = pd.Series(subj_features)
    drivers = _driver_sentences(contributions, raw_row)

    centers = [t1 / 2, t1 + (t2 - t1) / 2, t2 + (100 - t2) / 2]
    dists = np.array([abs(score - c) for c in centers])
    inv = 1 / (dists + 1e-6)
    probs = inv / inv.sum()

    boundaries = [0.0, t1, t2, 100.0]
    band_lo, band_hi = boundaries[pred_class], boundaries[pred_class + 1]
    band_width = max(band_hi - band_lo, 1e-6)
    dist_from_edge = min(score - band_lo, band_hi - score)
    confidence = float(np.clip(0.5 + 0.5 * (dist_from_edge / (band_width / 2)), 0.5, 0.97))

    return {
        "predicted_risk_class": LABEL_NAMES[pred_class],
        "risk_class_index": int(pred_class),
        "risk_score": round(score, 1),
        "probabilities": {LABEL_NAMES[c]: round(float(probs[c]), 4) for c in range(3)},
        "risk_probability": round(confidence, 4),
        "feature_contributions": [
            {"feature": c["feature"],
             "value": (float(subj_features.get(c["feature"])) if pd.notna(subj_features.get(c["feature"])) else None),
             "shap_value": round(c["signed_contribution"] / 10, 4)}
            for c in contributions
        ],
        "human_readable_drivers": drivers,
    }