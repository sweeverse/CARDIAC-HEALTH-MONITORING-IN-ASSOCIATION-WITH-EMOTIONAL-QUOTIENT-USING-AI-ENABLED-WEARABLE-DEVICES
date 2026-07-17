"""
MongoDB connection (Motor async driver).

NETWORK NOTE: MongoDB Atlas (mongodb+srv://...) requires outbound network
access to *.mongodb.net. If you're running this behind a restrictive
firewall/proxy, make sure that domain is allow-listed, or point
MONGODB_URI at a self-hosted/local MongoDB instance instead.
"""

from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient
from app.config import settings

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(settings.MONGODB_URI)
    return _client


def get_db():
    return get_client()[settings.MONGODB_DB_NAME]


# Collection name constants — single source of truth, mirrors ml-pipeline/build_dataset.py
COL_USERS = "users"
COL_SUBJECTS = "subjects"
COL_SESSIONS = "sessions"
COL_TIMESERIES = "timeseries_features"
COL_INSIGHTS = "insights"
COL_POPULATION_STATS = "population_stats"
COL_PASSWORD_RESETS = "password_resets"
# Safety-net copy of sessions purged by the /admin/legacy-sessions cleanup
# (see routers/subjects.py) — lets a bad purge be restored instead of
# depending on a separate mongodump.
COL_SESSIONS_LEGACY_BACKUP = "sessions_legacy_backup"


async def ensure_indexes():
    db = get_db()
    await db[COL_USERS].create_index("email", unique=True)
    await db[COL_SUBJECTS].create_index("subject_id", unique=True)
    await db[COL_SUBJECTS].create_index("owner_user_id")
    await db[COL_SESSIONS].create_index([("subject_id", 1), ("activity", 1)])
    await db[COL_SESSIONS].create_index("recorded_at")
    await db[COL_TIMESERIES].create_index([("session_id", 1), ("window_index", 1)])
    await db[COL_TIMESERIES].create_index("subject_id")
    await db[COL_INSIGHTS].create_index("subject_id")
    await db[COL_PASSWORD_RESETS].create_index("token", unique=True)
    await db[COL_PASSWORD_RESETS].create_index("expires_at", expireAfterSeconds=0)


async def next_available_subject_id() -> str:
    """Next unused Subject ID (S1, S2, ...), never entered manually (A.1.3)."""
    import re
    db = get_db()
    max_n = 0
    async for doc in db[COL_SUBJECTS].find({}, {"subject_id": 1}):
        m = re.match(r"^[A-Za-z]*(\d+)$", str(doc.get("subject_id") or ""))
        if m:
            max_n = max(max_n, int(m.group(1)))
    async for doc in db[COL_USERS].find({"subject_id": {"$ne": None}}, {"subject_id": 1}):
        m = re.match(r"^[A-Za-z]*(\d+)$", str(doc.get("subject_id") or ""))
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"S{max_n + 1:02d}"


async def ensure_subject_doc(db, subject_id: str, owner_user_id: str) -> None:
    """Idempotently make sure a COL_SUBJECTS document exists for a user's
    assigned subject_id. Shared by signup, admin-create-user, and the
    self-heal backfill below, so there's exactly one place that knows what
    a "freshly assigned, no uploads yet" subject document looks like."""
    await db[COL_SUBJECTS].update_one(
        {"subject_id": subject_id},
        {
            "$set": {"subject_id": subject_id, "owner_user_id": owner_user_id},
            "$setOnInsert": {"demographics": {"age": None, "bmi": None, "height_cm": None, "weight_kg": None}},
        },
        upsert=True,
    )


async def backfill_missing_subject_docs(db) -> int:
    """
    Self-heals accounts that were assigned a subject_id at signup but never
    got a matching COL_SUBJECTS document — e.g. because the request failed
    partway through (network blip / transient DB error) after the user was
    already inserted but before the subjects upsert ran. Left unfixed, that
    account can log in and use the app, but is invisible everywhere the
    Cohort Overview and other admin views read from COL_SUBJECTS, and its
    already-consumed subject_id makes next_available_subject_id() skip
    straight past it for every later signup. Called opportunistically (not
    on every request) from the admin cohort listing and from /auth/me, so
    the gap closes itself the next time anyone looks rather than needing a
    manual fix. Returns how many were healed, for logging/telemetry.
    """
    healed = 0
    async for user in db[COL_USERS].find({"subject_id": {"$ne": None}}, {"subject_id": 1}):
        subject_id = user.get("subject_id")
        if not subject_id:
            continue
        existing = await db[COL_SUBJECTS].find_one({"subject_id": subject_id}, {"_id": 1})
        if existing:
            continue
        await ensure_subject_doc(db, subject_id, str(user["_id"]))
        healed += 1
    return healed


async def cascade_delete_subject_data(db, subject_id: str) -> dict:
    """
    Single source of truth for what "fully remove a subject's data" means:
    every recording (session), every extracted feature/window, every
    insight, and the subject document itself (which carries risk score,
    heart health score, EQ score/questionnaire answers, and percentile
    data — this app keeps those embedded on the subject doc rather than in
    separate collections). Imported by both the admin Delete User endpoint
    (routers/auth.py) and delete_session's "no recordings left" cleanup
    (routers/subjects.py), so there is exactly one cascade-delete
    implementation, not two that could drift apart (Task 1 / Task 4).
    """
    sessions_result = await db[COL_SESSIONS].delete_many({"subject_id": subject_id})
    timeseries_result = await db[COL_TIMESERIES].delete_many({"subject_id": subject_id})
    insights_result = await db[COL_INSIGHTS].delete_many({"subject_id": subject_id})
    subject_result = await db[COL_SUBJECTS].delete_one({"subject_id": subject_id})
    return {
        "sessions_deleted": sessions_result.deleted_count,
        "windows_deleted": timeseries_result.deleted_count,
        "insights_deleted": insights_result.deleted_count,
        "subject_deleted": subject_result.deleted_count > 0,
    }


async def ensure_admin_account():
    """
    Bootstrap the single hardcoded administrator account on startup.
    This account is entirely separate from the normal signup flow in
    routers/auth.py (which always creates role="clinician" users) — it's
    upserted directly here from app.config.settings, so it can never be
    created, duplicated, or its role escalated through any public endpoint.
    Safe to call every startup: it only creates the doc once, then just
    re-affirms role="admin" and the configured password on subsequent boots.
    """
    from app.security import hash_password  # local import avoids circular import

    db = get_db()
    email = settings.ADMIN_EMAIL.lower()
    await db[COL_USERS].update_one(
        {"email": email},
        {
            "$set": {
                "full_name": settings.ADMIN_FULL_NAME,
                "email": email,
                "hashed_password": hash_password(settings.ADMIN_PASSWORD),
                "role": "admin",
            },
            "$setOnInsert": {
                "organization": None,
                "eq_score": None,
                "created_at": datetime.now(timezone.utc),
            },
        },
        upsert=True,
    )

