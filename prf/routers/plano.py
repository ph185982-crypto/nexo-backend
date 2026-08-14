"""Plano router — trajetória do candidato: calendário do hoje até a prova."""
from uuid import UUID

from fastapi import APIRouter, Depends

from prf.routers.deps import get_repo, get_current_user_id
from prf.database.repository import PRFRepository
from prf.services.plan_service import PlanService

router = APIRouter()


@router.get("/calendario")
async def calendario(
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Calendário completo: o que já foi feito (com visto) e o que vem pela frente."""
    return await PlanService(repo).build_calendar(user_id)
