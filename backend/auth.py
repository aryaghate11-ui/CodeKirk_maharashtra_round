from __future__ import annotations

import hmac
import os
import secrets
from pathlib import Path

from fastapi import Header, HTTPException


ROOT = Path(__file__).resolve().parents[1]
TOKEN_PATH = ROOT / ".quorum" / "admin-token"


def get_admin_token() -> str:
    configured = os.getenv("QUORUM_ADMIN_TOKEN", "").strip()
    if configured:
        return configured
    if TOKEN_PATH.exists():
        token = TOKEN_PATH.read_text(encoding="utf-8").strip()
        if token:
            return token
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    TOKEN_PATH.write_text(token, encoding="utf-8")
    return token


def require_admin(x_quorum_admin_token: str | None = Header(default=None)) -> None:
    if not x_quorum_admin_token or not hmac.compare_digest(x_quorum_admin_token, get_admin_token()):
        raise HTTPException(
            status_code=401,
            detail="Administrator authorization required. Unlock admin actions with the local Quorum admin token.",
            headers={"WWW-Authenticate": "QuorumAdminToken"},
        )
