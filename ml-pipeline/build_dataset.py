"""
CardioEQ AI — Dataset Builder
================================
Combines feature_extraction.py + risk_model.py + scoring.py + insights.py
into the exact document shapes that get written to MongoDB. This is the
single source of truth for the schema used by the FastAPI backend.

Collections produced (see backend/app/models for the matching Pydantic
schemas):

  subjects            one doc per subject — demographics + latest unsupervised risk assessment
  sessions            one doc per subject+activity recording
  timeseries_features one doc per (subject, activity, window) — the data
                       that powers the time-series charts
  insights            explainable pattern/why/impact/recommendation docs
  population_stats    single cohort-wide percentile reference doc

NOTE ON EQ / ENVIRONMENT DATA: The uploaded dataset includes environmental
temperature & humidity (real, used throughout) but does NOT include an
Emotional Quotient (EQ) assessment or air-quality/pollution readings —
those aren't things a PPG/GSR wearable can measure. Rather than fabricate
fake EQ scores, this builder computes a clearly-labeled proxy
("composure_index_proxy", derived from stress-recovery dynamics) and
leaves `eq_score` / `air_quality_index` as null fields in the schema,
ready to be populated from a real EQ questionnaire or air-quality API
when available. The dashboard should always show proxy fields with a
"derived, not measured" badge.
"""

import json
import joblib
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime, timedelta, timezone

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.ml_core.feature_extraction import extract_all, normalize_subject_id
from app.ml_core.fingerprint import content_fingerprint, FINGERPRINT_VERSION
from app.ml_core.risk_model import build_subject_table, FEATURE_COLS
from app.ml_core.unsupervised_risk import train_unsupervised, activity_normalize, fit_unsupervised
from app.ml_core.unsupervised_validation import run_validation
from app.ml_core.scoring import (
    compute_window_score, compute_population_stats, percentile_rank, similar_cohort,
    derive_reference_ranges, derive_reference_ranges_by_activity,
    inter_intra_subject_variability, cognitive_load_index,
)
from app.ml_core.insights import generate_session_insights

import os

BASE = Path(__file__).resolve().parent
# Point this at wherever you extracted EVERYTHING_DATA.zip (the folder containing
# modified_csvs/ and subject_metadata.csv). Override with the RAW_DATA_DIR env var.
DATA_BASE = Path(os.environ.get("RAW_DATA_DIR", BASE / "raw_data" / "modified_all_subjects_FIXED"))
OUT = BASE / "data_processed"
OUT.mkdir(exist_ok=True)

# Every subject's 4 activities (sit/walk/run/cog) were recorded in ONE
# real-world sitting, so they must all share the exact same session date —
# only the DATE varies subject-to-subject, picked at random within May
# (that's when this cohort's real data collection happened). The random
# choice is seeded per-subject (hash of the subject id) so re-running this
# builder always reproduces the same assigned dates instead of reshuffling
# them on every run. Anyone uploaded live through the app gets their true
# upload date/time instead (see subjects.py /upload), which is untouched by
# any of this.
import hashlib as _hashlib


def _random_may_date(subject: str, year: int = 2026) -> datetime:
    """Deterministic-but-random day within May for this subject (all 4 of
    their activities share this exact date — see SEED_SESSION_BATCH_ID)."""
    digest = _hashlib.sha256(subject.encode()).hexdigest()
    day = 1 + (int(digest, 16) % 31)  # 1..31
    return datetime(year, 5, day, 9, 0, 0, tzinfo=timezone.utc)


SEED_SESSION_BATCH_ID = lambda subject: f"{subject}_seed_session1"  # noqa: E731


def _raw_csv_fingerprints(csv_dir: Path) -> dict:
    """
    Maps (subject, activity) -> content_fingerprint of its raw source CSV,
    using the exact same algorithm as the live upload endpoint
    (app.ml_core.fingerprint.content_fingerprint) and the exact same
    filename parsing as extract_all() above.

    Without this, seeded sessions carried NO fingerprint at all, so a
    subject re-uploading their own original CSV through the app could
    never match against the seeded copy — it always looked like a brand
    new recording occasion instead of the exact same file the cohort was
    built from. Stamping the real fingerprint here fixes that at the
    source, permanently — no purge/re-upload dance needed after a reseed.
    """
    out = {}
    candidates = sorted(set(csv_dir.glob("*_modified.csv")) | set(csv_dir.glob("*.csv")))
    for csv_path in candidates:
        name = csv_path.stem.replace("_modified", "")
        subject, activity = name.rsplit("_", 1)
        subject = normalize_subject_id(subject)
        activity = activity.strip().lower()
        out[(subject, activity)] = content_fingerprint(csv_path.read_bytes())
    return out


def composure_index_proxy(rmssd_series, stress_series, recovery_series) -> float:
    """
    Demo proxy for emotional regulation capacity, derived purely from
    physiological recovery dynamics. NOT a validated EQ measurement —
    surfaced in the UI as a labeled proxy only.
    """
    r = np.nanmean(rmssd_series) if len(rmssd_series) else np.nan
    s = np.nanmean(stress_series) if len(stress_series) else np.nan
    rec = np.nanmean(recovery_series) if len(recovery_series) else np.nan
    if np.isnan(r) or np.isnan(s):
        return None
    norm_r = np.clip(r / 60, 0, 1)
    norm_s = np.clip(1 - s / 100, 0, 1)
    norm_rec = np.clip((rec if not np.isnan(rec) else 0) / 3, 0, 1)
    score = 100 * (0.45 * norm_r + 0.35 * norm_s + 0.20 * norm_rec)
    return round(float(score), 1)


def main():
    if not (DATA_BASE / "modified_csvs").exists():
        raise SystemExit(
            f"Raw data not found at {DATA_BASE}.\n"
            f"Extract EVERYTHING_DATA.zip somewhere and either:\n"
            f"  - place its modified_all_subjects_FIXED/ folder at "
            f"{BASE / 'raw_data' / 'modified_all_subjects_FIXED'}, or\n"
            f"  - set RAW_DATA_DIR=/path/to/modified_all_subjects_FIXED\n"
        )
    print("1/5 Extracting windowed biomarker features from raw sensor CSVs...")
    windows = extract_all(DATA_BASE / "modified_csvs", DATA_BASE / "subject_metadata.csv")
    raw_fingerprints = _raw_csv_fingerprints(DATA_BASE / "modified_csvs")

    print("\n2/5 Building subject-level table and computing UNSUPERVISED risk scores...")
    print("  (GMM + IsolationForest, activity-normalized window features — no clinician labels used)")
    subj_table = build_subject_table(windows)
    risk_results, risk_artifacts, scored_windows = train_unsupervised(windows)
    risk_by_subject = {r["subject"]: r for r in risk_results["subject_predictions"]}
    # scored_windows is windows_norm (== windows, same row order/index) with
    # z_/score columns appended by fit_unsupervised() — carrying risk_score
    # back onto `windows` lets the per-session loop below (section 4) attach
    # an avg_risk_score to each session doc, the same way it already does
    # for avg_heart_health_score, WITHOUT restructuring that loop to operate
    # on scored_windows instead.
    windows["risk_score"] = scored_windows["risk_score"].values

    print("\n3/5 Computing Heart Health Scores + population benchmarks...")
    pop_stats = compute_population_stats(subj_table, FEATURE_COLS)
    # Healthy band for the Heart Health Score now comes from the SAME
    # unsupervised model as the risk classifier: windows the GMM/IsolationForest
    # itself scored below the mild-risk threshold define "healthy" here —
    # no clinician labels anywhere in this pipeline anymore.
    healthy_mask = scored_windows["risk_score"] < risk_results["bucket_thresholds"]["mild_risk_at"]
    print(f"  Unsupervised-healthy windows: {int(healthy_mask.sum())}/{len(healthy_mask)} "
          f"({scored_windows.loc[healthy_mask, 'subject'].nunique()} subjects) — used to derive reference bands")
    ref_ranges = derive_reference_ranges(windows, healthy_mask)
    ref_ranges_by_activity = derive_reference_ranges_by_activity(windows, healthy_mask)
    print("  Reference ranges (cohort-empirical where available):")
    for f, r in ref_ranges.items():
        print(f"    {f:15s} {r['healthy_low']}-{r['healthy_high']}  [{r['source']}]")

    print("\n3b/5 Research analyses: unsupervised validation, inter-subject variability...")
    windows_norm, _ = activity_normalize(windows)
    _, _, fitted_models = fit_unsupervised(windows_norm)
    validation_results = run_validation(
        windows, scored_windows, fitted_models, n_bootstrap=50
    )
    variability_results = inter_intra_subject_variability(windows, FEATURE_COLS)
    cq = validation_results["cluster_quality"]
    if cq.get("silhouette_score") is not None:
        print(f"  Silhouette: {cq['silhouette_score']}  Davies-Bouldin: {cq['davies_bouldin_score']}")
    print(f"  Bootstrap mean flip rate: {validation_results['bootstrap_stability']['mean_flip_rate']*100:.1f}%")

    subjects_docs = []
    sessions_docs = []
    timeseries_docs = []
    insights_docs = []

    for subject, srow in subj_table.set_index("subject", drop=False).iterrows():
        risk_info = risk_by_subject[subject]
        sub_windows = windows[windows["subject"] == subject]

        composure = composure_index_proxy(
            sub_windows["rmssd"], sub_windows["stress_index"], sub_windows["recovery_rate"]
        )
        cog_load = cognitive_load_index(sub_windows)

        percentiles = {
            f: percentile_rank(srow[f], subj_table[f]) for f in FEATURE_COLS
        }
        similar = similar_cohort(subj_table, srow)
        similar_percentiles = {
            f: percentile_rank(srow[f], similar[f]) if len(similar) >= 3 else None
            for f in FEATURE_COLS
        }

        latest_window = sub_windows.sort_values(["activity", "window_index"]).iloc[-1]
        latest_score, latest_breakdown = compute_window_score(
            latest_window.to_dict(), risk_info["probabilities"], ref_ranges
        )

        subjects_docs.append({
            "_id": subject,
            "subject_id": subject,
            "demographics": {
                "age": float(srow["age"]) if pd.notna(srow["age"]) else None,
                "bmi": float(srow["bmi"]) if pd.notna(srow["bmi"]) else None,
                "height_cm": None,
                "weight_kg": None,
            },
            "eq_score": None,
            "eq_subscores": None,
            "eq_completed_at": None,
            "composure_index_proxy": composure,
            "cognitive_load_index": cog_load["cognitive_load_index"] if cog_load else None,
            "cognitive_load_detail": cog_load,
            "air_quality_index": None,
            "risk_assessment": {
                "predicted_class": risk_info["predicted_risk_class"],
                "probability": risk_info["risk_probability"],
                "risk_score": risk_info["risk_score"],
                "class_probabilities": risk_info["probabilities"],
                "model": "Unsupervised anomaly score (GMM + Isolation Forest, activity-normalized, no clinician labels used)",
                "feature_contributions": risk_info["feature_contributions"],
                "human_readable_drivers": risk_info["human_readable_drivers"],
            },
            "heart_health_score": latest_score,
            "heart_health_score_breakdown": latest_breakdown,
            "population_percentile": percentiles,
            "similar_cohort_percentile": similar_percentiles,
            "activities_recorded": sorted(sub_windows["activity"].unique().tolist()),
        })

        for activity, awin in sub_windows.groupby("activity"):
            awin = awin.sort_values("window_index")
            session_id = f"{subject}_{activity}"

            session_insights = generate_session_insights(awin, {"subject": subject, "activity": activity})
            for ins in session_insights:
                insights_docs.append({
                    "subject_id": subject,
                    "session_id": session_id,
                    "activity": activity,
                    **ins,
                })

            window_scores = []
            for _, wrow in awin.iterrows():
                score, breakdown = compute_window_score(wrow.to_dict(), risk_info["probabilities"], ref_ranges)
                window_scores.append(score)
                timeseries_docs.append({
                    "subject_id": subject,
                    "session_id": session_id,
                    "activity": activity,
                    "window_index": int(wrow["window_index"]),
                    "t_start_sec": float(wrow["t_start_sec"]),
                    "heart_rate": _clean(wrow["heart_rate"]),
                    "rr_interval_ms": _clean(wrow["rr_interval_ms"]),
                    "rmssd": _clean(wrow["rmssd"]),
                    "sdnn": _clean(wrow["sdnn"]),
                    "stress_index": _clean(wrow["stress_index"]),
                    "recovery_rate": _clean(wrow["recovery_rate"]),
                    "motion_intensity": _clean(wrow["motion_intensity"]),
                    "spo2": _clean(wrow["spo2"]),
                    "skin_temp_c": _clean(wrow["skin_temp_c"]),
                    "env_temp_c": _clean(wrow["env_temp_c"]),
                    "env_humidity_pct": _clean(wrow["env_humidity_pct"]),
                    "heart_health_score": score,
                })

            sessions_docs.append({
                "session_id": session_id,
                "subject_id": subject,
                "activity": activity,
                "window_count": len(awin),
                "duration_sec": float(awin["t_start_sec"].max() + 30),
                "avg_heart_rate": _clean(awin["heart_rate"].mean()),
                "avg_rmssd": _clean(awin["rmssd"].mean()),
                "avg_sdnn": _clean(awin["sdnn"].mean()),
                "avg_stress_index": _clean(awin["stress_index"].mean()),
                "avg_recovery_rate": _clean(awin["recovery_rate"].mean()),
                "avg_heart_health_score": _clean(np.nanmean(window_scores)) if window_scores else None,
                "avg_risk_score": _clean(awin["risk_score"].mean()),
                "env_temp_c": _clean(awin["env_temp_c"].iloc[0]),
                "env_humidity_pct": _clean(awin["env_humidity_pct"].iloc[0]),
                # The original recording protocol didn't capture a real
                # per-activity timestamp (each subject did cog/run/sit/walk
                # in one sitting); we stagger them in canonical protocol
                # order (cog -> run -> sit -> walk, 1 day apart) purely so
                # the Longitudinal page has a sensible chronological order
                # to demo against. Real uploads via the API get a true
                # datetime.now() timestamp instead (see subjects.py /upload).
                "recorded_at": (
                    _random_may_date(subject)
                ).isoformat().replace("+00:00", "Z"),
                "recorded_at_is_synthetic": True,
                "session_batch_id": SEED_SESSION_BATCH_ID(subject),
                # Real fingerprint of this activity's raw source CSV — lets
                # a live re-upload of the same original file correctly
                # detect it as an exact match instead of a false "new
                # recording occasion" (see _raw_csv_fingerprints above).
                "content_fingerprint": raw_fingerprints.get((subject, activity)),
                "content_fingerprint_version": FINGERPRINT_VERSION if (subject, activity) in raw_fingerprints else None,
            })

    missing_fp = [s["session_id"] for s in sessions_docs if s.get("content_fingerprint") is None]
    if missing_fp:
        print(f"  ! WARNING: {len(missing_fp)} sessions have no raw CSV match for fingerprinting "
              f"(will still seed with content_fingerprint=None, i.e. legacy behavior): {missing_fp[:5]}"
              f"{'...' if len(missing_fp) > 5 else ''}")
    else:
        print(f"  All {len(sessions_docs)} sessions fingerprinted (v{FINGERPRINT_VERSION}) from their raw CSVs.")

    print("\n4/5 Writing collection JSON files for MongoDB import...")
    ARTIFACTS = Path(__file__).resolve().parent.parent / "backend" / "app" / "ml_core" / "artifacts"
    ARTIFACTS.mkdir(exist_ok=True, parents=True)
    with open(ARTIFACTS / "risk_model_artifacts.json", "w") as f:
        json.dump(risk_artifacts, f, indent=2)
    with open(ARTIFACTS / "reference_ranges.json", "w") as f:
        json.dump(ref_ranges, f, indent=2)
    with open(ARTIFACTS / "reference_ranges_by_activity.json", "w") as f:
        json.dump(ref_ranges_by_activity, f, indent=2)
    with open(ARTIFACTS / "variability_analysis.json", "w") as f:
        json.dump(variability_results, f, indent=2)
    with open(ARTIFACTS / "feature_columns.json", "w") as f:
        json.dump(FEATURE_COLS, f)
    # Persisted so services/inference.py can score a live single-file upload
    # with the SAME 60% GMM + 40% Isolation Forest blend used here, instead
    # of falling back to the GMM-only path (see unsupervised_risk.py::
    # score_new_subject's docstring) until someone manually recalibrates.
    joblib.dump(fitted_models, ARTIFACTS / "unsupervised_models.joblib")
    # unsupervised_model_report.json is served directly from ARTIFACTS_DIR
    # by /api/research/unsupervised-validation and /api/research/loocv
    # (see routers/research.py) — write it here too, not just to
    # data_processed/, so the served copy can never silently go stale
    # relative to what this run actually computed (an audit of this exact
    # drift found the served copy still carrying the removed
    # weak_label_crosscheck field from before the label-removal pass).
    with open(ARTIFACTS / "unsupervised_model_report.json", "w") as f:
        json.dump(validation_results, f, indent=2)
    print(f"  saved model artifacts to {ARTIFACTS}")

    _write(subjects_docs, "subjects.json")
    _write(sessions_docs, "sessions.json")
    _write(timeseries_docs, "timeseries_features.json")
    _write(insights_docs, "insights.json")
    _write([{
        "_id": "global", **pop_stats,
        "reference_ranges": ref_ranges,
        "reference_ranges_by_activity": ref_ranges_by_activity,
        "variability_analysis": variability_results,
        "model_info": {
            "model": risk_results["model"],
            "n_total_subjects": risk_results["n_total_subjects"],
            "bucket_thresholds": risk_results["bucket_thresholds"],
        },
        # NEW: full cohort's individual risk scores (subject_id + score only,
        # no other fields) so the frontend can render this subject's score
        # positioned against the actual cohort distribution, not just its
        # own percentile-of-raw-feature numbers.
        "risk_score_distribution": [
            {"subject": r["subject"], "risk_score": r["risk_score"]}
            for r in risk_results["subject_predictions"]
        ],
    }], "population_stats.json")
    _write(risk_results, "risk_model_report.json")
    _write(validation_results, "unsupervised_model_report.json")

    print("\n5/5 Done.")
    print(f"  subjects: {len(subjects_docs)}")
    print(f"  sessions: {len(sessions_docs)}")
    print(f"  timeseries_features: {len(timeseries_docs)}")
    print(f"  insights: {len(insights_docs)}")


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


def _write(obj, name):
    with open(OUT / name, "w") as f:
        json.dump(obj, f, indent=2)
    print(f"  wrote {name}")


if __name__ == "__main__":
    main()
