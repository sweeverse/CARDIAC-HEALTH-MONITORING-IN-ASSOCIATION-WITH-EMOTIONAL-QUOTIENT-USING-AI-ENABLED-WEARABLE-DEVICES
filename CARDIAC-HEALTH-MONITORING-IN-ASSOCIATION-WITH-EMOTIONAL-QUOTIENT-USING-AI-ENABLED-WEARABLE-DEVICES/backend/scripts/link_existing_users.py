"""
One-time backfill for users who registered BEFORE the EMAIL_SUBJECT_MAP
feature existed (or before subject_id normalization was added). Their
COL_USERS doc has subject_id = null (or a non-canonical value like "S2"
instead of "S02"), which is why:
  - Upload Recording shows "Your account isn't linked to a Subject ID yet."
  - Cohort Overview shows "Upload your first recording..." even though
    their real subject already has data in COL_SUBJECTS.

Safe to re-run (idempotent). Does NOT touch COL_SUBJECTS' existing data —
only sets/repairs subject_id on the user doc and upserts the owner_user_id
link, same as routers/auth.py::signup does for new signups.

Usage:
  cd backend
  python scripts/link_existing_users.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import EMAIL_SUBJECT_MAP, settings
from app.db import get_db, COL_USERS, COL_SUBJECTS
from app.ml_core.feature_extraction import normalize_subject_id


async def main():
    db = get_db()
    await db.command("ping")
    print(f"Connected to {settings.MONGODB_DB_NAME}.\n")

    for email, raw_subject_id in EMAIL_SUBJECT_MAP.items():
        subject_id = normalize_subject_id(raw_subject_id)
        user = await db[COL_USERS].find_one({"email": email})
        if not user:
            print(f"  - {email}: no account yet (will link automatically at signup)")
            continue

        current = user.get("subject_id")
        if normalize_subject_id(str(current or "")) == subject_id:
            print(f"  = {email}: already linked to {subject_id}")
        else:
            await db[COL_USERS].update_one(
                {"_id": user["_id"]},
                {"$set": {"subject_id": subject_id}},
            )
            print(f"  + {email}: subject_id {current!r} -> {subject_id}")

        # Same upsert pattern as signup — creates the subject doc only if
        # missing, otherwise just attaches ownership without touching any
        # existing risk_assessment/session data already seeded for it.
        await db[COL_SUBJECTS].update_one(
            {"subject_id": subject_id},
            {
                "$set": {"subject_id": subject_id, "owner_user_id": str(user["_id"])},
                "$setOnInsert": {"demographics": {"age": None, "bmi": None, "height_cm": None, "weight_kg": None}},
            },
            upsert=True,
        )

    print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
