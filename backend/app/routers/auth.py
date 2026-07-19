from datetime import datetime, timezone, timedelta

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Depends, status

from app.db import (
    get_db, COL_USERS, COL_PASSWORD_RESETS, COL_SUBJECTS, COL_SESSIONS, next_available_subject_id,
    cascade_delete_subject_data, ensure_subject_doc, backfill_missing_subject_docs,
)
from app.config import EMAIL_SUBJECT_MAP
from app.ml_core.feature_extraction import normalize_subject_id
from app.security import (
    hash_password, verify_password, create_access_token,
    generate_reset_token, get_current_user, get_current_admin,
)
from app.models.schemas import (
    SignUpRequest, LoginRequest, TokenResponse,
    ForgotPasswordRequest, ResetPasswordRequest, ProfileUpdateRequest,
    AdminCreateUserRequest,
)
from app.utils import apply_ist_timestamps

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def signup(payload: SignUpRequest):
    db = get_db()
    existing = await db[COL_USERS].find_one({"email": payload.email.lower()})
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    email_lower = payload.email.lower()
    subject_id = normalize_subject_id(EMAIL_SUBJECT_MAP.get(email_lower) or await next_available_subject_id())

    user_doc = {
        "full_name": payload.full_name,
        "email": email_lower,
        "hashed_password": hash_password(payload.password),
        "organization": None,
        "role": "clinician",
        "eq_score": None,
        "subject_id": subject_id,
        "age": None,
        "height_cm": None,
        "weight_kg": None,
        "created_at": datetime.now(timezone.utc),
    }
    result = await db[COL_USERS].insert_one(user_doc)
    token = create_access_token(str(result.inserted_id))

    try:
        await ensure_subject_doc(db, subject_id, str(result.inserted_id))
    except Exception:
        # Don't leave a user account holding a subject_id that never got a
        # matching subjects document — that account would still be able to
        # log in, but would be invisible in Cohort Overview and would
        # permanently block this subject_id from ever being (re)assigned.
        # Roll back the user insert and surface the failure instead.
        await db[COL_USERS].delete_one({"_id": result.inserted_id})
        raise HTTPException(status_code=500, detail="Sign up failed while provisioning your subject profile. Please try again.")

    user_doc["_id"] = str(result.inserted_id)
    user_doc.pop("hashed_password")
    return TokenResponse(access_token=token, user=user_doc)


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest):
    db = get_db()
    user = await db[COL_USERS].find_one({"email": payload.email.lower()})
    if not user or not verify_password(payload.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")

    token = create_access_token(str(user["_id"]))
    user["_id"] = str(user["_id"])
    user.pop("hashed_password")
    return TokenResponse(access_token=token, user=user)


@router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest):
    """
    Generates a password reset token. In production this would be emailed
    to the user via a transactional email service (SES, Postmark, etc.) —
    not implemented here, so the token is returned directly in the response
    for local development/testing only. WIRE UP REAL EMAIL DELIVERY BEFORE
    SHIPPING TO PRODUCTION; returning the token in the API response is a
    security hole in a live deployment.
    """
    db = get_db()
    user = await db[COL_USERS].find_one({"email": payload.email.lower()})
    # Always return 200 regardless of whether the email exists, to avoid
    # leaking which emails are registered.
    if not user:
        return {"message": "If that email is registered, a reset link has been issued."}

    token = generate_reset_token()
    await db[COL_PASSWORD_RESETS].insert_one({
        "token": token,
        "user_id": user["_id"],
        "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
    })
    return {
        "message": "If that email is registered, a reset link has been issued.",
        "dev_only_reset_token": token,  # remove this field once email delivery is wired up
    }


@router.post("/reset-password")
async def reset_password(payload: ResetPasswordRequest):
    db = get_db()
    record = await db[COL_PASSWORD_RESETS].find_one({"token": payload.token})
    if not record:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token.")

    await db[COL_USERS].update_one(
        {"_id": record["user_id"]},
        {"$set": {"hashed_password": hash_password(payload.new_password)}},
    )
    await db[COL_PASSWORD_RESETS].delete_one({"_id": record["_id"]})
    return {"message": "Password updated. You can now log in."}


@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    subject_id = current_user.get("subject_id")
    if subject_id and current_user.get("role") != "admin":
        db = get_db()
        existing = await db[COL_SUBJECTS].find_one({"subject_id": subject_id}, {"_id": 1})
        if not existing:
            await ensure_subject_doc(db, subject_id, current_user["_id"])
    return current_user


@router.put("/me")
async def update_me(payload: ProfileUpdateRequest, current_user: dict = Depends(get_current_user)):
    db = get_db()
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}

    # Edit Profile (spec section 5): Name + Email, validated. Email must
    # stay unique across accounts — normalized the same way signup does —
    # and changing it never touches subject_id/role/anything else.
    if "email" in updates:
        new_email = updates["email"].lower()
        if new_email != current_user.get("email"):
            clash = await db[COL_USERS].find_one({"email": new_email})
            if clash and str(clash["_id"]) != str(current_user["_id"]):
                raise HTTPException(status_code=409, detail="That email is already in use by another account.")
        updates["email"] = new_email

    if updates:
        await db[COL_USERS].update_one({"_id": ObjectId(current_user["_id"])}, {"$set": updates})
    user = await db[COL_USERS].find_one({"_id": ObjectId(current_user["_id"])})
    user["_id"] = str(user["_id"])
    user.pop("hashed_password", None)

    # Height/weight are only ever managed here on the Profile page (spec
    # B.4) — never asked for again during recording uploads. Keep the
    # linked subject's demographics (used by every chart/comparison) in
    # sync whenever either value changes, auto-computing BMI from them.
    height_cm = user.get("height_cm")
    weight_kg = user.get("weight_kg")
    subject_id = user.get("subject_id")
    if subject_id and (height_cm or weight_kg or user.get("age") is not None):
        bmi = None
        if height_cm and weight_kg:
            height_m = height_cm / 100
            bmi = round(weight_kg / (height_m * height_m), 1)
        subject = await db[COL_SUBJECTS].find_one({"subject_id": subject_id})
        demographics = (subject or {}).get("demographics", {})
        if user.get("age") is not None:
            demographics["age"] = user["age"]
        if height_cm is not None:
            demographics["height_cm"] = height_cm
        if weight_kg is not None:
            demographics["weight_kg"] = weight_kg
        if bmi is not None:
            demographics["bmi"] = bmi
        await db[COL_SUBJECTS].update_one(
            {"subject_id": subject_id},
            {"$set": {"demographics": demographics, "subject_id": subject_id}},
            upsert=True,
        )
        user["bmi"] = bmi

    return user


@router.delete("/me")
async def delete_account(current_user: dict = Depends(get_current_user)):
    """
    Delete Account (spec section 5) — normal users only. The single
    hardcoded admin account (see db.ensure_admin_account) is the system
    bootstrap account, not a self-service account, so it can't delete
    itself through this endpoint.

    Removes the LOGIN account (COL_USERS doc) always. The linked subject's
    RESEARCH DATA is preserved (spec section 8: uploaded data must never
    be silently lost) *unless* that subject has zero recordings — in that
    case there is nothing to protect, and leaving the empty stub around
    would just permanently burn that subject_id from
    next_available_subject_id()'s pool for no reason. So: has sessions ->
    keep the subject doc, drop only the login. Has no sessions -> full
    cascade delete, freeing the subject_id for reuse.
    """
    db = get_db()
    if current_user.get("role") == "admin":
        raise HTTPException(status_code=403, detail="The administrator account can't be deleted from here.")

    subject_id = current_user.get("subject_id")
    if subject_id:
        subject_id = normalize_subject_id(subject_id)
        has_sessions = await db[COL_SESSIONS].count_documents({"subject_id": subject_id}, limit=1)
        if not has_sessions:
            await cascade_delete_subject_data(db, subject_id)

    await db[COL_USERS].delete_one({"_id": ObjectId(current_user["_id"])})
    return {"message": "Account deleted."}


# --- Admin User Management (Task 4) ---------------------------------------
# Distinct from DELETE /me above: that's a normal user's own self-service
# account deletion, which preserves their subject's research data whenever
# that subject actually has any. These endpoints are the "separate,
# explicit admin action" — a full purge (login account + every piece of
# that subject's data, regardless of whether it has sessions), or, for
# creation, a brand-new participant with an auto-assigned Subject ID,
# immediately queryable with no caching layer to invalidate.

@router.get("/admin/users")
async def admin_list_users(current_admin: dict = Depends(get_current_admin)):
    """All non-admin user accounts, for the Admin User Management page (Task 13's data source)."""
    db = get_db()
    cursor = db[COL_USERS].find({"role": {"$ne": "admin"}}).sort("created_at", -1)
    users = []
    async for u in cursor:
        u["_id"] = str(u["_id"])
        u.pop("hashed_password", None)
        apply_ist_timestamps(u)
        users.append(u)
    return {"total": len(users), "users": users}


@router.post("/admin/users", status_code=status.HTTP_201_CREATED)
async def admin_create_user(payload: AdminCreateUserRequest, current_admin: dict = Depends(get_current_admin)):
    """
    Admin-initiated account creation (Task 4 "Create User"). Mirrors
    signup()'s user+subject document shape exactly, so an admin-created
    account behaves identically to a self-signed-up one in every other
    endpoint. subject_id is always auto-assigned via next_available_subject_id
    (never hand-typed, same as normal signup) — immediately committed to
    Mongo before this returns, so it's queryable by every other endpoint
    with no refresh/cache-invalidation step needed.
    """
    db = get_db()
    email_lower = payload.email.lower()
    existing = await db[COL_USERS].find_one({"email": email_lower})
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    subject_id = normalize_subject_id(EMAIL_SUBJECT_MAP.get(email_lower) or await next_available_subject_id())

    user_doc = {
        "full_name": payload.full_name,
        "email": email_lower,
        "hashed_password": hash_password(payload.password),
        "organization": None,
        "role": "clinician",
        "eq_score": None,
        "subject_id": subject_id,
        "age": payload.age,
        "height_cm": payload.height_cm,
        "weight_kg": payload.weight_kg,
        "created_at": datetime.now(timezone.utc),
    }
    result = await db[COL_USERS].insert_one(user_doc)

    bmi = None
    if payload.height_cm and payload.weight_kg:
        height_m = payload.height_cm / 100
        bmi = round(payload.weight_kg / (height_m * height_m), 1)

    try:
        await db[COL_SUBJECTS].update_one(
            {"subject_id": subject_id},
            {
                "$set": {"subject_id": subject_id, "owner_user_id": str(result.inserted_id)},
                "$setOnInsert": {
                    "demographics": {"age": payload.age, "bmi": bmi, "height_cm": payload.height_cm, "weight_kg": payload.weight_kg},
                    "created_at": datetime.now(timezone.utc),
                },
            },
            upsert=True,
        )
    except Exception:
        await db[COL_USERS].delete_one({"_id": result.inserted_id})
        raise HTTPException(status_code=500, detail="User creation failed while provisioning the subject profile. Please try again.")

    user_doc["_id"] = str(result.inserted_id)
    user_doc.pop("hashed_password")
    apply_ist_timestamps(user_doc)
    return {"user": user_doc, "subject_id": subject_id}


@router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, current_admin: dict = Depends(get_current_admin)):
    """
    Admin-initiated full purge (Task 4 "Delete User"): removes the login
    account AND cascades through every piece of that subject's data
    (recordings, features, analytics, reports, questionnaires, predictions,
    percentile data, heart health score, risk score, graph data — all of
    which live under COL_SUBJECTS/COL_SESSIONS/COL_TIMESERIES/COL_INSIGHTS
    for this subject_id). Cohort analytics are recalculated immediately
    afterward so no stale percentile/cohort-stat data lingers for the
    remaining subjects (Task 4 + Task 7).

    ORDER MATTERS: cascade the subject's data FIRST, then delete the user
    doc LAST. If this were reversed (user deleted first) and the cascade
    step then failed or errored partway (network blip, transient DB error,
    etc.), the user login would already be gone with no way to retry —
    leaving a permanently orphaned subjects/sessions/timeseries/insights
    doc for that subject_id. That orphan is invisible to admin_list_users
    (reads from COL_USERS) and to Cohort Overview if it also filters on a
    live user, but it still gets counted by next_available_subject_id()'s
    scan — silently burning that subject_id forever and shifting every
    later signup's assigned ID. Doing the cascade first means if anything
    fails, the user doc is still present and the whole delete can simply
    be retried from the UI.
    """
    db = get_db()
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user id.")

    user = await db[COL_USERS].find_one({"_id": oid})
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.get("role") == "admin":
        raise HTTPException(status_code=403, detail="The administrator account can't be deleted.")

    cascade_result = {"sessions_deleted": 0, "windows_deleted": 0, "insights_deleted": 0, "subject_deleted": False}
    subject_id = user.get("subject_id")
    if subject_id:
        subject_id = normalize_subject_id(subject_id)
        cascade_result = await cascade_delete_subject_data(db, subject_id)

    # Only remove the login account once the cascade above has actually
    # succeeded — see the ordering note in the docstring.
    await db[COL_USERS].delete_one({"_id": oid})

    # Recalculate cohort analytics after deletion (Task 4) — the departed
    # subject's data must not linger in anyone else's percentile/cohort
    # comparisons.
    from app.services.population_recompute import recompute_population_benchmarks
    await recompute_population_benchmarks()

    return {
        "message": f"User and all associated data for {subject_id or '(no linked subject)'} deleted.",
        "deleted_user_id": user_id,
        "deleted_subject_id": subject_id,
        **cascade_result,
    }