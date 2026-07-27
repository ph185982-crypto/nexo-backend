"""Dashboard router — main dashboard, analytics, approval estimate."""
from fastapi import APIRouter, Depends, Query
from typing import Optional
from uuid import UUID

from prf.models.analytics import DashboardResponse, SubjectProgress, ApprovalEstimate
from prf.routers.deps import get_repo, get_current_user_id, get_study_service
from prf.database.repository import PRFRepository
from prf.services.study_service import StudyService

router = APIRouter()


@router.get("/", response_model=DashboardResponse)
async def get_dashboard(
    user_id: UUID = Depends(get_current_user_id),
    study: StudyService = Depends(get_study_service),
):
    """Get the main dashboard data."""
    return await study.get_dashboard(user_id)


@router.get("/subjects", response_model=list[SubjectProgress])
async def get_subject_progress(
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Get progress breakdown by subject."""
    mastery = await repo.get_subject_mastery(user_id)
    return [
        SubjectProgress(
            subject_id=m["subject_id"],
            subject_name=m["subject_name"],
            accuracy=m.get("accuracy", 0),
            mastery_level=m.get("mastery_level", 0),
            total_attempts=m.get("total_attempts", 0),
            total_correct=m.get("total_correct", 0),
            study_time_mins=m.get("study_time_mins", 0),
            error_count=m.get("error_count", 0),
            weight_prf=m.get("weight_prf", 1.0),
            last_studied=m.get("last_studied"),
        )
        for m in mastery
    ]


@router.get("/approval-estimate")
async def get_approval_estimate(
    user_id: UUID = Depends(get_current_user_id),
    study: StudyService = Depends(get_study_service),
):
    """Compute and return current approval probability estimate."""
    return await study.compute_approval_estimate(user_id)


@router.get("/weekly")
async def get_weekly_stats(
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Get weekly analytics data."""
    daily = await repo.get_daily_analytics(user_id, days=7)
    total_mins = sum(d.get("study_minutes", 0) for d in daily)
    total_q = sum(d.get("questions_total", 0) for d in daily)
    total_c = sum(d.get("questions_correct", 0) for d in daily)
    missions_done = sum(1 for d in daily if d.get("mission_completed"))

    return {
        "days": daily,
        "summary": {
            "total_hours": round(total_mins / 60, 1),
            "total_questions": total_q,
            "accuracy": round(total_c / max(total_q, 1) * 100, 1),
            "missions_completed": missions_done,
            "missions_total": len(daily),
        },
    }


@router.get("/streak")
async def get_streak_info(
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Get streak information."""
    streak = await repo.get_streak(user_id)
    xp = await repo.get_xp(user_id)

    return {
        "streak": {
            "current": streak["current_streak"] if streak else 0,
            "longest": streak["longest_streak"] if streak else 0,
            "last_active": str(streak["last_active_date"]) if streak and streak.get("last_active_date") else None,
        },
        "xp": {
            "total": xp["total_xp"] if xp else 0,
            "level": xp["level"] if xp else 1,
            "to_next": xp["xp_to_next"] if xp else 100,
        },
    }


@router.get("/achievements")
async def get_achievements(
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Get user achievements."""
    achievements = await repo.get_achievements(user_id)
    unlocked = [a for a in achievements if a.get("unlocked")]
    locked = [a for a in achievements if not a.get("unlocked")]

    return {
        "unlocked": unlocked,
        "locked": locked,
        "total": len(achievements),
        "unlocked_count": len(unlocked),
    }
