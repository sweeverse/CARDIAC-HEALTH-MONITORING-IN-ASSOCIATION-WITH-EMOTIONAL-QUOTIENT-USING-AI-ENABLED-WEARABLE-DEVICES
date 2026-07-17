"""
Seeds MongoDB Atlas with the processed cohort dataset produced by
ml-pipeline/build_dataset.py.

Run this AFTER:
  1. python ml-pipeline/build_dataset.py   (produces ml-pipeline/data_processed/*.json)
  2. cp backend/.env.example backend/.env  and fill in your real MONGODB_URI

Usage:
  cd backend
  python scripts/seed_mongo.py                # prompts for confirmation, then clears + reseeds cohort data
  python scripts/seed_mongo.py --dry-run       # shows what would happen, deletes nothing
  python scripts/seed_mongo.py --yes           # skips the interactive prompt (for CI/automation)
  python scripts/seed_mongo.py --full-wipe     # ALSO deletes every user account (incl. every
                                                # participant's login) before reseeding — a true
                                                # "clean slate". The admin account is recreated
                                                # automatically right after (it's bootstrapped from
                                                # .env on every backend startup, and this script
                                                # re-runs that same bootstrap at the end), but every
                                                # OTHER account is gone and would need to sign up again.
                                                # Requires typing DELETE EVERYTHING to confirm, unless
                                                # combined with --yes.

This connects to mongodb+srv://...mongodb.net — requires outbound network
access to *.mongodb.net (not available inside Claude's sandboxed build
environment, which is why this wasn't run automatically; run it from your
own machine/server).

DESTRUCTIVE: by default, the 5 cohort-data collections below are fully
cleared (delete_many({})) before the new data is inserted. users and
password_resets are NOT touched by a normal run, so accounts and
eq_score-on-user-doc data survive a reseed untouched.

With --full-wipe, users and password_resets are cleared too — every
account, admin included, is deleted, then the admin account alone is
immediately recreated from your .env (ADMIN_EMAIL/ADMIN_PASSWORD). This is
the "delete literally everything, then seed" option — use it to reset a
dev/demo database back to a known-clean state. If you want a rollback
point first: mongodump --uri="$MONGODB_URI" --out=./backup_$(date +%s)
"""
import argparse
import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings
from app.db import (
    get_db, ensure_indexes, ensure_admin_account,
    COL_SUBJECTS, COL_SESSIONS, COL_TIMESERIES, COL_INSIGHTS, COL_POPULATION_STATS,
    COL_USERS, COL_PASSWORD_RESETS,
)

PROCESSED = Path(__file__).resolve().parent.parent.parent / "ml-pipeline" / "data_processed"
COLLECTIONS_CLEARED = [COL_SUBJECTS, COL_SESSIONS, COL_TIMESERIES, COL_INSIGHTS, COL_POPULATION_STATS]

# Fields holding ISO-8601 strings in the JSON exports that must become real
# BSON dates on insert. Mixing string and datetime values in the same field
# across seed data vs. live-uploaded data breaks chronological sort order
# (MongoDB's BSON type-ordering sorts dates and strings into separate bands),
# which is what broke the Longitudinal page's session ordering before.
DATETIME_FIELDS = ("recorded_at", "created_at", "updated_at")


def _coerce_datetimes(doc: dict) -> dict:
    for field in DATETIME_FIELDS:
        val = doc.get(field)
        if isinstance(val, str):
            try:
                doc[field] = datetime.fromisoformat(val.replace("Z", "+00:00"))
            except ValueError:
                pass
    return doc


async def load_collection(db, name, filename, dry_run: bool):
    path = PROCESSED / filename
    if not path.exists():
        print(f"  ! {filename} not found — run ml-pipeline/build_dataset.py first.")
        return
    docs = json.loads(path.read_text())
    if not docs:
        print(f"  - {filename}: 0 documents, skipping")
        return
    docs = [_coerce_datetimes(d) for d in docs]

    existing_count = await db[name].count_documents({})
    if dry_run:
        print(f"  [dry-run] {name}: would delete {existing_count} existing docs, insert {len(docs)} from {filename}")
        return

    await db[name].delete_many({})  # idempotent reseed
    await db[name].insert_many(docs)
    print(f"  + {name}: deleted {existing_count} existing docs, inserted {len(docs)} from {filename}")


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Show what would change, delete nothing.")
    parser.add_argument("--yes", action="store_true", help="Skip the interactive confirmation prompt.")
    parser.add_argument("--full-wipe", action="store_true",
                         help="ALSO delete every user account (users + password_resets) before "
                              "reseeding — a true clean slate. The admin account is recreated "
                              "automatically right after; every other account is gone for good.")
    args = parser.parse_args()

    print(f"Connecting to {settings.MONGODB_DB_NAME} on {settings.MONGODB_URI.split('@')[-1]}")
    db = get_db()
    await db.command("ping")
    print("Connected.\n")

    if not args.dry_run:
        print("This will CLEAR and reseed these collections:")
        for c in COLLECTIONS_CLEARED:
            print(f"  - {c}")
        if args.full_wipe:
            print("  - users            (EVERY account, including admin — recreated after, from .env)")
            print("  - password_resets")
        else:
            print("users and password_resets are NOT touched. Add --full-wipe to also clear those.")
        print("Consider a backup first: mongodump --uri=\"$MONGODB_URI\" --out=./backup_$(date +%s)\n")
        if not args.yes:
            if args.full_wipe:
                reply = input('This deletes EVERY user account. Type "DELETE EVERYTHING" to proceed: ').strip()
                if reply != "DELETE EVERYTHING":
                    print("Aborted — no changes made.")
                    return
            else:
                reply = input('Type "yes" to proceed: ').strip().lower()
                if reply != "yes":
                    print("Aborted — no changes made.")
                    return

    await load_collection(db, COL_SUBJECTS, "subjects.json", args.dry_run)
    await load_collection(db, COL_SESSIONS, "sessions.json", args.dry_run)
    await load_collection(db, COL_TIMESERIES, "timeseries_features.json", args.dry_run)
    await load_collection(db, COL_INSIGHTS, "insights.json", args.dry_run)
    await load_collection(db, COL_POPULATION_STATS, "population_stats.json", args.dry_run)

    if args.full_wipe:
        if args.dry_run:
            n_users = await db[COL_USERS].count_documents({})
            n_resets = await db[COL_PASSWORD_RESETS].count_documents({})
            print(f"  [dry-run] {COL_USERS}: would delete {n_users} existing docs (admin recreated after)")
            print(f"  [dry-run] {COL_PASSWORD_RESETS}: would delete {n_resets} existing docs")
        else:
            deleted_users = (await db[COL_USERS].delete_many({})).deleted_count
            deleted_resets = (await db[COL_PASSWORD_RESETS].delete_many({})).deleted_count
            print(f"  + {COL_USERS}: deleted {deleted_users} existing docs")
            print(f"  + {COL_PASSWORD_RESETS}: deleted {deleted_resets} existing docs")

    if args.dry_run:
        print("\nDry run complete — nothing was changed.")
        return

    print("\nEnsuring indexes...")
    await ensure_indexes()

    if args.full_wipe:
        print("Recreating the admin account from .env (ADMIN_EMAIL/ADMIN_PASSWORD)...")
        await ensure_admin_account()
        print(f"  + admin account ready: {settings.ADMIN_EMAIL}")
        print("Every other account was deleted — participants need to sign up again to get a new Subject Number.")
    else:
        print("\nRe-linking existing user accounts to their subject_id (EMAIL_SUBJECT_MAP)...")
        from scripts.link_existing_users import main as relink_users
        await relink_users()

    print("Done. Your CardioEQ AI database is seeded and ready.")


if __name__ == "__main__":
    asyncio.run(main())
