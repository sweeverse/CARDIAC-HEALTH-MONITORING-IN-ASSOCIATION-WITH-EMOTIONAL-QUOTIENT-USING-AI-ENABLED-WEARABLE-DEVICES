from typing import Optional, Any
from pydantic import BaseModel, EmailStr, Field


# --- Auth ---

class SignUpRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class AdminCreateUserRequest(BaseModel):
    """Admin-only user creation (Task 4). Mirrors SignUpRequest, plus the
    optional demographic fields an admin may already know for a new
    participant — subject_id is always auto-assigned (never hand-typed),
    consistent with the normal signup flow."""
    full_name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    age: Optional[float] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class ProfileUpdateRequest(BaseModel):
    # NOTE: "role" intentionally excluded — it must never be settable by a
    # user on their own profile, or anyone could self-promote to admin.
    # Role is only ever set at signup ("clinician") or via the hardcoded
    # admin bootstrap (see app.db.ensure_admin_account, role="admin").
    # "subject_id" is likewise excluded — it's assigned once at signup
    # (app.routers.auth.signup) and never user-editable.
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    email: Optional[EmailStr] = None
    organization: Optional[str] = None
    eq_score: Optional[float] = Field(default=None, ge=0, le=100)
    age: Optional[float] = Field(default=None, ge=0, le=130)
    height_cm: Optional[float] = Field(default=None, gt=0, le=272)
    weight_kg: Optional[float] = Field(default=None, gt=0, le=650)


# --- Assistant ---

class AssistantQuery(BaseModel):
    subject_id: str
    question: str
    activity: Optional[str] = None


# --- Upload / ingestion ---

class IngestResponse(BaseModel):
    subject_id: str
    sessions_created: int
    windows_created: int
    insights_created: int
    heart_health_score: Optional[float]
    risk_score: Optional[float] = None
    predicted_risk_class: str


class FileIngestResult(BaseModel):
    filename: str
    success: bool
    activity: Optional[str] = None
    error: Optional[str] = None
    result: Optional[IngestResponse] = None
    # Populated when the file was NOT processed because it needs the
    # uploader to explicitly confirm before proceeding (Task 5 — subject
    # validation / duplicate handling). `success` stays False in this
    # case, but this is distinct from a hard error: re-submitting the
    # SAME file with the matching confirm_* flag set will process it.
    requires_confirmation: bool = False
    conflict_type: Optional[str] = None  # "exact_match" | "new_session"
    warning: Optional[str] = None
    # Reserved: true would mean the file's data was byte-identical to what's
    # already stored and got skipped without reprocessing. Not currently
    # set — an exact-data match is now surfaced as an "exact_match"
    # conflict requiring explicit confirmation instead (Task 3, revised),
    # so the uploader always sees and decides on it rather than it
    # happening silently.
    skipped_identical: bool = False


class BatchIngestResponse(BaseModel):
    total_files: int
    succeeded: int
    failed: int
    files: list[FileIngestResult]
