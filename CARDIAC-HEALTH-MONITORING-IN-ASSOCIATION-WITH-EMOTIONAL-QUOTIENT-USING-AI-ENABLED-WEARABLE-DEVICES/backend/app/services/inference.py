"""
Live inference for newly uploaded subjects.

Reuses the exact same feature_extraction / scoring / insights code that
built the original cohort (app/ml_core/*), so a subject uploaded through
the API is processed identically to the original 20-subject cohort.

The persisted artifact (risk_model_artifacts.json) holds the z-score
normalization stats and isotonic calibration curve that fell out of
train_risk_model() in ml-pipeline/build_dataset.py. A subject uploaded
today is scored with the exact same deviation-from-healthy-centroid +
calibration + bucket-threshold pipeline as the original cohort. Re-running
ml-pipeline/build_dataset.py with more labeled subjects will refine the
calibration; this service always loads whatever artifacts are currently
on disk.
"""

import io
import json
import logging
import tempfile
import uuid
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from app.ml_core.feature_extraction import extract_windows
from app.ml_core.scoring import compute_window_score
from app.ml_core.insights import generate_session_insights
from app.ml_core.unsupervised_risk import score_new_subject

ARTIFACTS_DIR = Path(__file__).resolve().parent.parent / "ml_core" / "artifacts"
logger = logging.getLogger(__name__)


class InferenceUnavailable(Exception):
    pass


def _load_artifacts():
    try:
        with open(ARTIFACTS_DIR / "risk_model_artifacts.json") as f:
            risk_artifacts = json.load(f)
        with open(ARTIFACTS_DIR / "reference_ranges.json") as f:
            ref_ranges = json.load(f)
        with open(ARTIFACTS_DIR / "feature_columns.json") as f:
            feature_cols = json.load(f)
    except FileNotFoundError as e:
        raise InferenceUnavailable(
            "Model artifacts not found. Run `python ml-pipeline/build_dataset.py` "
            "at least once to train and persist the risk model."
        ) from e

    # The fitted IsolationForest (+ gmm/scaler, kept alongside for
    # convenience) has no JSON-serializable closed form, so it's persisted
    # separately via joblib by retrain.py/build_dataset.py. Older artifact
    # directories (seeded before this fix, never since recalibrated) won't
    # have it yet — score_new_subject() falls back to GMM-only scoring in
    # that case rather than failing the whole upload; recalibrating once
    # from Settings produces this file and every upload after is fully
    # consistent (60% GMM + 40% Isolation Forest, same as every other subject).
    iforest = None
    try:
        models = joblib.load(ARTIFACTS_DIR / "unsupervised_models.joblib")
        iforest = models.get("iforest")
    except FileNotFoundError:
        logger.warning(
            "unsupervised_models.joblib not found — scoring this upload with GMM only "
            "until an admin recalibrates the model from Settings."
        )
    return risk_artifacts, ref_ranges, feature_cols, iforest


def process_uploaded_csv(file_bytes: bytes, subject_id: str, activity: str) -> dict:
    """
    Full pipeline for one uploaded recording:
      1. windowed feature extraction (same as offline pipeline)
      2. subject-level feature aggregation
      3. calibrated risk scoring + plain-language explanation
      4. per-window Heart Health Score
      5. explainable insight generation

    Returns a dict with `session`, `windows`, `insights`, and `risk_assessment`
    documents ready for Mongo insertion (the API layer attaches `_id`s/owner).
    """
    risk_artifacts, ref_ranges, feature_cols, iforest = _load_artifacts()

    # A hardcoded "/tmp/..." path only exists on Unix — on Windows there's no
    # /tmp, which raised "[Errno 2] No such file or directory" on every
    # upload. tempfile.gettempdir() resolves to the correct OS temp
    # directory either way, and a uuid suffix avoids collisions between
    # concurrent uploads for the same subject/activity.
    tmp_dir = Path(tempfile.gettempdir())
    tmp_path = tmp_dir / f"upload_{subject_id}_{activity}_{uuid.uuid4().hex}.csv"
    tmp_path.write_bytes(file_bytes)
    try:
        windows_df = extract_windows(tmp_path, subject_id, activity)
    except (KeyError, ValueError) as e:
        raise ValueError(
            f"Couldn't parse this CSV as a CardioEQ sensor recording ({e}). "
            f"Expected columns: timestamp, beat, inst_bpm, gsr_conductance_us, "
            f"accel_x/y/z, SpO2, temp_c, bmi, age, env_temp_c, env_humidity_pct."
        ) from e
    finally:
        tmp_path.unlink(missing_ok=True)

    if windows_df.empty:
        raise ValueError(
            "No usable 30-second windows could be extracted from this file. This "
            "usually means the recording is shorter than 30 seconds, the "
            "'timestamp' column isn't in HH.MM.SS.mmm format, or the 'beat' "
            "column has no detected pulses — check the CSV against the expected schema."
        )

    # subject-level feature vector for classification (mean across windows in this upload)
    subj_features = windows_df[feature_cols].mean().to_dict()

    risk_info = score_new_subject(subj_features, activity, risk_artifacts, iforest=iforest)

    session_id = f"{subject_id}_{activity}_{pd.Timestamp.utcnow().strftime('%Y%m%dT%H%M%S')}"

    window_docs = []
    window_scores = []
    for _, wrow in windows_df.sort_values("window_index").iterrows():
        score, breakdown = compute_window_score(wrow.to_dict(), risk_info["probabilities"], ref_ranges)
        window_scores.append(score)
        window_docs.append({
            "session_id": session_id,
            "subject_id": subject_id,
            "activity": activity,
            "window_index": int(wrow["window_index"]),
            "t_start_sec": float(wrow["t_start_sec"]),
            "heart_rate": _clean(wrow.get("heart_rate")),
            "rr_interval_ms": _clean(wrow.get("rr_interval_ms")),
            "rmssd": _clean(wrow.get("rmssd")),
            "sdnn": _clean(wrow.get("sdnn")),
            "stress_index": _clean(wrow.get("stress_index")),
            "recovery_rate": _clean(wrow.get("recovery_rate")),
            "motion_intensity": _clean(wrow.get("motion_intensity")),
            "spo2": _clean(wrow.get("spo2")),
            "skin_temp_c": _clean(wrow.get("skin_temp_c")),
            "env_temp_c": _clean(wrow.get("env_temp_c")),
            "env_humidity_pct": _clean(wrow.get("env_humidity_pct")),
            "heart_health_score": score,
            "score_breakdown": breakdown,
        })

    insights = generate_session_insights(windows_df, {"subject": subject_id, "activity": activity})
    insight_docs = [{"subject_id": subject_id, "session_id": session_id, "activity": activity, **ins}
                     for ins in insights]

    avg_score = float(np.nanmean(window_scores)) if window_scores else None

    session_doc = {
        "session_id": session_id,
        "subject_id": subject_id,
        "activity": activity,
        "window_count": len(windows_df),
        "duration_sec": float(windows_df["t_start_sec"].max() + 30),
        "avg_heart_rate": _clean(windows_df["heart_rate"].mean()),
        "avg_rmssd": _clean(windows_df["rmssd"].mean()),
        "avg_sdnn": _clean(windows_df["sdnn"].mean()),
        "avg_stress_index": _clean(windows_df["stress_index"].mean()),
        "avg_heart_health_score": _clean(avg_score),
        "avg_risk_score": risk_info["risk_score"],
        "env_temp_c": _clean(windows_df["env_temp_c"].iloc[0]) if "env_temp_c" in windows_df else None,
        "env_humidity_pct": _clean(windows_df["env_humidity_pct"].iloc[0]) if "env_humidity_pct" in windows_df else None,
    }

    risk_assessment = {
        "predicted_class": risk_info["predicted_risk_class"],
        "probability": risk_info["risk_probability"],
        "risk_score": risk_info["risk_score"],
        "class_probabilities": risk_info["probabilities"],
        "model": "Unsupervised anomaly score (GMM + Isolation Forest, activity-normalized, no clinician labels used)",
        "feature_contributions": risk_info["feature_contributions"],
        "human_readable_drivers": risk_info["human_readable_drivers"],
        "demographics_used": {f: _clean(subj_features.get(f)) for f in feature_cols if f in ("bmi", "age")},
    }

    return {
        "session": session_doc,
        "windows": window_docs,
        "insights": insight_docs,
        "risk_assessment": risk_assessment,
        "heart_health_score": avg_score,
    }


def _clean(v):
    if v is None:
        return None
    if isinstance(v, (float, np.floating)) and np.isnan(v):
        return None
    if isinstance(v, (np.floating,)):
        return round(float(v), 3)
    if isinstance(v, (np.integer,)):
        return int(v)
    return v
