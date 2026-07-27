"""Shared dependencies for PRF routers."""
from __future__ import annotations
from typing import Optional
from uuid import UUID

from fastapi import Depends, HTTPException, Header

from prf.services.auth_service import get_user_id_from_token
from prf.database.repository import PRFRepository
from prf.services.study_service import StudyService


_repo: Optional[PRFRepository] = None
_study_service: Optional[StudyService] = None


def set_repo(repo: PRFRepository):
    global _repo, _study_service
    _repo = repo
    _study_service = StudyService(repo)


def get_repo() -> PRFRepository:
    if _repo is None:
        raise HTTPException(500, "Database not initialized")
    return _repo


def get_study_service() -> StudyService:
    if _study_service is None:
        raise HTTPException(500, "Study service not initialized")
    return _study_service


async def get_current_user_id(
    authorization: str = Header(..., description="Bearer <token>"),
) -> UUID:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Invalid authorization header")
    token = authorization[7:]
    user_id = get_user_id_from_token(token)
    if not user_id:
        raise HTTPException(401, "Invalid or expired token")
    return user_id
