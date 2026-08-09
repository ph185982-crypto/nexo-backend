"""Onboarding router — collects user profile and routine, generates initial plan."""
from fastapi import APIRouter, Depends, HTTPException
from uuid import UUID

from prf.models.user import (
    OnboardingRequest, OnboardingResponse, UserProfile, RoutineOut,
)
from prf.routers.deps import get_repo, get_current_user_id, get_study_service
from prf.database.repository import PRFRepository
from prf.services.study_service import StudyService

router = APIRouter()


@router.post("/complete", response_model=OnboardingResponse)
async def complete_onboarding(
    body: OnboardingRequest,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
    study: StudyService = Depends(get_study_service),
):
    profile = await repo.upsert_profile(user_id, {
        "target_exam": body.target_exam,
        "exam_date": body.exam_date,
        "weekly_goal_hours": body.weekly_goal_hours,
        "preferred_format": body.preferred_format.value,
        "audio_preference": body.audio_preference,
        "study_level": body.study_level.value,
        "priority_subjects": body.priority_subjects,
    })

    for day in body.routines:
        await repo.upsert_routine(user_id, day.model_dump())

    # Initialize default notification preferences
    existing_prefs = await repo.get_notification_prefs(user_id)
    if not existing_prefs:
        await repo._execute(
            """INSERT INTO notification_preferences (user_id) VALUES ($1)
               ON CONFLICT (user_id) DO NOTHING""",
            user_id,
        )

    # Initialize streak and XP
    await repo.update_streak(user_id)
    await repo.add_xp(user_id, 50, "onboarding_complete")

    # Generate first daily mission
    mission_ready = False
    try:
        await study.generate_daily_mission(user_id)
        mission_ready = True
    except Exception:
        pass

    return OnboardingResponse(
        profile_id=profile["id"],
        plan_generated=True,
        first_mission_ready=mission_ready,
        message="Perfil configurado. Sua primeira missão está pronta.",
    )


@router.get("/profile", response_model=UserProfile)
async def get_profile(
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    profile = await repo.get_profile(user_id)
    if not profile:
        raise HTTPException(404, "Profile not found. Complete onboarding first.")
    return UserProfile(**profile)


@router.get("/routines", response_model=list[RoutineOut])
async def get_routines(
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    routines = await repo.get_routines(user_id)
    return [RoutineOut(
        day_of_week=r["day_of_week"],
        study_minutes=r["study_minutes"],
        commute_minutes=r["commute_minutes"],
        typical_energy=r["typical_energy"],
        is_rest_day=r["is_rest_day"],
        available_from=str(r["available_from"]) if r.get("available_from") else None,
        available_to=str(r["available_to"]) if r.get("available_to") else None,
        commute_start=str(r["commute_start"]) if r.get("commute_start") else None,
        commute_end=str(r["commute_end"]) if r.get("commute_end") else None,
    ) for r in routines]


@router.patch("/profile")
async def update_profile(
    body: dict,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Update exam_date/weekly_goal_hours/study_level without touching XP/streak/mission.

    Existia um bug em que salvar o perfil em Configurações reusava
    /onboarding/complete, que dá +50 XP de bônus a cada chamada — usuário
    ganhava XP de graça só de ajustar a rotina de estudo.
    """
    fields = {}
    for key in ("exam_date", "weekly_goal_hours", "study_level"):
        if key in body:
            fields[key] = body[key]
    if not fields:
        return {"updated": False}
    set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(fields))
    await repo._execute(
        f"UPDATE user_profiles SET {set_clause}, updated_at = NOW() WHERE user_id = $1",
        user_id, *fields.values(),
    )
    return {"updated": True}


@router.patch("/routines")
async def update_routines(
    body: dict,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Bulk update the weekly routine (7 days) without touching profile/XP/mission.

    day_of_week segue o padrão Python weekday(): 0=segunda ... 6=domingo.
    """
    routines = body.get("routines", [])
    for day in routines:
        await repo.upsert_routine(user_id, day)
    return {"saved": len(routines)}


@router.patch("/target-exam")
async def set_target_exam(
    body: dict,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Update only the target exam without touching other profile settings."""
    exam = (body.get("target_exam") or "PRF").upper()
    if exam not in ("PRF", "PMGO", "PM"):
        raise HTTPException(400, "target_exam deve ser PRF ou PMGO")
    await repo._execute(
        """INSERT INTO user_profiles (user_id, target_exam, onboarding_complete)
           VALUES ($1, $2, TRUE)
           ON CONFLICT (user_id) DO UPDATE SET target_exam = $2, updated_at = NOW()""",
        user_id, exam,
    )
    return {"target_exam": exam}


@router.get("/subjects")
async def list_subjects(
    exam: str = "ALL",
    repo: PRFRepository = Depends(get_repo),
):
    subjects = await repo.get_subjects()
    exam = exam.upper()
    if exam == "PMGO":
        subjects = [s for s in subjects if (s.get("weight_pm") or 0) > 0]
    elif exam == "PRF":
        subjects = [s for s in subjects if (s.get("weight_prf") or 0) > 0]
    return {"subjects": subjects}


@router.get("/resources")
async def list_resources(subject_slug: str | None = None):
    """Curated external study resources (videos, PDFs, articles) by subject."""
    from prf.seeds.external_resources import EXTERNAL_RESOURCES
    if subject_slug:
        return [r for r in EXTERNAL_RESOURCES if r["subject_slug"] == subject_slug]
    return EXTERNAL_RESOURCES
