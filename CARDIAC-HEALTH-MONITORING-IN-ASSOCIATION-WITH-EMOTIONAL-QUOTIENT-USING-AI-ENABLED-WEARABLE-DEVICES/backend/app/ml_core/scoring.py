"""
CardioEQ AI — Heart Health Score & Population Benchmarking
=============================================================
Two things happen here:

1. HEART HEALTH SCORE (0-100, per time-window)
   An explainable, additive score — not a black box. Each biomarker
   contributes a signed amount based on how far it deviates from a
   healthy reference range, weighted by clinical relevance. The window's
   contribution breakdown IS the explanation: "RMSSD was 18ms below your
   healthy baseline, costing -9 points" is something a clinician (or the
   AI assistant) can say plainly.

   This is blended 70/30 with the subject-level calibrated risk probability
   (from risk_model.py) so the per-window score reflects both
   moment-to-moment physiology AND the cohort-level risk classification.

2. POPULATION BENCHMARKING
   For every subject, we compute percentile rank against:
     - the full cohort
     - a similar-profile cohort (±5 years age, ±5 BMI points)
   stored per feature, so the dashboard can render "you are in the 73rd
   percentile for RMSSD among similar-profile peers."
"""

import json
import numpy as np
import pandas as pd
from pathlib import Path

# Fallback reference ranges (generic clinical literature — used only if the
# cohort doesn't have enough healthy-labeled subjects to derive empirical ranges)
DEFAULT_REFERENCE_RANGES = {
    "heart_rate":   {"healthy_low": 60,  "healthy_high": 100, "weight": 22, "direction": "range"},
    "rmssd":        {"healthy_low": 20,  "healthy_high": 80,  "weight": 20, "direction": "min"},
    "sdnn":         {"healthy_low": 30,  "healthy_high": 100, "weight": 16, "direction": "min"},
    "stress_index": {"healthy_low": 0,   "healthy_high": 45,  "weight": 18, "direction": "max"},
    "spo2":         {"healthy_low": 95,  "healthy_high": 100, "weight": 12, "direction": "min"},
    "recovery_rate":{"healthy_low": 0,   "healthy_high": 1.5, "weight": 12, "direction": "min"},
}

# kept for backwards-compat imports
REFERENCE_RANGES = DEFAULT_REFERENCE_RANGES


def derive_reference_ranges(windows: pd.DataFrame, healthy_mask: pd.Series, min_healthy_subjects: int = 2) -> dict:
    """
    Build the 'healthy band' for each biomarker FROM THIS COHORT's own
    lowest-anomaly windows (p15-p85 of their window-level values), rather
    than generic clinical-literature thresholds OR clinician labels.

    `healthy_mask` is a boolean Series, same index as `windows`, marking
    which windows the UNSUPERVISED model itself scored into the "healthy"
    risk bucket (risk_score below the model's own mild-risk threshold —
    see unsupervised_risk.train_unsupervised's bucket_thresholds). This
    replaces the old `condition == "healthy"` clinician-label lookup
    entirely: the Heart Health Score's reference band is now defined by
    the SAME anomaly model that drives risk classification, not by a
    separate 7-subject label dict. Falls back to DEFAULT_REFERENCE_RANGES
    per-feature if too few unsupervised-healthy windows are available to
    derive a stable band.

    (PPG-based beat detection - simple threshold crossing, not a tuned
    R-peak detector - produces systematically different HRV magnitudes
    than clinical ECG, which is why a cohort-derived band beats a
    generic textbook one here in the first place.)
    """
    mask = healthy_mask.reindex(windows.index, fill_value=False)
    healthy = windows[mask]
    n_healthy_subjects = healthy["subject"].nunique()

    ranges = {}
    for feature, default in DEFAULT_REFERENCE_RANGES.items():
        ranges[feature] = dict(default)  # start from fallback
        if n_healthy_subjects >= min_healthy_subjects and feature in healthy.columns:
            vals = healthy[feature].dropna()
            if len(vals) >= 10:
                lo, hi = vals.quantile(0.15), vals.quantile(0.85)
                if hi > lo:
                    ranges[feature]["healthy_low"] = round(float(lo), 2)
                    ranges[feature]["healthy_high"] = round(float(hi), 2)
                    ranges[feature]["derived_from_n_subjects"] = int(n_healthy_subjects)
                    ranges[feature]["source"] = "cohort_empirical_unsupervised"
                    continue
        ranges[feature]["source"] = "clinical_default_fallback"

    return ranges


def _component_score(feature, value, ref):
    """Returns (points 0-100 scaled to weight, explanation string)."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None, None

    lo, hi, w = ref["healthy_low"], ref["healthy_high"], ref["weight"]
    direction = ref["direction"]

    if direction == "range":
        if lo <= value <= hi:
            frac = 1.0
        else:
            dist = (lo - value) if value < lo else (value - hi)
            span = max(hi - lo, 1)
            frac = max(0.0, 1 - dist / span)
    elif direction == "min":  # higher is better, hi is the "great" ceiling
        if feature == "recovery_rate" and value <= 0:
            # Recovery Rate is only a meaningful signal right after exertion.
            # A near-zero or negative reading during rest/sit sessions is
            # expected (there's nothing to recover from) — NOT a sign of poor
            # cardiac adaptability, so it must not be scored as the worst
            # case (which previously zeroed out points_awarded, producing
            # both an empty bar and a misleading full point penalty).
            frac = 1.0
        else:
            frac = np.clip(value / hi, 0, 1) if hi else 0
    elif direction == "max":  # lower is better
        frac = np.clip(1 - (value / hi), 0, 1) if hi else 1
    else:
        frac = 0.5

    points = round(frac * w, 2)
    delta = points - w  # negative = cost
    explanation = {
        "feature": feature,
        "value": round(float(value), 2),
        "healthy_range": f"{lo}-{hi}",
        "points_awarded": points,
        "max_points": w,
        "impact": round(delta, 2),
    }
    return points, explanation


def compute_window_score(window_row: dict, subject_risk_probabilities: dict, reference_ranges: dict = None):
    reference_ranges = reference_ranges or DEFAULT_REFERENCE_RANGES
    total_points = 0.0
    total_weight = 0.0
    breakdown = []

    for feature, ref in reference_ranges.items():
        val = window_row.get(feature)
        pts, expl = _component_score(feature, val, ref)
        if pts is not None:
            total_points += pts
            total_weight += ref["weight"]
            breakdown.append(expl)

    physiology_score = (total_points / total_weight * 100) if total_weight > 0 else 50.0

    # Blend with subject-level calibrated risk prediction: moderate/mild risk subjects get
    # the cohort-level signal folded in, so a single "good" window doesn't
    # fully mask a subject-level risk pattern.
    risk_penalty = (
        subject_risk_probabilities.get("mild risk", 0) * 12
        + subject_risk_probabilities.get("moderate risk", 0) * 28
    )
    final_score = np.clip(physiology_score - risk_penalty * 0.3, 0, 100)

    breakdown.sort(key=lambda d: d["impact"])  # worst offenders first

    return round(float(final_score), 1), breakdown


def compute_population_stats(subject_table: pd.DataFrame, feature_cols: list[str]) -> dict:
    """Percentile lookup tables, plus similar-profile cohort membership per subject."""
    stats = {"cohort_size": len(subject_table), "features": {}}

    for f in feature_cols:
        vals = subject_table[f].dropna()
        if len(vals) == 0:
            continue
        stats["features"][f] = {
            "mean": round(float(vals.mean()), 2),
            "std": round(float(vals.std()), 2),
            "p10": round(float(vals.quantile(0.10)), 2),
            "p25": round(float(vals.quantile(0.25)), 2),
            "p50": round(float(vals.quantile(0.50)), 2),
            "p75": round(float(vals.quantile(0.75)), 2),
            "p90": round(float(vals.quantile(0.90)), 2),
        }

    return stats


def derive_reference_ranges_by_activity(windows: pd.DataFrame, healthy_mask: pd.Series, min_healthy_subjects: int = 2) -> dict:
    """
    Same idea as derive_reference_ranges, but stratified per activity —
    'sit' and 'run' baselines are physiologically different (e.g. resting
    heart rate vs. exertion heart rate), so a single pooled healthy band
    unfairly penalizes/flatters subjects depending on which activity
    they're being compared against. Falls back to the pooled
    (activity-agnostic) range for any activity with too few unsupervised-
    healthy windows to derive a stable band of its own. `healthy_mask` is
    the same unsupervised healthy-bucket mask used by derive_reference_ranges —
    no clinician labels involved here either.
    """
    pooled = derive_reference_ranges(windows, healthy_mask, min_healthy_subjects)
    by_activity = {}
    for activity, awin in windows.groupby("activity"):
        by_activity[activity] = derive_reference_ranges(awin, healthy_mask, min_healthy_subjects)
        # any feature that fell back to the clinical default here (too few
        # unsupervised-healthy windows for THIS activity) uses the pooled
        # cohort-empirical range instead, if the pooled one managed to derive one.
        for feat, ref in by_activity[activity].items():
            if ref.get("source") == "clinical_default_fallback" and pooled.get(feat, {}).get("source") == "cohort_empirical_unsupervised":
                by_activity[activity][feat] = dict(pooled[feat])
                by_activity[activity][feat]["source"] = "cohort_empirical_unsupervised_pooled_fallback"
    return by_activity


def inter_intra_subject_variability(windows: pd.DataFrame, feature_cols: list[str]) -> dict:
    """
    Decomposes variability in each biomarker into:
      - inter-subject: how much subjects differ from ONE ANOTHER on average
        (std of each subject's own mean, across subjects)
      - intra-subject: how much a given subject's own readings bounce
        around WITHIN themselves across windows/sessions (mean of each
        subject's own coefficient of variation)
    A feature with high inter/low intra is a good discriminator between
    people; high intra relative to inter means within-subject noise
    dominates and the feature is less trustworthy for single-session
    comparisons against cohort norms.
    """
    results = {}
    for feat in feature_cols:
        if feat not in windows.columns:
            continue
        subj_means = windows.groupby("subject")[feat].mean().dropna()
        if len(subj_means) < 2:
            continue
        inter_mean = float(subj_means.mean())
        inter_std = float(subj_means.std())
        inter_cv = round(inter_std / inter_mean, 3) if inter_mean else None

        intra_cvs = []
        for _, g in windows.groupby("subject")[feat]:
            vals = g.dropna()
            if len(vals) >= 3 and vals.mean() != 0:
                intra_cvs.append(vals.std() / abs(vals.mean()))
        intra_cv = round(float(np.mean(intra_cvs)), 3) if intra_cvs else None

        results[feat] = {
            "inter_subject_cv": inter_cv,
            "intra_subject_cv": intra_cv,
            "inter_subject_mean": round(inter_mean, 2),
            "inter_subject_std": round(inter_std, 2),
            "n_subjects": int(len(subj_means)),
            "dominant_source": (
                "between-subject differences" if (inter_cv or 0) > (intra_cv or 0)
                else "within-subject noise"
            ) if inter_cv is not None and intra_cv is not None else None,
        }
    return results


def cognitive_load_index(sub_windows: pd.DataFrame) -> dict | None:
    """
    Cognitive load proxy: the physiological delta between a cognitive-task
    session and this same subject's sitting (rest) baseline. A positive
    heart_rate/stress delta with a negative rmssd delta indicates measurable
    sympathetic activation attributable to cognitive load rather than
    physical exertion (both are seated activities, so motion is controlled for).
    """
    cog = sub_windows[sub_windows["activity"] == "cog"]
    sit = sub_windows[sub_windows["activity"] == "sit"]
    if cog.empty or sit.empty:
        return None

    def _delta(feat):
        c, s = cog[feat].mean(), sit[feat].mean()
        if pd.isna(c) or pd.isna(s):
            return None
        return round(float(c - s), 2)

    hr_delta = _delta("heart_rate")
    stress_delta = _delta("stress_index")
    rmssd_delta = _delta("rmssd")
    if hr_delta is None and stress_delta is None and rmssd_delta is None:
        return None

    # A simple composite: positive HR/stress deltas and negative RMSSD delta
    # all point the same direction (more load), so sum their normalized signs
    # weighted by magnitude rather than just counting directions.
    load_signal = 0.0
    parts = 0
    if hr_delta is not None:
        load_signal += np.clip(hr_delta / 10, -1, 1)
        parts += 1
    if stress_delta is not None:
        load_signal += np.clip(stress_delta / 20, -1, 1)
        parts += 1
    if rmssd_delta is not None:
        load_signal += np.clip(-rmssd_delta / 10, -1, 1)
        parts += 1
    composite = round(float(50 + (load_signal / parts) * 50), 1) if parts else None

    return {
        "heart_rate_delta_bpm": hr_delta,
        "stress_index_delta": stress_delta,
        "rmssd_delta_ms": rmssd_delta,
        "cognitive_load_index": composite,
        "interpretation": (
            "Elevated cognitive load signature (HR/stress up, HRV down vs. sitting baseline)"
            if composite is not None and composite > 60 else
            "Minimal measurable cognitive load vs. sitting baseline"
            if composite is not None and composite < 40 else
            "Mixed/inconclusive signal vs. sitting baseline"
        ) if composite is not None else None,
    }


def percentile_rank(value, series: pd.Series) -> float:
    series = series.dropna()
    if len(series) == 0 or value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    return round(float((series < value).mean() * 100), 1)


def similar_cohort(subject_table: pd.DataFrame, subject_row, age_tol=5, bmi_tol=5) -> pd.DataFrame:
    return subject_table[
        (subject_table["subject"] != subject_row["subject"])
        & (subject_table["age"].sub(subject_row["age"]).abs() <= age_tol)
        & (subject_table["bmi"].sub(subject_row["bmi"]).abs() <= bmi_tol)
    ]
