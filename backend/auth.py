# FRIDAY OS — fail-closed bearer-token authentication
import hmac

from fastapi import Header, HTTPException

from config import settings


def require_token(authorization: str | None = Header(default=None)) -> None:
    """Require ``Authorization: Bearer <FRIDAY_TOKEN>`` on every API route.

    A missing server token is a configuration failure, not an implicit public mode.
    Isolated local development can opt in explicitly with
    FRIDAY_ALLOW_INSECURE_LOCAL=true.
    """
    expected = settings.FRIDAY_TOKEN
    if not expected:
        if settings.FRIDAY_ALLOW_INSECURE_LOCAL:
            return
        raise HTTPException(status_code=503, detail="Server authentication is not configured")

    if not authorization:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    scheme, separator, supplied = authorization.partition(" ")
    if not separator or scheme.lower() != "bearer" or not supplied.strip():
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = supplied.strip()
    if not hmac.compare_digest(token.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=401, detail="Invalid token")
