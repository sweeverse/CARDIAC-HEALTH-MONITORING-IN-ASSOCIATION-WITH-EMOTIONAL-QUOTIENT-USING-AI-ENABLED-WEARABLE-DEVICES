import json
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Query

from app.db import (
    get_db, COL_SUBJECTS, COL_SESSIONS, COL_TIMESERIES,
    COL_INSIGHTS, COL_POPULATION_STATS, COL_USERS, cascade_delete_subject_data,
    COL_SESSIONS_LEGACY_BACKUP, backfill_missing_subject_docs,
)
from app.security import get_current_user, get_current_admin
from app.services.inference import process_uploaded_csv, InferenceUnavailable
from app.services.retrain import retrain_unsupervised_pipeline, recalibrate_after_data_change
from app.models.schemas import IngestResponse, BatchIngestResponse, FileIngestResult
from app.ml_core.eq_questionnaire import EQ_QUESTIONS, score_eq_answers
from app.ml_core.feature_extraction import normalize_subject_id
from app.ml_core.fingerprint import content_fingerprint, FINGERPRINT_VERSION
from app.utils import apply_ist_timestamps, apply_score_formatting, round2, to_ist

router = APIRouter(prefix="/api/subjects", tags=["subjects"])

# How far back an upload still counts as "recent" for the admin dashboard
# panel — anything older than this is cohort history, not a recent upload.
RECENT_UPLOAD_WINDOW = timedelta(hours=24)


def _strip_id(doc):
    """
    The one place every subjects.py response document passes through:
    stringifies _id, converts every known timestamp field to IST (Task 8),
    and rounds every known Heart Health Score / percentile field to
    exactly 2 decimals (Task 9) — storage stays untouched either way, this
    only formats the outgoing response.
    """
    if doc and "_id" in doc:
        doc["_id"] = str(doc["_id"])
    apply_ist_timestamps(doc)
    apply_score_formatting(doc)
    return doc


@router.get("/eq-questionnaire")
async def get_eq_questionnaire(current_user: dict = Depends(get_current_user)):
    """
    The question set itself — same for every subject, doesn't need a subject_id.
    Open to any authenticated user: normal users complete this during the
    Upload Recording flow (new subject) or the Retake flow (existing
    subject); admins additionally reach it via the dedicated Admin EQ
    Management page to back-fill a baseline for subjects that don't have one
    yet. That admin page — not this endpoint — is what's exclusive to admins.
    """
    return {"questions": EQ_QUESTIONS}


@router.get("/{subject_id}/eq-assessment")
async def get_eq_assessment(subject_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    subject_id = normalize_subject_id(subject_id)
    subject = await db[COL_SUBJECTS].find_one({"subject_id": subject_id})
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found.")
    return {
        "subject_id": subject_id,
        "eq_score": subject.get("eq_score"),
        "eq_subscores": subject.get("eq_subscores"),
        "eq_completed_at": to_ist(subject.get("eq_completed_at")),
        "has_completed": subject.get("eq_score") is not None,
    }


def _score_and_store_eq_answers(answers: dict) -> dict:
    """Validates + scores raw EQ answers. Storage (the $set) is left to the
    caller since the two call sites (standalone submit vs. bundled into
    /upload for a brand-new subject) update slightly different documents."""
    valid_ids = {q["id"] for q in EQ_QUESTIONS}
    answers = {k: v for k, v in answers.items() if k in valid_ids}
    if not answers:
        raise HTTPException(status_code=400, detail="No valid answers submitted.")
    return {"answers": answers, **score_eq_answers(answers)}


@router.post("/{subject_id}/eq-assessment")
async def submit_eq_assessment(subject_id: str, payload: dict, current_user: dict = Depends(get_current_user)):
    """
    payload: {"answers": {question_id: 1-5, ...}}
    This is a real, unvalidated self-report EQ-style measure (see
    eq_questionnaire.py) — scored and stored as-given, never fabricated.
    Open to any authenticated user (used by the Retake-questionnaire flow on
    a subject's profile, and by admins backfilling a baseline through the
    Admin EQ Management page for subjects that don't have one yet).
    """
    db = get_db()
    subject_id = normalize_subject_id(subject_id)
    subject = await db[COL_SUBJECTS].find_one({"subject_id": subject_id})
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found.")

    scored = _score_and_store_eq_answers(payload.get("answers") or {})
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    await db[COL_SUBJECTS].update_one(
        {"subject_id": subject_id},
        {"$set": {
            "eq_score": scored["composite"],
            "eq_subscores": scored["subscores"],
            "eq_answers": scored["answers"],
            "eq_completed_at": now,
        }},
    )

    return {
        "subject_id": subject_id,
        "eq_score": scored["composite"],
        "eq_subscores": scored["subscores"],
        "n_answered": scored["n_answered"],
        "eq_completed_at": to_ist(now),
    }


@router.get("")
async def list_subjects(limit: int = Query(50, le=200), skip: int = 0,
                         current_user: dict = Depends(get_current_user)):
    db = get_db()
    is_admin = current_user.get("role") == "admin"
    if is_admin:
        # Cheap self-heal: any registered account whose subject_id was
        # never backed by a subjects document (see ensure_subject_doc /
        # backfill_missing_subject_docs in db.py) gets one created here, so
        # it shows up in Cohort Overview even if it has never uploaded
        # anything — instead of silently vanishing until someone notices.
        await backfill_missing_subject_docs(db)
    query = {} if is_admin else {"subject_id": normalize_subject_id(str(current_user.get("subject_id") or ""))}
    cursor = db[COL_SUBJECTS].find(query).skip(skip).limit(limit)
    docs = [_strip_id(d) async for d in cursor]

    if is_admin:
        # A subject whose owner_user_id no longer resolves to a COL_USERS
        # doc means that user self-deleted their account (DELETE /me,
        # which intentionally keeps the subject's research data per spec
        # section 8 — see routers/auth.py:delete_account). The data stays,
        # but it must stop showing up as a live cohort card once the
        # account behind it is gone. Subjects with no owner_user_id at all
        # (seed/dataset subjects, e.g. S01-S20, that never had a login)
        # are untouched by this check.
        owner_ids = {d["owner_user_id"] for d in docs if d.get("owner_user_id")}
        existing_owner_ids = set()
        if owner_ids:
            valid_oids = [ObjectId(oid) for oid in owner_ids if ObjectId.is_valid(oid)]
            async for u in db[COL_USERS].find({"_id": {"$in": valid_oids}}, {"_id": 1}):
                existing_owner_ids.add(str(u["_id"]))
        docs = [d for d in docs if not d.get("owner_user_id") or d["owner_user_id"] in existing_owner_ids]

    total = len(docs) if is_admin else await db[COL_SUBJECTS].count_documents(query)
    return {"total": total, "subjects": docs}


def _assert_can_view_subject(subject_id: str, current_user: dict):
    """Normal users may only view their OWN subject's detail/sessions —
    Cohort Overview and any direct-link access to another participant's
    detailed data is blocked for non-admins (spec B.2/E)."""
    if current_user.get("role") == "admin":
        return
    if normalize_subject_id(subject_id) != normalize_subject_id(str(current_user.get("subject_id") or "")):
        raise HTTPException(status_code=403, detail="You can only view your own subject data.")


@router.get("/{subject_id}")
async def get_subject(subject_id: str, current_user: dict = Depends(get_current_user)):
    # Normalize before querying — same reasoning as the EQ-assessment
    # endpoints below: a caller (e.g. the Research page, working off an
    # already-canonicalized ID) shouldn't 404 just because the stored
    # subject_id predates normalize_subject_id or was entered in a
    # slightly different form.
    subject_id = normalize_subject_id(subject_id)
    _assert_can_view_subject(subject_id, current_user)
    db = get_db()
    doc = await db[COL_SUBJECTS].find_one({"subject_id": subject_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Subject not found.")
    return _strip_id(doc)


@router.get("/{subject_id}/sessions")
async def get_sessions(subject_id: str, current_user: dict = Depends(get_current_user)):
    _assert_can_view_subject(subject_id, current_user)
    db = get_db()
    cursor = db[COL_SESSIONS].find({"subject_id": subject_id}).sort("recorded_at", -1)
    docs = [_strip_id(d) async for d in cursor]
    if not docs:
        raise HTTPException(status_code=404, detail="No sessions found for this subject.")

    # session_risk_score: a flat average across every window in a whole
    # recording session (all activities uploaded together, sharing
    # session_batch_id — same grouping the frontend uses), weighted by
    # each activity's window_count. Replaces the frontend's old
    # mean-of-activity-averages (SessionsPanel.jsx), which weighted every
    # activity equally regardless of window count and could drift from
    # the subject-level risk score (itself a flat average over all
    # windows) — e.g. 27.30 vs 27.11 on the same data. Computed once here
    # so every session doc in a batch carries the same, already-correct
    # value and nothing needs to recompute it client-side.
    batches = {}
    for d in docs:
        key = d.get("session_batch_id") or d["session_id"]
        batches.setdefault(key, []).append(d)
    for group in batches.values():
        weighted_sum, total_windows = 0.0, 0
        for d in group:
            score, windows = d.get("avg_risk_score"), d.get("window_count") or 0
            if score is not None and windows:
                weighted_sum += score * windows
                total_windows += windows
        session_risk_score = round2(weighted_sum / total_windows) if total_windows else None
        for d in group:
            d["session_risk_score"] = session_risk_score

    return {"subject_id": subject_id, "sessions": docs}


@router.delete("/{subject_id}/sessions/{session_mongo_id}")
async def delete_session(subject_id: str, session_mongo_id: str, current_user: dict = Depends(get_current_user)):
    """
    Deletes one previously-uploaded CSV/session and everything derived from
    it (its windowed time-series + insights). Admins may delete any
    session; a normal user may only delete a session they uploaded
    themselves (spec B.5) — never another participant's data.
    Keyed by the session's Mongo _id (not the session_id string, which is
    reused across repeat occasions of the same activity) so this can never
    accidentally wipe a different recording of the same activity for the
    same subject.
    """
    db = get_db()
    try:
        oid = ObjectId(session_mongo_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid session id.")

    session = await db[COL_SESSIONS].find_one({"_id": oid, "subject_id": subject_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found for this subject.")

    is_admin = current_user.get("role") == "admin"
    if not is_admin and str(session.get("owner_user_id")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="You can only delete sessions you uploaded yourself.")

    await db[COL_SESSIONS].delete_one({"_id": oid})

    ts_result = await db[COL_TIMESERIES].delete_many({"session_doc_id": session_mongo_id})
    insights_result = await db[COL_INSIGHTS].delete_many({"session_doc_id": session_mongo_id})
    if ts_result.deleted_count == 0 and insights_result.deleted_count == 0:
        # Fallback for data inserted before session_doc_id existed (e.g. the
        # seeded dataset) — session_id there is already unique per
        # subject+activity, so matching on it alone is still safe.
        ts_result = await db[COL_TIMESERIES].delete_many({"subject_id": subject_id, "session_id": session["session_id"]})
        insights_result = await db[COL_INSIGHTS].delete_many({"subject_id": subject_id, "session_id": session["session_id"]})

    remaining_sessions = await db[COL_SESSIONS].count_documents({"subject_id": subject_id})
    subject_removed = False
    if remaining_sessions == 0:
        # No recordings left for this subject at all — remove the now-empty
        # subject record too via the shared cascade helper (also sweeps any
        # leftover rows this deletion's targeted matches didn't catch).
        await cascade_delete_subject_data(db, subject_id)
        subject_removed = True

    # Deleting a session changes the dataset just as much as uploading one
    # does — without this, bucket thresholds / risk_score_distribution /
    # every subject's own risk_assessment stayed pinned to whatever they
    # were before the delete, and only updated once someone remembered to
    # visit Settings and click "Recalibrate risk model" by hand.
    await recalibrate_after_data_change()

    return {
        "deleted_session_id": session["session_id"],
        "activity": session.get("activity"),
        "windows_deleted": ts_result.deleted_count,
        "insights_deleted": insights_result.deleted_count,
        "subject_removed": subject_removed,
    }


@router.get("/admin/legacy-sessions")
async def list_legacy_fingerprint_sessions(current_user: dict = Depends(get_current_admin)):
    """
    Finds every session stamped with an older content_fingerprint algorithm
    (or none at all, i.e. pre-dates fingerprinting entirely) — these can
    never correctly match a freshly-uploaded duplicate/replacement, because
    they were hashed under different rules (see FINGERPRINT_VERSION in
    app/ml_core/fingerprint.py). Read-only: tells you exactly what needs a clean
    re-upload, without touching anything yet.
    """
    db = get_db()
    cursor = db[COL_SESSIONS].find(
        {"content_fingerprint_version": {"$ne": FINGERPRINT_VERSION}},
        {"subject_id": 1, "activity": 1, "recorded_at": 1, "content_fingerprint_version": 1},
    ).sort([("subject_id", 1), ("activity", 1)])
    docs = [_strip_id(d) async for d in cursor]
    return {"count": len(docs), "sessions": docs}


@router.post("/admin/legacy-sessions/purge")
async def purge_legacy_fingerprint_sessions(
    subject_id: str | None = Query(
        None, description="Limit the purge to one subject. Omit to purge every legacy "
                           "session across all subjects — get the full list from GET "
                           "/admin/legacy-sessions first and confirm with the user before doing that."
    ),
    current_user: dict = Depends(get_current_admin),
):
    """
    Deletes every legacy-fingerprint session (+ its windows/insights) so the
    next upload of that same CSV inserts clean instead of being treated as
    a new, separate occasion. Every purged session is copied into
    COL_SESSIONS_LEGACY_BACKUP first, so this can be undone (see
    /admin/legacy-sessions/restore) rather than depending on a separate
    mongodump. Nothing under the current FINGERPRINT_VERSION is ever
    touched by this endpoint.
    """
    db = get_db()
    query = {"content_fingerprint_version": {"$ne": FINGERPRINT_VERSION}}
    if subject_id:
        query["subject_id"] = normalize_subject_id(subject_id)

    legacy_sessions = [d async for d in db[COL_SESSIONS].find(query)]
    if not legacy_sessions:
        return {"purged": 0, "message": "No legacy-fingerprint sessions found."}

    backup_docs = [{**s, "purged_at": datetime.now(timezone.utc), "purged_by": str(current_user["_id"])}
                   for s in legacy_sessions]
    await db[COL_SESSIONS_LEGACY_BACKUP].insert_many(backup_docs)

    purged = []
    for s in legacy_sessions:
        session_doc_id = str(s["_id"])
        await db[COL_TIMESERIES].delete_many({"session_doc_id": session_doc_id})
        await db[COL_INSIGHTS].delete_many({"session_doc_id": session_doc_id})
        await db[COL_TIMESERIES].delete_many({"subject_id": s["subject_id"], "session_id": s["session_id"]})
        await db[COL_INSIGHTS].delete_many({"subject_id": s["subject_id"], "session_id": s["session_id"]})
        await db[COL_SESSIONS].delete_one({"_id": s["_id"]})
        purged.append({"subject_id": s["subject_id"], "activity": s.get("activity"),
                        "recorded_at": s.get("recorded_at")})

    return {
        "purged": len(purged),
        "sessions": purged,
        "note": "Re-upload each of these CSVs now — they'll insert clean with the "
                "current fingerprint. Backed up to sessions_legacy_backup if you need to undo.",
    }


@router.post("/admin/legacy-sessions/restore")
async def restore_legacy_fingerprint_sessions(
    subject_id: str | None = Query(None, description="Limit the restore to one subject."),
    current_user: dict = Depends(get_current_admin),
):
    """
    Undo for /admin/legacy-sessions/purge — re-inserts everything from
    COL_SESSIONS_LEGACY_BACKUP back into the live sessions collection.
    Does NOT restore the deleted windows/insights rows (those weren't
    backed up, since they're cheaply regenerable by just re-uploading the
    CSV) — this is a safety net for "wait, I wasn't ready" immediately
    after a purge, not a full point-in-time restore.
    """
    db = get_db()
    query = {}
    if subject_id:
        query["subject_id"] = normalize_subject_id(subject_id)

    backups = [d async for d in db[COL_SESSIONS_LEGACY_BACKUP].find(query)]
    if not backups:
        return {"restored": 0, "message": "No backed-up sessions found."}

    restored = []
    for b in backups:
        b.pop("purged_at", None)
        b.pop("purged_by", None)
        await db[COL_SESSIONS].insert_one(b)
        await db[COL_SESSIONS_LEGACY_BACKUP].delete_one({"_id": b["_id"]})
        restored.append({"subject_id": b["subject_id"], "activity": b.get("activity")})

    return {"restored": len(restored), "sessions": restored}


@router.get("/{subject_id}/sessions/{activity}/timeseries")
async def get_timeseries(subject_id: str, activity: str,
                          session_id: str | None = None,
                          current_user: dict = Depends(get_current_user)):
    """
    Returns the windowed biomarker time series that drives every chart on
    the dashboard: Heart Rate, RMSSD, SDNN, RR Interval, Stress Index,
    Recovery Rate, SpO2, skin/environmental temperature.
    """
    _assert_can_view_subject(subject_id, current_user)
    db = get_db()
    query = {"subject_id": subject_id, "activity": activity}
    if session_id:
        query["session_id"] = session_id
    # session_id embeds a UTC timestamp (subject_activity_YYYYmmddTHHMMSS), so
    # sorting by it first is chronological — this matters once a subject has
    # more than one recording of the same activity (Task: longitudinal
    # uploads). window_index resets to 0 at the start of every session, so
    # sorting by window_index alone would interleave windows from different
    # sessions together instead of appending each new session's data after
    # the last, corrupting every HR/HRV/Stress chart that reads this.
    cursor = db[COL_TIMESERIES].find(query).sort([("session_id", 1), ("window_index", 1)])
    docs = [_strip_id(d) async for d in cursor]
    if not docs:
        raise HTTPException(status_code=404, detail="No time-series data found for this subject/activity.")
    return {"subject_id": subject_id, "activity": activity, "windows": docs}


@router.get("/{subject_id}/insights")
async def get_insights(subject_id: str, activity: str | None = None, session_id: str | None = None,
                        current_user: dict = Depends(get_current_user)):
    _assert_can_view_subject(subject_id, current_user)
    db = get_db()
    query = {"subject_id": subject_id}
    if activity:
        query["activity"] = activity
    if session_id:
        query["session_id"] = session_id
    cursor = db[COL_INSIGHTS].find(query)
    docs = [_strip_id(d) async for d in cursor]
    return {"subject_id": subject_id, "insights": docs}


@router.get("/{subject_id}/explainability")
async def get_explainability(subject_id: str, current_user: dict = Depends(get_current_user)):
    """Plain-language driver explanations + Heart Health Score breakdown — the core of the XAI module."""
    _assert_can_view_subject(subject_id, current_user)
    db = get_db()
    subject = await db[COL_SUBJECTS].find_one({"subject_id": subject_id})
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found.")

    pop_stats = await db[COL_POPULATION_STATS].find_one({"_id": "global"})
    return {
        "subject_id": subject_id,
        "risk_assessment": subject.get("risk_assessment"),
        "heart_health_score": round2(subject.get("heart_health_score")),
        "heart_health_score_breakdown": subject.get("heart_health_score_breakdown"),
        "reference_ranges": (pop_stats or {}).get("reference_ranges"),
        "model_info": (pop_stats or {}).get("model_info"),
    }


@router.get("/{subject_id}/population")
async def get_population_comparison(subject_id: str, current_user: dict = Depends(get_current_user)):
    _assert_can_view_subject(subject_id, current_user)
    db = get_db()
    subject = await db[COL_SUBJECTS].find_one({"subject_id": subject_id})
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found.")
    pop_stats = await db[COL_POPULATION_STATS].find_one({"_id": "global"})

    # Pull this subject's most recent session for its actual environmental
    # readings (env_temp_c, env_humidity_pct) and recorded heart rate, so the
    # BMI/environment insight below can be personalized instead of generic.
    latest_session = await db[COL_SESSIONS].find_one(
        {"subject_id": subject_id}, sort=[("recorded_at", -1)]
    )

    risk_score = (subject.get("risk_assessment") or {}).get("risk_score")
    risk_score_distribution = (pop_stats or {}).get("risk_score_distribution") or []

    # cohort_comparison: the backend-computed interpretation of this
    # subject's risk score against the cohort, so the frontend never has to
    # average the distribution or decide the better/similar/worse wording
    # itself. risk_score is LOWER-is-better (same convention used by the
    # session-over-session trend in get_longitudinal below), so sitting
    # notably BELOW the cohort average is "better than cohort", not worse.
    # The +/-2 point band mirrors the same "stable" tolerance used there.
    cohort_scores = [d["risk_score"] for d in risk_score_distribution if d.get("risk_score") is not None]
    cohort_avg_risk_score = round2(sum(cohort_scores) / len(cohort_scores)) if cohort_scores else None
    cohort_comparison = None
    if risk_score is not None and cohort_avg_risk_score is not None:
        diff = round2(risk_score - cohort_avg_risk_score)
        classification = (
            "worse than cohort" if diff >= 2 else
            "better than cohort" if diff <= -2 else
            "similar to cohort"
        )
        cohort_comparison = {
            "subject_risk_score": risk_score,
            "cohort_avg_risk_score": cohort_avg_risk_score,
            "difference_from_cohort": diff,
            "classification": classification,
        }

    return {
        "subject_id": subject_id,
        "population_percentile": {k: round2(v) for k, v in (subject.get("population_percentile") or {}).items()} or None,
        "similar_cohort_percentile": {k: round2(v) for k, v in (subject.get("similar_cohort_percentile") or {}).items()} or None,
        "cohort_reference": (pop_stats or {}).get("features"),
        "cohort_size": (pop_stats or {}).get("cohort_size"),
        "demographics": subject.get("demographics"),
        # NEW: this subject's unsupervised risk_score plus the full cohort's
        # distribution, so the frontend can show where it falls among peers —
        # additive fields only, doesn't change anything existing consumers read.
        "risk_score": risk_score,
        "risk_score_distribution": risk_score_distribution,
        "cohort_avg_risk_score": cohort_avg_risk_score,
        "cohort_comparison": cohort_comparison,
        # NEW: bucket cutpoints so the frontend can shade a "normal range"
        # band and color-code points by risk bucket (Task 19 2D visualization).
        "bucket_thresholds": ((pop_stats or {}).get("model_info") or {}).get("bucket_thresholds"),
        "latest_session_env": {
            "activity": latest_session.get("activity"),
            "env_temp_c": latest_session.get("env_temp_c"),
            "env_humidity_pct": latest_session.get("env_humidity_pct"),
            "avg_heart_rate": latest_session.get("avg_heart_rate"),
        } if latest_session else None,
    }


@router.get("/{subject_id}/longitudinal")
async def get_longitudinal(subject_id: str, current_user: dict = Depends(get_current_user)):
    """
    Session-wise comparison ordered by actual recording time (recorded_at).
    A trend is only ever computed between two sessions of the SAME activity
    recorded at two different times/occasions for this subject — heart
    rate/HRV baselines genuinely differ by activity, so a 'sit' session is
    never compared against a 'run' session, and a single lone session for
    an activity never produces a trend claim.

    Trend direction is derived from avg_risk_score — the SAME anomaly-based
    metric that drives this subject's risk label — not avg_heart_health_score
    (still included per session for anything still reading it, but no
    longer drives has_qualifying_trend/trend/delta). risk_score is LOWER-is-
    better, the inverse of the old heart_health_score direction, so the
    comparison signs below are intentionally flipped from what they'd be
    for a higher-is-better metric.
    """
    _assert_can_view_subject(subject_id, current_user)
    db = get_db()
    cursor = db[COL_SESSIONS].find({"subject_id": subject_id}).sort("recorded_at", 1)
    sessions = [_strip_id(d) async for d in cursor]
    if not sessions:
        raise HTTPException(status_code=404, detail="No session history for this subject.")

    pop_stats = await db[COL_POPULATION_STATS].find_one({"_id": "global"})
    bucket_thresholds = ((pop_stats or {}).get("model_info") or {}).get("bucket_thresholds")

    timeline = [{
        "session_id": s["session_id"],
        "activity": s["activity"],
        "recorded_at": s.get("recorded_at"),
        "session_batch_id": s.get("session_batch_id") or s["session_id"],  # fallback for any older docs without it
        "avg_risk_score": s.get("avg_risk_score"),
        "avg_heart_health_score": s.get("avg_heart_health_score"),
        "avg_heart_rate": s.get("avg_heart_rate"),
        "avg_rmssd": s.get("avg_rmssd"),
        "avg_stress_index": s.get("avg_stress_index"),
    } for s in sessions]

    # Walk the chronological timeline and, for each session, find the most
    # recent PRIOR session of the same activity (a genuine repeat occasion).
    # This is what makes the report session-wise: every row can carry its
    # own delta against its own last occurrence, instead of a single
    # activity-level bucket summary.
    last_seen: dict[str, dict] = {}
    for t in timeline:
        prev = last_seen.get(t["activity"])
        if prev and t["avg_risk_score"] is not None and prev["avg_risk_score"] is not None:
            delta = t["avg_risk_score"] - prev["avg_risk_score"]
            t["delta_from_previous_same_activity"] = round(delta, 1)
            t["previous_same_activity_date"] = prev["recorded_at"]
            t["trend_vs_previous"] = "declining" if delta > 2 else ("improving" if delta < -2 else "stable")
        else:
            t["delta_from_previous_same_activity"] = None
            t["previous_same_activity_date"] = None
            t["trend_vs_previous"] = None
        last_seen[t["activity"]] = t

    # An activity only "qualifies" for a trend if it has 2+ sessions recorded
    # at two different timestamps/occasions — a single session never qualifies.
    by_activity: dict[str, list[dict]] = {}
    for t in timeline:
        by_activity.setdefault(t["activity"], []).append(t)

    qualifying_activities = {
        act: pts for act, pts in by_activity.items()
        if len({p["recorded_at"] for p in pts}) >= 2
    }
    has_qualifying_trend = len(qualifying_activities) > 0

    # Overall trend is only ever derived from activities that qualify —
    # never by comparing across different activity types.
    trend = None
    if has_qualifying_trend:
        deltas = []
        for pts in qualifying_activities.values():
            scores = [p["avg_risk_score"] for p in pts if p["avg_risk_score"] is not None]
            if len(scores) >= 2:
                deltas.append(scores[-1] - scores[0])
        if deltas:
            avg_delta = sum(deltas) / len(deltas)
            trend = "declining" if avg_delta > 2 else ("improving" if avg_delta < -2 else "stable")

    activity_trends = {}
    for act, points in by_activity.items():
        qualifies = act in qualifying_activities
        act_scores = [p["avg_risk_score"] for p in points if p["avg_risk_score"] is not None]
        act_trend = None
        if qualifies and len(act_scores) >= 2:
            d = act_scores[-1] - act_scores[0]
            act_trend = "declining" if d > 2 else ("improving" if d < -2 else "stable")
        activity_trends[act] = {"sessions": points, "trend": act_trend, "session_count": len(points), "qualifies_for_trend": qualifies}

    return {
        "subject_id": subject_id,
        "timeline": timeline,
        "trend": trend,
        "has_qualifying_trend": has_qualifying_trend,
        "by_activity": activity_trends,
        "single_session_warning": len(timeline) < 2,
        "bucket_thresholds": bucket_thresholds,
    }


# Bumped whenever _content_fingerprint()'s algorithm changes (e.g. the Task 5
# fix here: excluding drifting bmi/age columns + sorting rows/columns).
# Sessions inserted under an older version can never correctly match a
# freshly-computed fingerprint — see /admin/legacy-sessions below, which
# uses this to find exactly the sessions that need a clean re-upload.
# (Moved to app/ml_core/fingerprint.py so ml-pipeline/build_dataset.py can
# share the exact same algorithm when seeding — imported above.)


@router.post("/upload", response_model=BatchIngestResponse)
async def upload_subject_recordings(
    subject_id: str | None = Form(
        None, description="ADMIN ONLY. Normal users are never asked for this — their own "
                           "subject_id (assigned at signup) is used automatically."
    ),
    activity: str | None = Form(
        None, description="Used for every file unless a per-file activity can be detected from its filename "
                           "(e.g. S21_walk.csv -> walk). Required if filenames don't carry an activity hint."
    ),
    bmi: float | None = Form(None),
    age: float | None = Form(None),
    height_cm: float | None = Form(None),
    weight_kg: float | None = Form(None),
    eq_answers: str | None = Form(
        None, description="JSON-encoded {question_id: 1-5, ...}. Optional — lets a brand-new subject's "
                           "mandatory baseline EQ questionnaire (Task 12) be submitted in the SAME request "
                           "that creates them, since they don't exist yet to submit against beforehand."
    ),
    files: list[UploadFile] = File(..., description="1-4 sensor CSVs. Each is processed independently; "
                                                       "one bad file doesn't block the others."),
    confirm_replace: bool = Form(
        False, description="Set true when the file is an exact-data match for an existing recording of the "
                            "same subject+activity, to overwrite it instead of being blocked with an "
                            "exact-match conflict."
    ),
    confirm_add: bool = Form(
        False, description="Set true when the file is a genuinely new recording occasion for a subject+"
                            "activity that already has data (different content) — appends it as an "
                            "additional longitudinal session instead of being blocked with a new-session "
                            "conflict. Nothing existing is deleted."
    ),
    current_user: dict = Depends(get_current_user),
):
    """
    Accepts 1-4 raw sensor CSVs in a single request (same column schema as
    the training cohort: timestamp, beat, inst_bpm, gsr_conductance_us,
    accel_x/y/z, SpO2, temp_c, bmi, age, env_temp_c, env_humidity_pct).
    Each file is windowed, risk-scored, and inserted independently — if one
    file fails validation, the others still process and the response
    reports per-file success/failure so the user knows exactly what happened.

    Per-file activity is detected from the filename when it ends in
    `_<activity>` (e.g. `S21_walk_modified.csv`, `S21_walk.csv` ->
    activity="walk"); otherwise it falls back to the `activity` form field.

    SUBJECT RESOLUTION (spec B.1 / C.2):
      - Normal users can never type a subject_id — this is completely
        automatic and invisible to them. Their own subject_id (assigned at
        signup, see routers/auth.py) is always used, and their height/weight
        are pulled from their stored profile rather than asked for again.
      - Admins may target ANY subject_id (creating a brand-new one or
        updating an existing participant) and must supply age/height/weight
        for that subject (auto-computed into BMI).
    """
    is_admin = current_user.get("role") == "admin"

    if is_admin:
        if not subject_id:
            raise HTTPException(status_code=400, detail="Subject Number is required for admin uploads.")
        if age is None or height_cm is None or weight_kg is None:
            raise HTTPException(status_code=400, detail="Age, height, and weight are required before uploading or modifying subject data.")
        subject_id = normalize_subject_id(subject_id)
    else:
        # Completely automatic + invisible: use the logged-in user's own
        # subject_id, never a caller-supplied one.
        subject_id = current_user.get("subject_id")
        if not subject_id:
            raise HTTPException(status_code=400, detail="Your account isn't linked to a Subject ID yet. Please contact an administrator.")
        subject_id = normalize_subject_id(subject_id)
        # Height/weight/age always come from the user's own profile — never
        # asked for again during upload.
        height_cm = current_user.get("height_cm")
        weight_kg = current_user.get("weight_kg")
        age = current_user.get("age") if age is None else age

    if height_cm and weight_kg:
        height_m = height_cm / 100
        bmi = round(weight_kg / (height_m * height_m), 1)

    if not files:
        raise HTTPException(status_code=400, detail="At least one CSV file is required.")
    if len(files) > 4:
        raise HTTPException(status_code=400, detail="Up to 4 files can be uploaded at once.")

    db = get_db()
    now = datetime.now(timezone.utc)
    # Every file in THIS upload call was submitted together by the user in one
    # sitting, so they all belong to the same logical recording session —
    # tag them with one shared batch id so the Longitudinal chart can color
    # them identically instead of one color per activity (see LongitudinalPanel.jsx).
    session_batch_id = f"{subject_id}_{now.strftime('%Y%m%dT%H%M%S')}"
    file_results: list[FileIngestResult] = []

    KNOWN_ACTIVITIES = {"sit", "walk", "run", "cog"}
    eq_applied = False  # only write the bundled EQ answers once per call, not once per file

    for upload in files:
        filename = upload.filename or "unnamed.csv"
        try:
            detected_activity = _detect_activity_from_filename(filename, KNOWN_ACTIVITIES)
            file_activity = detected_activity or activity
            if not file_activity:
                raise ValueError(
                    f"Couldn't detect an activity from the filename \"{filename}\" "
                    f"(expected it to end in _sit/_walk/_run/_cog), and no activity "
                    f"was selected for this upload."
                )

            content = await upload.read()
            if not content:
                raise ValueError("File is empty.")

            # --- Duplicate / repeat-occasion handling: a subject can now
            # legitimately have MULTIPLE recordings of the same activity
            # over time (e.g. a 'walk' session recorded again a week
            # later) — this is the longitudinal dataset, not a mistake.
            # A subject's BMI/age/weight naturally drifts between
            # occasions too, so none of that is used to judge this either;
            # only the file's own recorded sensor DATA decides what kind
            # of upload this is, compared against every existing
            # occasion of this subject+activity:
            #   - matches an existing occasion exactly -> the exact same
            #     recording was uploaded again; block unless confirmed,
            #     then REPLACE that occasion in place.
            #   - matches no existing occasion -> a genuinely new
            #     recording session for an activity that already has
            #     data; block unless confirmed, then ADD it as an
            #     additional occasion — nothing existing is touched, and
            #     every longitudinal/HRV/HR/Stress chart for this
            #     activity picks it up automatically since they read
            #     every session, not just one.
            #   - no existing occasions at all -> first recording for
            #     this subject+activity, nothing to conflict with.
            existing_sessions = [d async for d in db[COL_SESSIONS].find(
                {"subject_id": subject_id, "activity": file_activity}
            ).sort("recorded_at", -1)]
            new_fingerprint = content_fingerprint(content)
            exact_match = next((s for s in existing_sessions if s.get("content_fingerprint") == new_fingerprint), None)

            if exact_match and not confirm_replace:
                file_results.append(FileIngestResult(
                    filename=filename, success=False, activity=file_activity,
                    requires_confirmation=True, conflict_type="exact_match",
                    warning=(f"This is an exact match for {subject_id}'s {file_activity} recording from "
                             f"{exact_match.get('recorded_at')} — the data is identical. Replace it, or skip this file."),
                    error=(f"This is an exact match for {subject_id}'s {file_activity} recording from "
                           f"{exact_match.get('recorded_at')} — the data is identical. Replace it, or skip this file."),
                ))
                continue
            if not exact_match and existing_sessions and not confirm_add and not confirm_replace:
                file_results.append(FileIngestResult(
                    filename=filename, success=False, activity=file_activity,
                    requires_confirmation=True, conflict_type="new_session",
                    warning=(f"{subject_id} already has {len(existing_sessions)} {file_activity} recording"
                             f"{'s' if len(existing_sessions) != 1 else ''} on file, and this one's data is "
                             f"different — looks like a new recording occasion. Add it to the longitudinal "
                             f"dataset, or skip this file."),
                    error=(f"{subject_id} already has {len(existing_sessions)} {file_activity} recording"
                           f"{'s' if len(existing_sessions) != 1 else ''} on file, and this one's data is "
                           f"different — looks like a new recording occasion. Add it to the longitudinal "
                           f"dataset, or skip this file."),
                ))
                continue

            if exact_match and confirm_replace:
                old_session_id = str(exact_match["_id"])
                await db[COL_SESSIONS].delete_one({"_id": exact_match["_id"]})
                await db[COL_TIMESERIES].delete_many({"session_doc_id": old_session_id})
                await db[COL_INSIGHTS].delete_many({"session_doc_id": old_session_id})
                # fallback for sessions inserted before session_doc_id existed
                await db[COL_TIMESERIES].delete_many({"subject_id": subject_id, "session_id": exact_match["session_id"]})
                await db[COL_INSIGHTS].delete_many({"subject_id": subject_id, "session_id": exact_match["session_id"]})
            # else: brand-new occasion (no existing sessions), or an explicitly
            # confirmed ADD of a new occasion alongside existing ones — either
            # way nothing gets deleted, we just insert below.

            result = process_uploaded_csv(content, subject_id, file_activity)

            session_doc = {
                **result["session"], "recorded_at": now, "owner_user_id": current_user["_id"],
                "session_batch_id": session_batch_id, "content_fingerprint": new_fingerprint,
                "content_fingerprint_version": FINGERPRINT_VERSION, "source_filename": filename,
            }
            insert_res = await db[COL_SESSIONS].insert_one(session_doc)
            session_doc_id = str(insert_res.inserted_id)

            # Tag every window/insight with the exact session doc that owns it
            # (not just the session_id string, which is reused across repeat
            # occasions of the same activity) — this is what lets deletion
            # (see DELETE /{subject_id}/sessions/{session_id} below) remove
            # precisely this occurrence's rows without touching an earlier
            # or later recording of the same activity.
            for w in result["windows"]:
                w["session_doc_id"] = session_doc_id
            for ins in result["insights"]:
                ins["session_doc_id"] = session_doc_id

            if result["windows"]:
                await db[COL_TIMESERIES].insert_many(result["windows"])
            if result["insights"]:
                await db[COL_INSIGHTS].insert_many(result["insights"])

            existing = await db[COL_SUBJECTS].find_one({"subject_id": subject_id})
            demographics = (existing or {}).get("demographics", {})
            if bmi is not None:
                demographics["bmi"] = bmi
            if age is not None:
                demographics["age"] = age
            if height_cm is not None:
                demographics["height_cm"] = height_cm
            if weight_kg is not None:
                demographics["weight_kg"] = weight_kg

            await db[COL_SUBJECTS].update_one(
                {"subject_id": subject_id},
                {"$set": {
                    "subject_id": subject_id,
                    "demographics": demographics,
                    "risk_assessment": result["risk_assessment"],
                    "heart_health_score": result["heart_health_score"],
                    "owner_user_id": current_user["_id"],
                    "updated_at": now,
                }, "$setOnInsert": {"created_at": now}},
                upsert=True,
            )

            if eq_answers and not eq_applied:
                try:
                    raw_answers = json.loads(eq_answers)
                    scored = _score_and_store_eq_answers(raw_answers)
                    await db[COL_SUBJECTS].update_one(
                        {"subject_id": subject_id},
                        {"$set": {
                            "eq_score": scored["composite"],
                            "eq_subscores": scored["subscores"],
                            "eq_answers": scored["answers"],
                            "eq_completed_at": now.isoformat().replace("+00:00", "Z"),
                        }},
                    )
                    eq_applied = True
                except (json.JSONDecodeError, HTTPException):
                    # Don't fail the whole upload over a malformed/empty EQ
                    # payload — the recording itself still succeeded.
                    pass

            file_results.append(FileIngestResult(
                filename=filename, success=True, activity=file_activity,
                result=IngestResponse(
                    subject_id=subject_id,
                    sessions_created=1,
                    windows_created=len(result["windows"]),
                    insights_created=len(result["insights"]),
                    heart_health_score=result["heart_health_score"],
                    risk_score=result["risk_assessment"]["risk_score"],
                    predicted_risk_class=result["risk_assessment"]["predicted_class"],
                ),
            ))
        except InferenceUnavailable as e:
            file_results.append(FileIngestResult(filename=filename, success=False, error=str(e)))
        except ValueError as e:
            file_results.append(FileIngestResult(filename=filename, success=False, error=str(e)))
        except Exception as e:
            file_results.append(FileIngestResult(
                filename=filename, success=False,
                error=f"Unexpected error while processing this file: {e}",
            ))

    succeeded = sum(1 for f in file_results if f.success)

    if succeeded > 0:
        # Refits the unsupervised model end-to-end (bucket thresholds,
        # reference ranges, every subject's risk_assessment, the cohort-wide
        # risk_score_distribution) — not just percentile/benchmark display
        # fields. Falls back to the lighter percentile-only recompute if a
        # full retrain isn't viable yet (< 10 windows total). See
        # services/retrain.py::recalibrate_after_data_change.
        await recalibrate_after_data_change()

    return BatchIngestResponse(
        total_files=len(file_results),
        succeeded=succeeded,
        failed=len(file_results) - succeeded,
        files=file_results,
    )


def _detect_activity_from_filename(filename: str, known_activities: set[str]) -> str | None:
    stem = filename.rsplit(".", 1)[0].lower()
    stem = stem.replace("_modified", "")
    for act in known_activities:
        if stem.endswith(f"_{act}") or stem == act:
            return act
    return None


@router.delete("/{subject_id}")
async def admin_delete_subject(subject_id: str, current_admin: dict = Depends(get_current_admin)):
    """
    Admin-only full purge of one cohort subject and every piece of their
    data (recordings, windows, insights, the subject doc itself). Covers
    the case admin_delete_user (auth.py) can't: seed/dataset subjects
    (e.g. S01-S20) that were never linked to a login account, and so
    never show up in Admin User Management's user list. If a login
    account happens to be linked to this subject_id, it's removed too so
    the two "delete a subject" paths stay in sync.
    """
    db = get_db()
    subject_id = normalize_subject_id(subject_id)
    subject = await db[COL_SUBJECTS].find_one({"subject_id": subject_id})
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found.")

    linked_user = await db[COL_USERS].find_one({"subject_id": subject_id})
    if linked_user:
        if linked_user.get("role") == "admin":
            raise HTTPException(status_code=403, detail="The administrator account can't be deleted.")
        await db[COL_USERS].delete_one({"_id": linked_user["_id"]})

    cascade_result = await cascade_delete_subject_data(db, subject_id)
    await recalibrate_after_data_change()

    return {
        "message": f"{subject_id} and all associated data deleted.",
        "deleted_subject_id": subject_id,
        **cascade_result,
    }


@router.get("/admin/recent-sessions")
async def admin_recent_sessions(limit: int = 25, current_admin: dict = Depends(get_current_admin)):
    """
    Admin Settings > Data & Model (Task 14): "Display uploaded sessions
    immediately. Show upload time, subject, recording, processing status."
    Every session doc here only exists once its upload finished processing
    successfully, so "processed" is the correct status for all of them —
    a failed file never gets this far (see upload_subject_recordings).

    Every session uploaded in the last RECENT_UPLOAD_WINDOW (24h), most
    recent first — not just the single most recent upload *operation*
    (session_batch_id) like this used to be. That older scoping meant a
    second admin (or the same admin uploading two different subjects a few
    minutes apart) would completely hide the earlier upload from this
    list, even though it was just as "recent". Each entry carries its own
    subject_id, activity, and (for anything uploaded since this field was
    added — see upload_subject_recordings) source_filename, so multiple
    files for the same subject each show up as their own row instead of
    being collapsed into one.

    recorded_at is a mix of real datetimes (live uploads) and ISO strings
    (the offline-seeded cohort, backdated to a synthetic May date) — same
    per-doc parsing the single-latest-doc version of this endpoint used,
    just applied while walking the sorted cursor instead of to one doc.
    """
    db = get_db()
    cutoff = datetime.now(timezone.utc) - RECENT_UPLOAD_WINDOW
    cursor = db[COL_SESSIONS].find({}).sort("recorded_at", -1).limit(max(limit * 3, 50))

    recent = []
    async for d in cursor:
        recorded_at = d.get("recorded_at")
        recorded_dt = None
        if isinstance(recorded_at, str):
            try:
                recorded_dt = datetime.fromisoformat(recorded_at.replace("Z", "+00:00"))
            except ValueError:
                recorded_dt = None
        elif isinstance(recorded_at, datetime):
            recorded_dt = recorded_at if recorded_at.tzinfo else recorded_at.replace(tzinfo=timezone.utc)

        if recorded_dt is not None and recorded_dt >= cutoff:
            recent.append(d)
        if len(recent) >= limit:
            break

    return {"sessions": [_strip_id(d) for d in recent]}


@router.post("/admin/retrain-pipeline")
async def admin_retrain_pipeline(current_admin: dict = Depends(get_current_admin)):
    """
    Admin-only (Task 7 / Task 11 "retrain unsupervised pipeline"): refits
    the GMM + Isolation Forest model from every window currently in Mongo
    (not just the original seed cohort), re-derives reference ranges,
    rescores every subject + window, and refreshes cohort analytics.
    This is what Settings > Data & Model > "Recalibrate risk model" calls.
    """
    try:
        summary = await retrain_unsupervised_pipeline()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return summary