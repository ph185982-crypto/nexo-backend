"""Study sessions router — start, end, list sessions."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from uuid import UUID

from prf.models.study import SessionStart, SessionOut, SessionEnd
from prf.models.user import EnergyLevel, EnergyLog
from prf.routers.deps import get_repo, get_current_user_id, get_study_service
from prf.database.repository import PRFRepository
from prf.services.study_service import StudyService

router = APIRouter()


@router.post("/start", response_model=SessionOut)
async def start_session(
    body: SessionStart,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Start a new study session."""
    session = await repo.create_session(
        user_id,
        mode=body.mode.value,
        energy=body.energy.value if body.energy else None,
    )
    return SessionOut(
        id=session["id"],
        started_at=session["started_at"],
        mode=body.mode,
        questions_total=0,
        questions_correct=0,
        is_completed=False,
    )


@router.post("/{session_id}/end", response_model=SessionOut)
async def end_session(
    session_id: UUID,
    body: SessionEnd,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
    study: StudyService = Depends(get_study_service),
):
    """End a study session."""
    attempts = await repo._fetch(
        "SELECT is_correct FROM question_attempts WHERE session_id = $1",
        session_id,
    )
    total = len(attempts)
    correct = sum(1 for a in attempts if a["is_correct"])

    session_data = await repo._fetchrow(
        "SELECT started_at FROM study_sessions WHERE id = $1", session_id,
    )
    if not session_data:
        raise HTTPException(404, "Session not found")

    from datetime import datetime
    duration = (datetime.utcnow() - session_data["started_at"]).total_seconds() / 60

    session = await repo.end_session(session_id, {
        "energy_at_end": body.energy_at_end.value if body.energy_at_end else None,
        "duration_mins": round(duration, 1),
        "questions_total": total,
        "questions_correct": correct,
    })

    xp = max(5, int(duration * 2))
    await repo.add_xp(user_id, xp, "session_complete")
    await repo.update_streak(user_id)

    await study.update_behavior_metrics(user_id)

    return SessionOut(
        id=session["id"],
        started_at=session["started_at"],
        ended_at=session.get("ended_at"),
        mode=session.get("mode", "focus"),
        duration_mins=session.get("duration_mins"),
        questions_total=total,
        questions_correct=correct,
        is_completed=True,
    )


@router.get("/history", response_model=list[SessionOut])
async def session_history(
    limit: int = Query(default=20, ge=1, le=100),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Get recent session history."""
    sessions = await repo.get_sessions(user_id, limit=limit)
    return [
        SessionOut(
            id=s["id"],
            started_at=s["started_at"],
            ended_at=s.get("ended_at"),
            mode=s.get("mode", "focus"),
            duration_mins=s.get("duration_mins"),
            questions_total=s.get("questions_total", 0),
            questions_correct=s.get("questions_correct", 0),
            is_completed=s.get("is_completed", False),
        )
        for s in sessions
    ]


@router.post("/energy")
async def log_energy(
    body: EnergyLog,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Log current energy level."""
    from datetime import datetime
    hour = datetime.now().hour
    await repo._execute(
        """INSERT INTO user_energy_logs (user_id, energy, context, hour_of_day)
           VALUES ($1, $2, $3, $4)""",
        user_id, body.energy.value, body.context, hour,
    )
    return {"logged": True, "energy": body.energy.value}
