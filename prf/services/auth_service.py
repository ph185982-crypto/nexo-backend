"""Auth service for PRF module — JWT-based authentication."""
from __future__ import annotations
import os
import jwt
import bcrypt
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

_configured_secret = os.getenv('SECRET_KEY')
if _configured_secret == 'dev-secret-key-change-in-production':
    _configured_secret = None
# Domain separation avoids using an API key directly as a signing key. A
# dedicated SECRET_KEY remains preferred; rotation expires device sessions.
_provider_secret = os.getenv('OPENAI_API_KEY')
SECRET_KEY = _configured_secret or (hashlib.sha256(('study-device-jwt-v2:' + _provider_secret).encode()).hexdigest() if _provider_secret else secrets.token_hex(32))
if os.getenv('VERCEL') and not (_configured_secret or _provider_secret):
    raise RuntimeError('Configure SECRET_KEY antes de publicar')
TOKEN_EXPIRATION = 7 * 24 * 60 * 60  # 7 days


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_token(user_id: UUID) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + timedelta(seconds=TOKEN_EXPIRATION),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def get_user_id_from_token(token: str) -> Optional[UUID]:
    payload = decode_token(token)
    if payload and "sub" in payload:
        try:
            return UUID(payload["sub"])
        except (ValueError, TypeError, AttributeError):
            return None
    return None
