"""
CardioEQ AI — Shared feature utilities (label-free)
=====================================================
This module previously held a clinician-label-calibrated risk model (v2):
a hand-weighted z-score composite, isotonic-regression-calibrated against
a hardcoded CLINICIAN_LABEL_OVERRIDES dict of 7 subjects, with bucket
thresholds and LOOCV validation all built on top of those labels.

That entire approach has been removed. Every clinical-label dependency in
this codebase — in training, validation, inference, confidence, threshold
generation, reports, explainability, graphs, database queries, feature
engineering, and every API — is gone. The pipeline is fully unsupervised
end to end: see `unsupervised_risk.py` (GMM clustering + Isolation Forest
anomaly detection, fit only on raw sensor-derived physiological features,
bucketed by data-driven percentile cutpoints over the cohort's own score
distribution). Nothing here or downstream reads a clinician-assigned label
to train, calibrate, threshold, or validate anything.

What's left in this module is the small set of label-free utilities the
unsupervised pipeline and population/percentile statistics still share:

  - FEATURE_COLS: the 9-column numeric feature set (physiology +
    demographics) used to build per-subject aggregates for population/
    percentile statistics. NOT used for risk clustering — the unsupervised
    model defines its own, narrower, physiology-only feature set for that
    (see unsupervised_risk.FEATURE_COLS).
  - LABEL_NAMES: display names for the 3 percentile-tertile buckets the
    unsupervised model sorts subjects into ("healthy" / "mild risk" /
    "moderate risk"). These name MODEL OUTPUT — a subject's bucket is
    decided purely by where its unsupervised composite score falls in the
    cohort's own distribution. No human-provided ground truth ever selects
    or influences a bucket; this dict only supplies human-readable text
    for whichever bucket the model already picked.
  - build_subject_table: aggregates window-level features to one row per
    subject (mean across all recorded activities). Carries no clinical
    "condition"/label column.
"""

import pandas as pd

FEATURE_COLS = [
    "heart_rate", "rr_interval_ms", "rmssd", "sdnn",
    "stress_index", "recovery_rate", "motion_intensity",
    "bmi", "age",
]

LABEL_NAMES = {0: "healthy", 1: "mild risk", 2: "moderate risk"}


def build_subject_table(windows: pd.DataFrame) -> pd.DataFrame:
    """Aggregate window-level features to one row per subject (mean across all activities)."""
    return windows.groupby("subject")[FEATURE_COLS].mean().reset_index()
