"""Commute/audio mode router — audio lessons, playlists, commute sessions, TTS streaming."""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
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


@router.get("/audio/{lesson_id}")
async def stream_audio(
    lesson_id: UUID,
    voice: Optional[str] = Query(default=None, description="female, male, calm or narrator"),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Stream synthesized TTS audio for a lesson's stored script."""
    from fastapi import HTTPException
    from prf.services.tts_service import TTSService

    lessons = await repo.get_audio_lessons(limit=200)
    lesson = next((l for l in lessons if str(l.get("id")) == str(lesson_id)), None)
    if not lesson:
        raise HTTPException(404, "Lesson not found")

    script = lesson.get("script") or lesson.get("title") or ""
    if not script.strip():
        raise HTTPException(404, "Lesson has no script")

    tts = TTSService(voice=voice)
    audio_bytes = await tts.synthesize(script)
    if not audio_bytes:
        raise HTTPException(503, "Síntese de áudio indisponível — configure OPENAI_API_KEY")

    import io
    return StreamingResponse(
        io.BytesIO(audio_bytes),
        media_type="audio/mpeg",
        headers={
            "Content-Length": str(len(audio_bytes)),
            "Cache-Control": "public, max-age=86400",
            "Accept-Ranges": "bytes",
        },
    )


@router.post("/synthesize")
async def synthesize_text(
    text: str = Query(..., max_length=5000),
    voice: Optional[str] = None,
    user_id: UUID = Depends(get_current_user_id),
):
    """Synthesize arbitrary text to audio (for legal articles, flashcards, etc.)."""
    from fastapi import HTTPException
    from prf.services.tts_service import TTSService

    tts = TTSService(voice=voice)
    audio = await tts.synthesize(text)
    if not audio:
        raise HTTPException(503, "Síntese de áudio indisponível — configure OPENAI_API_KEY")

    import io
    return StreamingResponse(
        io.BytesIO(audio),
        media_type="audio/mpeg",
        headers={
            "Content-Length": str(len(audio)),
            "Cache-Control": "public, max-age=86400",
        },
    )


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
