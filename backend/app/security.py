import secrets
from datetime import datetime, timedelta, timezone

from jose import jwt, JWTError
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.config import settings
from app.db import get_db, COL_USERS

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def generate_reset_token() -> str:
    return secrets.token_urlsafe(32)


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise credentials_error
    except JWTError:
        raise credentials_error

    db = get_db()
    from bson import ObjectId
    user = await db[COL_USERS].find_one({"_id": ObjectId(user_id)})
    if user is None:
        raise credentials_error
    user["_id"] = str(user["_id"])
    user.pop("hashed_password", None)
    return user


async def get_current_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """
    Gate for admin-only features: retraining the model, deleting uploaded
    data, EQ self-report access, and any future system-management endpoints.
    Only the single hardcoded admin account (see app.db.ensure_admin_account)
    ever has role == "admin", so this can't be granted through signup/profile
    updates.
    """
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This action is restricted to administrators.",
        )
    return current_user
