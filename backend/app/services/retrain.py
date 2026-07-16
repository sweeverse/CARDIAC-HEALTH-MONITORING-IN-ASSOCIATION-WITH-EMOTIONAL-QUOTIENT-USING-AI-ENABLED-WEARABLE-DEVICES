"""
Admin-triggered live retrain of the unsupervised pipeline (Task 7 / Task 11).

Without this, the fitted GMM + Isolation Forest model is permanently
frozen at whatever `ml-pipeline/build_dataset.py` produced once, offline —
every subsequently live-uploaded subject gets SCORED against that frozen
model (via services/inference.py), but never actually influences it. That
satisfies "Risk Score must be model-derived" for each individual upload,
but not Task 7's "whenever data changes, automatically regenerate ...
never display stale analytics" for the model itself, and leaves Task 11's
"retrain unsupervised pipeline" with nothing to actually test against a
running app.

This service closes that loop: it refits the model directly from
whatever is currently in Mongo (COL_TIMESERIES) — the original seeded
cohort PLUS every live upload since — persists updated artifacts (the
exact files services/inference.py reads for every future upload), then
re-scores every existing subject's risk_assessment / heart_health_score
under the freshly-fit model so nothing on screen is left stale, and
finally refreshes population/cohort benchmarks on top of that.

Train only using raw sensor recordings — no clinical label enters any
step here, consistent with the rest of the pipeline.
"""

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from pymongo import UpdateOne

from app.db import get_db, COL_TIMESERIES, COL_SUBJECTS, COL_SESSIONS, COL_POPULATION_STATS
from app.ml_core.unsupervised_risk import (
    train_unsupervised, activity_normalize, fit_unsupervised,
    FEATURE_COLS as PHYSIO_FEATURE_COLS,
)
from app.ml_core.risk_model import FEATURE_COLS
from app.ml_core.unsupervised_validation import run_validation
from app.ml_core.scoring import (
    derive_reference_ranges, derive_reference_ranges_by_activity, compute_window_score,
)
from app.services.population_recompute import recompute_population_benchmarks

ARTIFACTS_DIR = Path(__file__).resolve().parent.parent / "ml_core" / "artifacts"

# Guards recalibrate_after_data_change below. retrain_unsupervised_pipeline()
# reads every window in Mongo, refits the model, then bulk-writes results
# back across COL_SUBJECTS / COL_SESSIONS / COL_TIMESERIES / COL_POPULATION_STATS
# with no transaction wrapping the whole thing — none of that is atomic. If
# two of these ever ran concurrently (e.g. two session deletes fired close
# together, each triggering their own recalibration), their reads and
# writes could interleave: one call's read might miss the other's
# in-flight delete, or their per-collection writes could land in either
# order, leaving the database holding a hybrid of two different model
# fits. That's exactly the kind of drift that can leave a subject's risk
# score not fully returning to its original value even after the data
# that changed it is removed again. Serializing here makes each
# recalibration run start-to-finish against a state no other recalibration
# is simultaneously mutating.
_recalibration_lock = asyncio.Lock()


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


async def retrain_unsupervised_pipeline() -> dict:
    db = get_db()

    # IMPORTANT: Mongo's find() makes no ordering guarantee, and the GMM's
    # k-means++ initialization (even with a fixed random_state) walks rows
    # in whatever order they arrive — so an unsorted read here made the
    # refit non-deterministic across otherwise-identical datasets. Sorting
    # by (subject_id, activity, window_index) alone is STILL NOT a total
    # order, though: window_index restarts at 0 for every new session, so
    # a subject with two sessions of the same activity has two windows
    # both keyed (subject_id, activity, 0), (subject_id, activity, 1), etc.
    # Mongo does not guarantee a stable order for tied sort keys — which of
    # those two rows comes first can silently change between calls as the
    # collection's physical storage shifts from unrelated inserts/deletes
    # elsewhere in the dataset. That's the actual reason a subject's risk
    # score could drift to a NEW value (not back to the original) after
    # uploading then deleting an unrelated session: the "before" and
    # "after" refits saw the SAME rows but in a different relative order
    # for these tied windows, and GMM/IsolationForest fitting is sensitive
    # to row order. Appending _id (unique, immutable per row) as a final
    # tiebreaker makes this a true total order — identical data always
    # sorts identically, no matter what else in the collection changed.
    raw_windows = await db[COL_TIMESERIES].find({}).sort(
        [("subject_id", 1), ("activity", 1), ("window_index", 1), ("_id", 1)]
    ).to_list(length=None)
    if len(raw_windows) < 10:
        raise ValueError(
            f"Only {len(raw_windows)} recorded windows exist — need at least 10 across "
            f"subjects to refit a meaningful model."
        )

    windows = pd.DataFrame(raw_windows)
    # unsupervised_risk.py's fitting functions group by a column literally
    # named "subject" (matching the offline pipeline's convention); Mongo
    # documents use "subject_id" — rename here rather than touch the
    # fitting code, so this is the only place that has to know about it.
    windows = windows.rename(columns={"subject_id": "subject"})
    windows = windows.dropna(subset=PHYSIO_FEATURE_COLS).reset_index(drop=True)
    if windows.empty:
        raise ValueError("No windows with complete physiological features to train on.")

    # 1. Refit GMM + Isolation Forest purely on current data. Zero clinical
    #    labels enter this call (see unsupervised_risk.py docstring).
    risk_results, risk_artifacts, scored_windows = train_unsupervised(windows)

    # 2. Recompute reference ranges from the freshly-fit healthy bucket.
    healthy_mask = scored_windows["risk_score"] < risk_results["bucket_thresholds"]["mild_risk_at"]
    ref_ranges = derive_reference_ranges(windows, healthy_mask)
    ref_ranges_by_activity = derive_reference_ranges_by_activity(windows, healthy_mask)

    # 3. Persist artifacts — the exact files services/inference.py loads on
    #    every future live upload, so the newly-fit model takes effect
    #    immediately, no restart needed.
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    with open(ARTIFACTS_DIR / "risk_model_artifacts.json", "w") as f:
        json.dump(risk_artifacts, f, indent=2)
    with open(ARTIFACTS_DIR / "reference_ranges.json", "w") as f:
        json.dump(ref_ranges, f, indent=2)
    with open(ARTIFACTS_DIR / "reference_ranges_by_activity.json", "w") as f:
        json.dump(ref_ranges_by_activity, f, indent=2)
    with open(ARTIFACTS_DIR / "feature_columns.json", "w") as f:
        json.dump(FEATURE_COLS, f)

    # 3b. Refresh the validation report (silhouette / Davies-Bouldin /
    # bootstrap stability) against the newly-fit model too. Written to the
    # SAME artifacts dir routers/research.py serves it from — an audit
    # found this exact file can silently go stale if it's ever written
    # anywhere else, so it's kept here rather than in data_processed/.
    windows_norm, _ = activity_normalize(windows)
    _, _, fitted_models = fit_unsupervised(windows_norm)
    validation_results = run_validation(windows, scored_windows, fitted_models, n_bootstrap=30)
    with open(ARTIFACTS_DIR / "unsupervised_model_report.json", "w") as f:
        json.dump(validation_results, f, indent=2)

    # 3c. Persist the actual fitted scaler/GMM/IsolationForest objects, not
    # just the JSON-serializable GMM parameters above. IsolationForest has
    # no closed-form parametric form (it's a forest of isolation trees), so
    # unsupervised_risk.py::score_new_subject() can't rebuild it from plain
    # arrays the way it rebuilds the GMM — without this, every live single-
    # file upload was scored GMM-only (see that function's docstring),
    # silently disagreeing with the 60% GMM + 40% Isolation Forest blend
    # every seeded/retrained subject gets. Loaded back in
    # services/inference.py on every future upload.
    joblib.dump(fitted_models, ARTIFACTS_DIR / "unsupervised_models.joblib")

    # 3d. Refresh the LIVE bucket thresholds + model name on the shared
    # population_stats doc. Previously this was only ever written once,
    # offline, by ml-pipeline/build_dataset.py — PopulationPanel's "Risk
    # score vs. cohort distribution" chart (bucket_thresholds) and every
    # other reader of GET /subjects/{id}/population stayed pinned to
    # whatever the ORIGINAL seed cohort's thresholds were, no matter how
    # many times the model was recalibrated afterward.
    await db[COL_POPULATION_STATS].update_one(
        {"_id": "global"},
        {"$set": {"model_info": {
            "model": risk_results["model"],
            "n_total_subjects": risk_results["n_total_subjects"],
            "bucket_thresholds": risk_results["bucket_thresholds"],
        }}},
        upsert=True,
    )

    # 4. Re-score every subject + every window under the new model so
    #    nothing already on screen is left stale (Task 7).
    now = datetime.now(timezone.utc)
    risk_by_subject = {r["subject"]: r for r in risk_results["subject_predictions"]}

    window_updates: list[UpdateOne] = []
    session_scores: dict[str, list[float]] = {}  # session_id -> [window heart_health_scores]
    session_risk_scores: dict[str, list[float]] = {}  # session_id -> [window risk_scores (GMM+IF blend)]

    for subject_id, r in risk_by_subject.items():
        subject_windows = scored_windows[scored_windows["subject"] == subject_id]
        subject_window_scores = []
        for _, wrow in subject_windows.iterrows():
            score, breakdown = compute_window_score(wrow.to_dict(), r["probabilities"], ref_ranges)
            subject_window_scores.append(score)
            window_updates.append(UpdateOne(
                {"subject_id": subject_id, "activity": wrow["activity"], "window_index": int(wrow["window_index"])},
                {"$set": {"heart_health_score": score, "score_breakdown": breakdown}},
            ))
            sess_id = wrow.get("session_id")
            if sess_id:
                session_scores.setdefault(sess_id, []).append(score)
                # wrow["risk_score"] is the SAME blended (60% GMM + 40%
                # Isolation Forest) per-window score train_unsupervised()
                # just fit — aggregating it per session (like HHS above)
                # is what lets LongitudinalPanel plot "risk score over
                # time" using the exact metric that drives the risk label,
                # instead of the separate rule-based Heart Health Score.
                if pd.notna(wrow.get("risk_score")):
                    session_risk_scores.setdefault(sess_id, []).append(float(wrow["risk_score"]))

        subj_avg_score = float(np.nanmean(subject_window_scores)) if subject_window_scores else None

        await db[COL_SUBJECTS].update_one(
            {"subject_id": subject_id},
            {"$set": {
                "risk_assessment": {
                    "predicted_class": r["predicted_risk_class"],
                    "probability": r["risk_probability"],
                    "risk_score": r["risk_score"],
                    "class_probabilities": r["probabilities"],
                    "model": "Unsupervised anomaly score (GMM + Isolation Forest, activity-normalized, no clinician labels used)",
                    "feature_contributions": r["feature_contributions"],
                    "human_readable_drivers": r["human_readable_drivers"],
                },
                "heart_health_score": _clean(subj_avg_score),
                "updated_at": now,
            }},
        )

    if window_updates:
        for i in range(0, len(window_updates), 500):  # batch to keep each round-trip reasonably sized
            await db[COL_TIMESERIES].bulk_write(window_updates[i:i + 500], ordered=False)

    session_updates = [
        UpdateOne(
            {"session_id": sid},
            {"$set": {
                "avg_heart_health_score": _clean(float(np.nanmean(scores))),
                **({"avg_risk_score": _clean(float(np.nanmean(session_risk_scores[sid])))}
                   if session_risk_scores.get(sid) else {}),
            }},
        )
        for sid, scores in session_scores.items() if scores
    ]
    if session_updates:
        await db[COL_SESSIONS].bulk_write(session_updates, ordered=False)

    # 5. Refresh population/cohort benchmarks on top of the newly-scored subjects.
    await recompute_population_benchmarks()

    return {
        "n_windows_used": len(windows),
        "n_subjects_rescored": len(risk_by_subject),
        "n_windows_rescored": len(window_updates),
        "n_sessions_rescored": len(session_updates),
        "model": risk_results["model"],
        "bucket_thresholds": risk_results["bucket_thresholds"],
        "cluster_quality": validation_results["cluster_quality"],
        "retrained_at": now.isoformat(),
    }


async def recalibrate_after_data_change() -> dict:
    """
    Single entry point called after ANY change to the dataset — a session
    upload, a session delete, or a full subject delete — so the model
    itself (bucket thresholds, GMM+Isolation Forest fit, reference ranges,
    risk_score_distribution) never goes stale relative to what's actually
    in Mongo right now. Previously only the admin's manual "Recalibrate
    risk model" button in Settings did this; uploading or deleting data
    only ever refreshed percentile/benchmark display fields
    (recompute_population_benchmarks), which is what let Healthy/Mild/
    Moderate counts and the Population page's risk distribution drift out
    of sync with a subject's own just-changed risk label.

    Falls back to the lighter percentile-only recompute if a full retrain
    isn't possible yet (fewer than 10 windows total, e.g. a brand-new,
    still-empty deployment) — that's a normal/expected state, not an error,
    so it's swallowed here rather than surfacing a 400 to whoever just
    uploaded or deleted a session.
    """
    async with _recalibration_lock:
        try:
            return {"mode": "full_retrain", **await retrain_unsupervised_pipeline()}
        except ValueError:
            await recompute_population_benchmarks()
            return {"mode": "percentile_recompute_only"}