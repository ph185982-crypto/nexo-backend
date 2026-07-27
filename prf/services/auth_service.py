"""Auth service for PRF module — JWT-based authentication."""
from __future__ import annotations
import os
import jwt
import bcrypt
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
TOKEN_EXPIRATION = 7 * 24 * 60 * 60  # 7 days


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_token(user_id: UUID) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.utcnow() + timedelta(seconds=TOKEN_EXPIRATION),
        "iat": datetime.utcnow(),
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
        return UUID(payload["sub"])
    return None
