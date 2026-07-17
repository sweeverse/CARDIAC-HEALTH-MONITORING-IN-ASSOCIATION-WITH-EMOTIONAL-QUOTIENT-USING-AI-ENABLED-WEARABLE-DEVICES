"""
CardioEQ AI — Unsupervised Model Validation
==============================================
Internal-only validation for unsupervised_risk.py's GMM/IsolationForest
pipeline. Every metric here runs with ZERO knowledge of any clinical label
or `condition` — silhouette, Davies-Bouldin, bootstrap stability, and
subject homogeneity are all structural properties of the clustering
itself (internal validity measures), not accuracy against any ground
truth. There is no ground truth used anywhere in this module, by design.
"""

import numpy as np
import pandas as pd
from sklearn.metrics import silhouette_score, davies_bouldin_score

from app.ml_core.unsupervised_risk import (
    FEATURE_COLS, Z_COLS, activity_normalize, fit_unsupervised,
)


def cluster_quality(scored_windows: pd.DataFrame, models: dict) -> dict:
    """Silhouette + Davies-Bouldin on GMM hard assignments (argmax component)."""
    X = scored_windows[Z_COLS].fillna(0.0).to_numpy()
    Xs = models["scaler"].transform(X)
    hard_labels = models["gmm"].predict(Xs)

    if len(set(hard_labels)) < 2:
        return {"silhouette_score": None, "davies_bouldin_score": None,
                "note": "GMM collapsed to a single effective component — check n_components / data scale."}

    return {
        "silhouette_score": round(float(silhouette_score(Xs, hard_labels)), 4),
        "davies_bouldin_score": round(float(davies_bouldin_score(Xs, hard_labels)), 4),
        "n_effective_clusters": int(len(set(hard_labels))),
    }


def bootstrap_stability(windows: pd.DataFrame, n_iter: int = 50, sample_frac: float = 1.0,
                         random_state: int = 42) -> dict:
    """
    Resample windows with replacement, refit the full pipeline each time,
    and measure how often each window's hard cluster assignment flips
    relative to the original (full-data) fit. High flip rate = unstable
    clustering structure, not just noisy individual points.
    """
    rng = np.random.RandomState(random_state)

    windows_norm, _ = activity_normalize(windows)
    base_scored, _, base_models = fit_unsupervised(windows_norm)
    X_base = base_scored[Z_COLS].fillna(0.0).to_numpy()
    Xs_base = base_models["scaler"].transform(X_base)
    base_labels = base_models["gmm"].predict(Xs_base)

    n = len(windows_norm)
    flip_counts = np.zeros(n)
    seen_counts = np.zeros(n)

    for i in range(n_iter):
        sample_idx = rng.choice(n, size=int(n * sample_frac), replace=True)
        boot_df = windows_norm.iloc[sample_idx].reset_index(drop=True)
        try:
            boot_scored, _, boot_models = fit_unsupervised(boot_df)
        except Exception:
            continue
        Xs_boot = boot_models["scaler"].transform(boot_df[Z_COLS].fillna(0.0).to_numpy())
        boot_labels = boot_models["gmm"].predict(Xs_boot)

        # score EVERY original window under this bootstrap's fitted model,
        # compare hard assignment to the base fit's assignment for that window
        Xs_all_under_boot = boot_models["scaler"].transform(X_base)
        reassigned = boot_models["gmm"].predict(Xs_all_under_boot)
        # align cluster index labels between fits via majority overlap on the
        # bootstrap sample itself, before comparing
        mapping = _align_cluster_labels(boot_labels, base_labels[sample_idx])
        reassigned_aligned = np.array([mapping.get(c, c) for c in reassigned])

        flip_counts += (reassigned_aligned != base_labels)
        seen_counts += 1

    seen_counts = np.where(seen_counts == 0, 1, seen_counts)
    flip_rate_per_window = flip_counts / seen_counts
    return {
        "n_bootstrap_iters": n_iter,
        "mean_flip_rate": round(float(flip_rate_per_window.mean()), 4),
        "median_flip_rate": round(float(np.median(flip_rate_per_window)), 4),
        "pct_windows_over_25pct_flip": round(float((flip_rate_per_window > 0.25).mean() * 100), 1),
    }


def _align_cluster_labels(labels_a, labels_b):
    """Best-effort mapping from cluster indices in fit A to the closest-matching indices in fit B,
    via majority vote of co-occurring points (labels_a and labels_b must be same length/order)."""
    mapping = {}
    for cluster in set(labels_a):
        mask = labels_a == cluster
        if mask.sum() == 0:
            continue
        counts = np.bincount(labels_b[mask])
        mapping[cluster] = int(np.argmax(counts))
    return mapping


def subject_homogeneity(scored_windows: pd.DataFrame) -> list[dict]:
    """
    Per-subject spread of risk_score across their own windows. Sanity
    check, not an accuracy metric: a subject whose windows scatter wildly
    across the risk spectrum suggests noisy input data or an activity-
    normalization gap, not necessarily a modeling error.
    """
    out = []
    for subject, grp in scored_windows.groupby("subject"):
        scores = grp["risk_score"]
        out.append({
            "subject": subject,
            "n_windows": int(len(grp)),
            "mean": round(float(scores.mean()), 1),
            "std": round(float(scores.std()) if len(grp) > 1 else 0.0, 1),
            "iqr": round(float(scores.quantile(0.75) - scores.quantile(0.25)), 1),
            "min": round(float(scores.min()), 1),
            "max": round(float(scores.max()), 1),
        })
    out.sort(key=lambda r: -r["std"])
    return out


def run_validation(windows: pd.DataFrame, scored_windows: pd.DataFrame, models: dict,
                    n_bootstrap: int = 50) -> dict:
    """Top-level orchestrator — produces the full unsupervised_model_report.json payload."""
    quality = cluster_quality(scored_windows, models)
    stability = bootstrap_stability(windows, n_iter=n_bootstrap)
    homogeneity = subject_homogeneity(scored_windows)

    return {
        "model": "gmm_isolation_forest_unsupervised",
        "cluster_quality": quality,
        "bootstrap_stability": stability,
        "subject_homogeneity": homogeneity,
        "note": (
            "All metrics above are internal validity measures computed "
            "without any reference to clinical labels or ground truth — "
            "there is none in this pipeline, by design."
        ),
    }
