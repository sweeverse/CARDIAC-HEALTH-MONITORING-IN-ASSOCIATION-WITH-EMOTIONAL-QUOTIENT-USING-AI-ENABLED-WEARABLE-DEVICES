"""
Live recomputation of subject-level population-benchmarking fields.

BACKGROUND / BUG THIS FIXES
----------------------------
population_percentile, similar_cohort_percentile, composure_index_proxy,
cognitive_load_index, and heart_health_score_breakdown were only ever
computed ONCE, OFFLINE, for the original 20-subject seed cohort (see
ml-pipeline/build_dataset.py). The live upload pipeline
(services/inference.py + routers/subjects.py::upload_subject_recordings)
never recomputed them for a subject created through the running app, so a
newly registered user who uploaded a recording would see:
  - Cohort Overview / Population Analytics percentile = "Nil"
  - Percentile vs Rank graph empty (population_percentile is the field the
    radar chart in PopulationPanel.jsx reads)
  - EQ Research's "Composite Proxy" column empty (composure_index_proxy)
  - Explainability's Heart Health Score breakdown empty
This module reuses the EXACT SAME functions already used offline
(percentile_rank, similar_cohort in app/ml_core/scoring.py; the
composure_index_proxy formula from build_dataset.py) so a live-uploaded
subject is benchmarked identically to the original cohort. It does NOT
change the trained risk model, its features, or its scoring logic in any
way — this only fills in display-layer benchmarking stats.
"""
import numpy as np
import pandas as pd

from app.db import get_db, COL_SUBJECTS, COL_TIMESERIES, COL_POPULATION_STATS
from app.ml_core.risk_model import FEATURE_COLS
from app.ml_core.scoring import percentile_rank, similar_cohort, cognitive_load_index

WINDOW_FEATURES = [f for f in FEATURE_COLS if f not in ("age", "bmi")]


def composure_index_proxy(rmssd_series, stress_series, recovery_series):
    """Identical formula to ml-pipeline/build_dataset.py::composure_index_proxy
    — a demo proxy for emotional-regulation capacity derived from
    physiological recovery dynamics, NOT a validated EQ measurement."""
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


async def recompute_population_benchmarks():
    """
    Rebuilds population_percentile / similar_cohort_percentile /
    composure_index_proxy / cognitive_load_index / heart_health_score_breakdown
    for EVERY subject with at least one recorded window, plus the shared
    population_stats "global" doc's per-feature quantiles + cohort_size — so
    a newly uploaded subject both (a) gets its own benchmarking numbers
    immediately, and (b) is correctly folded into every other subject's
    cohort comparison too. Called once at the end of each successful upload
    (see routers/subjects.py).
    """
    db = get_db()

    subjects = [s async for s in db[COL_SUBJECTS].find({})]
    if not subjects:
        return

    projection = {"subject_id": 1, "activity": 1, "t_start_sec": 1,
                  "score_breakdown": 1, **{f: 1 for f in WINDOW_FEATURES}}
    windows = [w async for w in db[COL_TIMESERIES].find({}, projection)]
    if not windows:
        return
    wdf = pd.DataFrame(windows)

    rows = []
    for s in subjects:
        sid = s["subject_id"]
        sub_windows = wdf[wdf["subject_id"] == sid]
        row = {"subject": sid,
               "age": (s.get("demographics") or {}).get("age"),
               "bmi": (s.get("demographics") or {}).get("bmi")}
        for f in WINDOW_FEATURES:
            row[f] = sub_windows[f].mean() if (f in sub_windows.columns and not sub_windows.empty) else np.nan
        rows.append(row)
    subj_table = pd.DataFrame(rows)

    for s in subjects:
        sid = s["subject_id"]
        sub_windows = wdf[wdf["subject_id"] == sid]
        if sub_windows.empty:
            continue  # nothing uploaded yet for this subject — "Nil" is correct here, not a bug

        srow = subj_table[subj_table["subject"] == sid].iloc[0]

        percentiles = {f: percentile_rank(srow.get(f), subj_table[f]) for f in FEATURE_COLS if f in subj_table.columns}
        similar = similar_cohort(subj_table, srow)
        similar_percentiles = {
            f: (percentile_rank(srow.get(f), similar[f]) if len(similar) >= 3 and f in similar.columns else None)
            for f in FEATURE_COLS if f in subj_table.columns
        }

        composure = composure_index_proxy(
            sub_windows.get("rmssd", pd.Series(dtype=float)),
            sub_windows.get("stress_index", pd.Series(dtype=float)),
            sub_windows.get("recovery_rate", pd.Series(dtype=float)),
        )
        cog_load = cognitive_load_index(sub_windows) if "activity" in sub_windows.columns else None

        update = {
            "population_percentile": percentiles,
            "similar_cohort_percentile": similar_percentiles,
            "composure_index_proxy": composure,
            "activities_recorded": sorted(sub_windows["activity"].dropna().unique().tolist()) if "activity" in sub_windows.columns else [],
        }
        if cog_load is not None:
            update["cognitive_load_index"] = cog_load.get("cognitive_load_index")
            update["cognitive_load_detail"] = cog_load

        if "t_start_sec" in sub_windows.columns and sub_windows["t_start_sec"].notna().any():
            latest = sub_windows.sort_values("t_start_sec").iloc[-1]
        else:
            latest = sub_windows.iloc[-1]
        breakdown = latest.get("score_breakdown")
        if isinstance(breakdown, list) and breakdown:
            update["heart_health_score_breakdown"] = breakdown

        await db[COL_SUBJECTS].update_one({"subject_id": sid}, {"$set": update})

    # Refresh the shared population_stats "global" doc's per-feature
    # quantiles + cohort size — this is what makes the Reference
    # Distribution / "Include the newly uploaded participant in the cohort
    # comparison" actually true for every OTHER subject's view too.
    features_stats = {}
    for f in FEATURE_COLS:
        if f not in subj_table.columns:
            continue
        series = subj_table[f].dropna()
        if len(series) == 0:
            continue
        features_stats[f] = {
            "p25": round(float(series.quantile(0.25)), 2),
            "p50": round(float(series.quantile(0.50)), 2),
            "p75": round(float(series.quantile(0.75)), 2),
            "min": round(float(series.min()), 2),
            "max": round(float(series.max()), 2),
        }

    # NEW: cohort-wide risk_score distribution, recomputed from whatever's
    # actually on each subject doc right now. This used to be written ONCE,
    # offline, by ml-pipeline/build_dataset.py and never touched again — so
    # PopulationPanel's "Risk score vs. cohort distribution" chart kept
    # showing the ORIGINAL seed cohort's scores forever, even after a
    # subject's own risk label changed from a new upload, a deleted
    # session, or a model recalibration. `subjects` was already fetched
    # fresh at the top of this function, so this reflects every rescoring
    # that happened right before this call (see services/retrain.py).
    risk_score_distribution = [
        {"subject": s["subject_id"], "risk_score": (s.get("risk_assessment") or {}).get("risk_score")}
        for s in subjects
        if (s.get("risk_assessment") or {}).get("risk_score") is not None
    ]

    if features_stats:
        await db[COL_POPULATION_STATS].update_one(
            {"_id": "global"},
            {"$set": {
                "cohort_size": int(len(subjects)),
                "features": features_stats,
                "risk_score_distribution": risk_score_distribution,
            }},
            upsert=True,
        )
