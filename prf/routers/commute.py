"""Commute/audio mode router — audio lessons, playlists, commute sessions, TTS streaming."""
import asyncio

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


# ── Podcast (episódios em diálogo, dois apresentadores) ─────────────────────

@router.get("/podcast")
async def list_podcast_episodes(
    subject_id: Optional[UUID] = None,
    limit: int = Query(default=50, ge=1, le=100),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Lista os episódios disponíveis (sem o roteiro, que é pesado)."""
    episodes = await repo.get_podcast_episodes(subject_id=subject_id, limit=limit)
    return {"episodes": episodes}


@router.get("/podcast/{episode_id}")
async def get_podcast_episode(
    episode_id: UUID,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Detalhe de um episódio: metadados e a divisão em segmentos."""
    from fastapi import HTTPException

    ep = await repo.get_podcast_episode(episode_id)
    if not ep:
        raise HTTPException(404, "Episódio não encontrado")

    turns = ep.get("turns") or []
    blocks = sorted({t.get("block", 0) for t in turns})
    segments = [
        {
            "seq": b,
            "turn_count": sum(1 for t in turns if t.get("block") == b),
            "words": sum(len((t.get("text") or "").split())
                         for t in turns if t.get("block") == b),
        }
        for b in blocks
    ]
    return {
        "id": ep["id"],
        "title": ep["title"],
        "topic": ep["topic"],
        "description": ep.get("description"),
        "subject_id": ep.get("subject_id"),
        "duration_secs": ep.get("duration_secs", 0),
        "segment_count": len(segments),
        "segments": segments,
    }


@router.get("/podcast/{episode_id}/segment/{seq}")
async def stream_podcast_segment(
    episode_id: UUID,
    seq: int,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Áudio de um segmento do episódio.

    O áudio é sintetizado na primeira vez que alguém pede o segmento e
    gravado no banco: o /tmp do serverless morre entre invocações, então
    sem persistir aqui todo replay pagaria TTS de novo. Fatiar por segmento
    é o que mantém cada requisição dentro do tempo limite da função.
    """
    from fastapi import HTTPException
    import io

    cached = await repo.get_podcast_segment_audio(episode_id, seq)
    if cached:
        return StreamingResponse(
            io.BytesIO(cached),
            media_type="audio/mpeg",
            headers={
                "Content-Length": str(len(cached)),
                "Cache-Control": "public, max-age=604800",
                "Accept-Ranges": "bytes",
            },
        )

    ep = await repo.get_podcast_episode(episode_id)
    if not ep:
        raise HTTPException(404, "Episódio não encontrado")

    turns = [t for t in (ep.get("turns") or []) if t.get("block") == seq]
    if not turns:
        raise HTTPException(404, "Segmento não encontrado")

    from prf.services import podcast_service

    audio = await podcast_service.synthesize_segment(turns)
    if not audio:
        raise HTTPException(503, "Síntese de áudio indisponível — configure OPENAI_API_KEY")

    await repo.save_podcast_segment_audio(
        episode_id, seq, audio, podcast_service.estimate_duration_secs(turns)
    )

    return StreamingResponse(
        io.BytesIO(audio),
        media_type="audio/mpeg",
        headers={
            "Content-Length": str(len(audio)),
            "Cache-Control": "public, max-age=604800",
            "Accept-Ranges": "bytes",
        },
    )


@router.get("/podcast/{episode_id}/full")
async def stream_podcast_full(
    episode_id: UUID,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Episódio inteiro num arquivo só, para tocar sem interrupção.

    Tocar segmento a segmento dependia do JS acordar exatamente no fim de
    cada parte pra buscar a próxima — no celular, com a tela bloqueada
    durante o trajeto, esse acordar não é garantido, e o áudio parava no
    meio. Concatenar os segmentos já sintetizados resolve isso: o telefone
    só precisa tocar um <audio> só, do início ao fim.
    """
    from fastapi import HTTPException
    import io

    ep = await repo.get_podcast_episode(episode_id)
    if not ep:
        raise HTTPException(404, "Episódio não encontrado")

    turns = ep.get("turns") or []
    blocks = sorted({t.get("block", 0) for t in turns})
    if not blocks:
        raise HTTPException(404, "Episódio sem conteúdo")

    cached = await repo.get_podcast_segments_cached(episode_id)
    missing = [b for b in blocks if b not in cached or not cached[b]["audio"]]

    if missing:
        from prf.services import podcast_service

        async def _synth(seq: int) -> tuple[int, bytes, int]:
            seg_turns = [t for t in turns if t.get("block") == seq]
            audio = await podcast_service.synthesize_segment(seg_turns)
            return seq, audio, podcast_service.estimate_duration_secs(seg_turns)

        results = await asyncio.gather(*[_synth(seq) for seq in missing])
        for seq, audio, dur in results:
            if not audio:
                raise HTTPException(503, "Síntese de áudio indisponível — configure OPENAI_API_KEY")
            await repo.save_podcast_segment_audio(episode_id, seq, audio, dur)
            cached[seq] = {"audio": audio, "duration_secs": dur}

    full_audio = b"".join(cached[b]["audio"] for b in blocks)
    boundaries = []
    acc = 0
    for b in blocks:
        acc += cached[b]["duration_secs"] or 0
        boundaries.append(acc)

    return StreamingResponse(
        io.BytesIO(full_audio),
        media_type="audio/mpeg",
        headers={
            "Content-Length": str(len(full_audio)),
            "Cache-Control": "public, max-age=604800",
            "X-Segment-Boundaries": ",".join(str(x) for x in boundaries),
        },
    )


@router.get("/podcast/{episode_id}/transcript")
async def get_podcast_transcript(
    episode_id: UUID,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Roteiro do episódio, para acompanhar ou revisar sem áudio."""
    from fastapi import HTTPException

    ep = await repo.get_podcast_episode(episode_id)
    if not ep:
        raise HTTPException(404, "Episódio não encontrado")
    return {"title": ep["title"], "turns": ep.get("turns") or []}
