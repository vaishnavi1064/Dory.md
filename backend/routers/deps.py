import os

from fastapi import Header, HTTPException
from jose import jwt, JWTError

from database.db import get_user_by_id

# Environment values treated as "local development". Anything else (including the
# default) is treated as production, i.e. secure-by-default.
DEV_ENVS = {"dev", "development"}


def is_dev_env() -> bool:
    """True only in local development. Default is 'production' (secure by default)."""
    return os.getenv("DORY_ENV", "production").lower() in DEV_ENVS


def _get_secret() -> str:
    """Return the JWT signing secret. There is NO fallback: DORY_JWT_SECRET must be
    set in every environment or the app fails loudly rather than signing tokens with
    a guessable default."""
    secret = os.getenv("DORY_JWT_SECRET")
    if not secret:
        raise RuntimeError("DORY_JWT_SECRET environment variable is required")
    return secret


JWT_ALGORITHM = "HS256"


def require_secret_configured() -> None:
    """Startup guard (AUDIT P1-7). Refuses to boot without DORY_JWT_SECRET so a
    misconfigured deploy fails fast instead of 500-ing every authenticated request."""
    if not os.getenv("DORY_JWT_SECRET"):
        raise RuntimeError("DORY_JWT_SECRET environment variable is required")


def get_current_user_id(authorization: str = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    token = authorization[7:]
    try:
        payload = jwt.decode(token, _get_secret(), algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    if payload.get("typ") != "access":
        raise HTTPException(status_code=401, detail="Wrong token type.")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload.")
    # Reject valid-but-stale tokens whose user no longer exists (e.g. after account
    # deletion) so a ghost user can't operate on the API. (Sprint 0 Task 4)
    if get_user_by_id(user_id) is None:
        raise HTTPException(status_code=401, detail="Account no longer exists.")
    return user_id
