"""
Auth Service — JWT tokens + async-safe password hashing
Bug fix: bcrypt is sync — wrap in asyncio.to_thread to avoid blocking event loop
"""
import os, asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
import bcrypt

SECRET_KEY = os.getenv("SECRET_KEY", "nexo-super-secret-change-in-production-2025")
ALGORITHM  = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days


# ── Async-safe wrappers ───────────────────────────────────────────────────────

async def hash_password(password: str) -> str:
    """Run bcrypt in thread pool to avoid blocking the event loop."""
    def _hash():
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    return await asyncio.to_thread(_hash)


async def verify_password(plain: str, hashed: str) -> bool:
    """Run bcrypt comparison in thread pool."""
    def _verify():
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    return await asyncio.to_thread(_verify)


# ── JWT ───────────────────────────────────────────────────────────────────────

def create_access_token(user_id: str, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": user_id, "email": email, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None
