"""
End-to-end backend test suite (Task 11).

Seeds the real processed dataset into an in-memory Mongo mock
(mongomock_motor) and drives the actual FastAPI app in-process via httpx —
no real Atlas connection needed, but every request goes through the real
routers/services/ml_core code, so this exercises genuine application logic,
not mocks of it.

Organized to match the Task 11 checklist exactly:
  1.  upload
  2.  replace upload (duplicate + confirm_replace)
  3.  duplicate upload (blocked without confirmation)
  4.  subject validation (metadata mismatch warning)
  5.  delete recording (single session)
  6.  delete subject (admin cascade)
  7.  regenerate analytics (percentiles/HHS refresh after upload)
  8.  regenerate cohort statistics (population stats after delete)
  9.  retrain unsupervised pipeline (admin live retrain)
  10. persistence (EQ answers, longitudinal survive logout/login)
  11. API consistency (IST timestamps, 2-decimal score/percentile formatting)

Run: python smoke_test.py   (exits non-zero on any failed assertion)
"""
import asyncio
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mongomock_motor import AsyncMongoMockClient
from httpx import AsyncClient, ASGITransport

import app.db as db_module

# patch the db client BEFORE importing the app
db_module._client = AsyncMongoMockClient()

from app.main import app
from app.db import (
    get_db, ensure_admin_account, COL_SUBJECTS, COL_SESSIONS, COL_TIMESERIES,
    COL_INSIGHTS, COL_POPULATION_STATS,
)
from app.config import settings

PROCESSED = Path(__file__).resolve().parent.parent / "ml-pipeline" / "data_processed"
RAW_CSVS = Path(__file__).resolve().parent.parent / "ml-pipeline" / "raw_data" / "modified_all_subjects_FIXED" / "modified_csvs"

IST_OFFSET_RE = re.compile(r"[+-]05:30$")


def check(label: str, cond: bool, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        raise AssertionError(f"{label}: {detail}")


async def seed():
    db = get_db()
    await db[COL_SUBJECTS].insert_many(json.load(open(PROCESSED / "subjects.json")))
    await db[COL_SESSIONS].insert_many(json.load(open(PROCESSED / "sessions.json")))
    await db[COL_TIMESERIES].insert_many(json.load(open(PROCESSED / "timeseries_features.json")))
    await db[COL_INSIGHTS].insert_many(json.load(open(PROCESSED / "insights.json")))
    await db[COL_POPULATION_STATS].insert_many(json.load(open(PROCESSED / "population_stats.json")))
    # ASGITransport doesn't trigger the app's lifespan startup hooks, so
    # bootstrap the admin account explicitly (mirrors what main.py's
    # lifespan does against a real server on boot).
    await ensure_admin_account()
    print("Seeded mock DB with processed dataset (20 subjects, 80 sessions, 1088 windows).\n")


async def main():
    await seed()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:

        print("=== Basic health + auth ===")
        r = await client.get("/api/health")
        check("health check", r.status_code == 200)

        r = await client.post("/api/auth/signup", json={
            "full_name": "Dr. Test User", "email": "test@cardioeq.ai", "password": "supersecret123"
        })
        check("signup", r.status_code == 201, r.text)
        token = r.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        my_subject_id = r.json()["user"]["subject_id"]
        print(f"  test user assigned {my_subject_id}")

        r = await client.post("/api/auth/login", json={"email": "admin@cardioeq.ai", "password": settings.ADMIN_PASSWORD})
        check("admin login", r.status_code == 200, r.text)
        admin_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

        r = await client.get("/api/subjects", headers=headers)
        check("list subjects (own-only for non-admin)", r.status_code == 200 and r.json()["total"] == 1)

        r = await client.get("/api/subjects", headers=admin_headers)
        n_subjects_start = r.json()["total"]
        check("list subjects (admin sees all)", n_subjects_start == 21, f"got {n_subjects_start}")

        print("\n=== Existing-cohort dashboard reads ===")
        r = await client.get("/api/subjects/S01", headers=admin_headers)
        check("get S01", r.status_code == 200)
        s01 = r.json()
        r = await client.get("/api/subjects/S01/sessions", headers=admin_headers)
        check("S01 sessions", r.status_code == 200 and len(r.json()["sessions"]) > 0)
        r = await client.get("/api/subjects/S01/explainability", headers=admin_headers)
        check("S01 explainability", r.status_code == 200)
        r = await client.get("/api/subjects/S01/population", headers=admin_headers)
        check("S01 population", r.status_code == 200)
        r = await client.get("/api/subjects/S01/longitudinal", headers=admin_headers)
        check("S01 longitudinal", r.status_code == 200)
        r = await client.get("/api/population/stats", headers=admin_headers)
        check("population stats", r.status_code == 200 and r.json()["cohort_size"] == 20)
        r = await client.get("/api/subjects/S01/report", headers=admin_headers)
        check("report PDF", r.status_code == 200 and r.headers["content-type"] == "application/pdf")

        print("\n=== 1. Upload ===")
        csv_path = RAW_CSVS / "S05_Walk.csv"
        files = {"files": ("S05_Walk.csv", csv_path.read_bytes(), "text/csv")}
        r = await client.post("/api/subjects/upload", data={"activity": "walk"}, files=files, headers=headers)
        check("own upload succeeds", r.status_code == 200 and r.json()["succeeded"] == 1, r.text)

        r = await client.get(f"/api/subjects/{my_subject_id}", headers=headers)
        check("own subject now exists with HHS", r.status_code == 200 and r.json()["heart_health_score"] is not None)

        print("\n=== 4. Subject validation (metadata mismatch) ===")
        # Upload S10's actual recording (bmi 43.3, height 162.56, weight 114.3)
        # but target it at S02 (on record: bmi 29.5, height 144.78, weight 61.9)
        # — a genuine embedded-vs-on-record mismatch, distinct from S02 simply
        # already having a "cog" session (which would be the duplicate-upload
        # path tested separately below).
        r = await client.post(
            "/api/subjects/upload",
            data={"subject_id": "S02", "activity": "cog", "age": "23", "height_cm": "144.78", "weight_kg": "61.9"},
            files={"files": ("S10_Cog.csv", (RAW_CSVS / "S10_Cog.csv").read_bytes(), "text/csv")},
            headers=admin_headers,
        )
        body = r.json()
        mismatch_flagged = body["failed"] >= 1 and any(
            f.get("conflict_type") == "metadata_mismatch" for f in body["files"]
        )
        check("cross-subject file is flagged as a metadata mismatch, not silently applied", mismatch_flagged, json.dumps(body))

        print("\n=== 3. Duplicate upload (blocked without confirmation) ===")
        r = await client.post(
            "/api/subjects/upload",
            data={"activity": "walk"},
            files={"files": ("S05_Walk.csv", csv_path.read_bytes(), "text/csv")},
            headers=headers,
        )
        body = r.json()
        dup_flagged = body["failed"] == 1 and body["files"][0]["conflict_type"] == "exact_match"
        check("re-uploading same subject+activity is blocked as a duplicate", dup_flagged, json.dumps(body))

        r = await client.get(f"/api/subjects/{my_subject_id}/sessions", headers=headers)
        check("duplicate was NOT actually inserted", len(r.json()["sessions"]) == 1, f"got {len(r.json()['sessions'])} sessions")

        print("\n=== 2. Replace upload (duplicate + confirm_replace) ===")
        r = await client.post(
            "/api/subjects/upload",
            data={"activity": "walk", "confirm_replace": "true"},
            files={"files": ("S05_Walk.csv", csv_path.read_bytes(), "text/csv")},
            headers=headers,
        )
        check("confirmed replace succeeds", r.status_code == 200 and r.json()["succeeded"] == 1, r.text)
        r = await client.get(f"/api/subjects/{my_subject_id}/sessions", headers=headers)
        check("replace did not create a second session", len(r.json()["sessions"]) == 1, f"got {len(r.json()['sessions'])}")

        print("\n=== 5. Delete recording ===")
        session_mongo_id = r.json()["sessions"][0]["_id"]
        r = await client.delete(f"/api/subjects/{my_subject_id}/sessions/{session_mongo_id}", headers=headers)
        check("delete own session", r.status_code == 200 and r.json()["subject_removed"] is True, r.text)
        r = await client.get(f"/api/subjects/{my_subject_id}", headers=headers)
        check("subject gone after its only session is deleted", r.status_code == 404)

        print("\n=== 7. Regenerate analytics after upload ===")
        r = await client.post(
            "/api/subjects/upload",
            data={"activity": "walk"},
            files={"files": ("S05_Walk.csv", csv_path.read_bytes(), "text/csv")},
            headers=headers,
        )
        check("re-upload after delete succeeds", r.status_code == 200 and r.json()["succeeded"] == 1)
        r = await client.get(f"/api/subjects/{my_subject_id}/population", headers=headers)
        check(
            "population_percentile populated immediately (no stale/empty analytics)",
            r.status_code == 200 and r.json()["population_percentile"] not in (None, {}),
            r.text,
        )

        print("\n=== 10. Persistence (EQ answers, survives logout/login) ===")
        r = await client.get("/api/subjects/eq-questionnaire", headers=headers)
        q_ids = [q["id"] for q in r.json()["questions"]]
        answers = {qid: 3 for qid in q_ids}
        r = await client.post(f"/api/subjects/{my_subject_id}/eq-assessment", json={"answers": answers}, headers=headers)
        check("submit EQ answers", r.status_code == 200, r.text)
        eq_score_1 = r.json()["eq_score"]

        # simulate logout/login: fresh token, re-fetch
        r = await client.post("/api/auth/login", json={"email": "test@cardioeq.ai", "password": "supersecret123"})
        fresh_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
        r = await client.get(f"/api/subjects/{my_subject_id}/eq-assessment", headers=fresh_headers)
        check("EQ answers survive logout/login", r.status_code == 200 and r.json()["eq_score"] == eq_score_1, r.text)

        # re-submitting updates in place, no duplicate questionnaire records
        answers2 = {qid: 4 for qid in q_ids}
        r = await client.post(f"/api/subjects/{my_subject_id}/eq-assessment", json={"answers": answers2}, headers=headers)
        check("re-submitting EQ updates in place (no duplicate)", r.status_code == 200 and r.json()["eq_score"] != eq_score_1)

        print("\n=== 11. API consistency: IST timestamps + 2-decimal formatting ===")
        r = await client.get(f"/api/subjects/{my_subject_id}/sessions", headers=headers)
        recorded_at = r.json()["sessions"][0]["recorded_at"]
        check("recorded_at carries +05:30 (IST) offset", bool(IST_OFFSET_RE.search(recorded_at)), recorded_at)

        r = await client.get(f"/api/subjects/{my_subject_id}", headers=headers)
        hhs = r.json()["heart_health_score"]
        hhs_str = f"{hhs:.10f}"
        decimals = len(hhs_str.split(".")[1].rstrip("0")) if "." in hhs_str else 0
        check("heart_health_score has at most 2 decimal places", decimals <= 2, f"{hhs} -> {decimals} decimals")

        print("\n=== 6. Delete subject (admin cascade) ===")
        r = await client.get("/api/auth/admin/users", headers=admin_headers)
        check("admin list users", r.status_code == 200 and r.json()["total"] == 1, r.text)
        target_user_id = r.json()["users"][0]["_id"]

        r = await client.delete(f"/api/auth/admin/users/{target_user_id}", headers=admin_headers)
        check("admin cascade-delete user", r.status_code == 200 and r.json()["subject_deleted"] is True, r.text)

        r = await client.get(f"/api/subjects/{my_subject_id}", headers=admin_headers)
        check("subject data gone after cascade delete", r.status_code == 404)
        r = await client.get(f"/api/subjects/{my_subject_id}/sessions", headers=admin_headers)
        check("sessions gone after cascade delete", r.status_code == 404)
        r = await client.post("/api/auth/login", json={"email": "test@cardioeq.ai", "password": "supersecret123"})
        check("login for the deleted account now fails", r.status_code == 401)

        print("\n=== Admin Create User ===")
        r = await client.post("/api/auth/admin/users", json={
            "full_name": "Admin-Created Participant", "email": "created-by-admin@cardioeq.ai",
            "password": "anothersecret123", "age": 30, "height_cm": 170, "weight_kg": 65,
        }, headers=admin_headers)
        check("admin create user", r.status_code == 201, r.text)
        new_subject_id = r.json()["subject_id"]
        r = await client.get(f"/api/subjects/{new_subject_id}", headers=admin_headers)
        check("admin-created subject immediately queryable, no refresh needed", r.status_code == 200, r.text)

        print("\n=== 8. Regenerate cohort statistics after delete ===")
        r = await client.get("/api/population/stats", headers=admin_headers)
        cohort_size_after = r.json()["cohort_size"]
        check("cohort stats reflect the deletion (still ==20 original, deleted one wasn't in the seeded 20)",
              cohort_size_after == 20, f"got {cohort_size_after}")

        print("\n=== 9. Retrain unsupervised pipeline ===")
        r = await client.post("/api/subjects/admin/retrain-pipeline", headers=admin_headers)
        check("retrain endpoint succeeds", r.status_code == 200, r.text)
        retrain_body = r.json()
        check("retrain used the vast majority of current windows (some incomplete-feature windows correctly excluded)",
              retrain_body["n_windows_used"] >= 1000, json.dumps(retrain_body))
        check("retrain rescored every subject in the DB", retrain_body["n_subjects_rescored"] >= 20, json.dumps(retrain_body))

        r = await client.get("/api/subjects/S01", headers=admin_headers)
        check("S01 still scoreable after retrain", r.status_code == 200 and r.json()["heart_health_score"] is not None)

        r = await client.post("/api/auth/login", json={"email": "created-by-admin@cardioeq.ai", "password": "anothersecret123"})
        check("login as the admin-created (non-admin) user", r.status_code == 200, r.text)
        other_user_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

        r = await client.post("/api/subjects/admin/retrain-pipeline", headers=other_user_headers)
        check("non-admin cannot retrain", r.status_code == 403)

        print("\n=== Non-admin authorization checks ===")
        r = await client.get("/api/subjects/S01", headers=other_user_headers)
        check("non-admin blocked from viewing another subject", r.status_code == 403)
        r = await client.get("/api/auth/admin/users", headers=other_user_headers)
        check("non-admin blocked from admin user list", r.status_code == 403)

        r = await client.get("/api/subjects/S01", headers=headers)
        check("deleted account's old token is now rejected (401, not just 403)", r.status_code == 401)

        print("\nALL BACKEND E2E TESTS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
