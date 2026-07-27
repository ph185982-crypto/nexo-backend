"""Commute/audio mode router — audio lessons, playlists, commute sessions."""
from fastapi import APIRouter, Depends, Query
from typing import Optional
from uuid import UUID

from prf.routers.deps import get_repo, get_current_user_id
from prf.database.repository import PRFRepository
from prf.services.audio_service import build_commute_playlist

router = APIRouter()


@router.get("/lessons")
async def list_audio_lessons(
    subject_id: Optional[UUID] = None,
    limit: int = Query(default=10, ge=1, le=50),
    repo: PRFRepository = Depends(get_repo),
    user_id: UUID = Depends(get_current_user_id),
):
    """List available audio lessons."""
    lessons = await repo.get_audio_lessons(subject_id=subject_id, limit=limit)
    return {"lessons": lessons}


@router.get("/playlist")
async def get_commute_playlist(
    available_minutes: int = Query(default=45, ge=5, le=120),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Build an optimized playlist for a commute session."""
    lessons = await repo.get_audio_lessons(limit=20)
    playlist = build_commute_playlist(lessons, available_minutes)
    total_duration = sum(item["duration_secs"] for item in playlist)

    return {
        "playlist": playlist,
        "total_items": len(playlist),
        "total_duration_mins": round(total_duration / 60, 1),
        "available_minutes": available_minutes,
    }


@router.post("/start")
async def start_commute_session(
    available_minutes: int = 45,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Start a commute study session."""
    session = await repo.create_session(user_id, mode="commute", energy="medium")
    lessons = await repo.get_audio_lessons(limit=20)
    playlist = build_commute_playlist(lessons, available_minutes)

    return {
        "session_id": session["id"],
        "playlist": playlist,
        "mode": "commute",
        "message": "Modo deslocamento ativado. Ouça e aprenda.",
    }


@router.post("/complete/{session_id}")
async def end_commute_session(
    session_id: UUID,
    duration_mins: float = 0,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """End a commute study session."""
    session = await repo.end_session(session_id, {
        "duration_mins": duration_mins,
        "questions_total": 0,
        "questions_correct": 0,
    })

    await repo.add_xp(user_id, max(5, int(duration_mins)), "commute_session")
    await repo.update_streak(user_id)

    return {
        "completed": True,
        "duration_mins": duration_mins,
        "xp_earned": max(5, int(duration_mins)),
    }
