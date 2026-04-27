import os

from fastapi import Header, HTTPException
from jose import jwt, JWTError

_SECRET = os.getenv("JWT_SECRET", "dory-hackathon-secret-change-in-prod")
_ALGO = "HS256"


def get_current_user_id(authorization: str = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    token = authorization[7:]
    try:
        payload = jwt.decode(token, _SECRET, algorithms=[_ALGO])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token payload.")
        return user_id
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
