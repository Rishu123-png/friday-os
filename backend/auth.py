# FRIDAY OS — Bearer-token auth
from fastapi import Header, HTTPException

from config import settings


def require_token(authorization: str | None = Header(default=None)) -> None:
    """FastAPI dependency. When FRIDAY_TOKEN is configured, every request
    must carry `Authorization: Bearer <token>`."""
    if not settings.FRIDAY_TOKEN:
        return  # dev mode: auth off
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    if token != settings.FRIDAY_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid token")
