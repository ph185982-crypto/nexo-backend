"""Missions router — daily mission generation, block completion, progress."""
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from uuid import UUID

from prf.models.user import EnergyLevel, StudyMode
from prf.models.mission import DailyMissionOut, MissionBlockComplete, MissionSummary, MissionBlockOut
from prf.routers.deps import get_repo, get_current_user_id, get_study_service
from prf.database.repository import PRFRepository
from prf.services.study_service import StudyService

router = APIRouter()


@router.get("/today", response_model=DailyMissionOut)
async def get_today_mission(
    energy: Optional[EnergyLevel] = None,
    mode: Optional[StudyMode] = None,
    force: bool = False,
    user_id: UUID = Depends(get_current_user_id),
    study: StudyService = Depends(get_study_service),
):
    """Get or generate today's mission. force=true descarta a missão de hoje e gera outra."""
    mission = await study.generate_daily_mission(user_id, energy=energy, mode=mode, force=force)
    if not mission:
        raise HTTPException(404, "Could not generate mission")

    blocks = mission.get("blocks", [])
    total = mission.get("blocks_total", len(blocks))
    done = mission.get("blocks_done", sum(1 for b in blocks if b.get("is_completed")))

    return DailyMissionOut(
        id=mission["id"],
        date=mission["date"],
        status=mission["status"],
        estimated_mins=mission.get("estimated_mins", 0),
        actual_mins=mission.get("actual_mins"),
        mode_suggested=mission.get("mode_suggested", "focus"),
        energy_detected=mission.get("energy_detected"),
        greeting=mission.get("greeting"),
        blocks=[
            MissionBlockOut(
                id=b["id"],
                block_type=b["block_type"],
                subject_id=b.get("subject_id"),
                subject_name=b.get("subject_name"),
                title=b["title"],
                description=b.get("description"),
                estimated_mins=b.get("estimated_mins", 10),
                display_order=b.get("display_order", 0),
                content_ids=b.get("content_ids", []),
                is_completed=b.get("is_completed", False),
                is_optional=b.get("is_optional", False),
                mode=b.get("mode", "focus"),
            )
            for b in blocks
        ],
        blocks_total=total,
        blocks_done=done,
        xp_earned=mission.get("xp_earned", 0),
        progress_pct=round((done / max(total, 1)) * 100, 1),
    )


@router.post("/blocks/complete")
async def complete_block(
    body: MissionBlockComplete,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
    study: StudyService = Depends(get_study_service),
):
    """Mark a mission block as completed."""
    block = await repo.complete_mission_block(body.block_id)
    if not block:
        raise HTTPException(404, "Block not found")

    mission = await repo.get_todays_mission(user_id)
    if mission:
        total = mission["blocks_total"]
        done = mission["blocks_done"]
        if done >= total and total > 0:
            xp = 50
            await repo.complete_mission(mission["id"], body.time_spent_mins or 0, xp)
            await repo.add_xp(user_id, xp, "mission_complete")
            await repo.update_streak(user_id)

    return {"completed": True, "block_id": body.block_id}


@router.get("/history")
async def mission_history(
    days: int = 7,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Get recent mission history."""
    analytics = await repo.get_daily_analytics(user_id, days=days)
    return {"history": analytics}
