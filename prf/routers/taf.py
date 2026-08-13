"""TAF router — registro de medições físicas e projeção até a prova."""
from fastapi import APIRouter, Depends
from uuid import UUID

from prf.models.taf import TAFRecordIn, TAFRecordOut, TAFTargetsIn
from prf.routers.deps import get_repo, get_current_user_id
from prf.database.repository import PRFRepository
from prf.services.taf_service import project_taf

router = APIRouter()


@router.post("/record", response_model=TAFRecordOut)
async def record_taf(
    body: TAFRecordIn,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    row = await repo.add_taf_record(user_id, body.model_dump())
    return TAFRecordOut(**row)


@router.get("/history", response_model=list[TAFRecordOut])
async def taf_history(
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    rows = await repo.get_taf_records(user_id)
    return [TAFRecordOut(**r) for r in rows]


@router.patch("/targets")
async def set_taf_targets(
    body: TAFTargetsIn,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    targets = {k: v for k, v in body.model_dump().items() if v is not None}
    await repo.update_taf_targets(user_id, targets)
    return {"taf_targets": targets}


@router.get("/projection")
async def taf_projection(
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    records = await repo.get_taf_records(user_id)
    profile = await repo.get_profile(user_id)
    targets = (profile or {}).get("taf_targets") or {}
    exam_date = (profile or {}).get("exam_date")
    projections = project_taf(records, targets, exam_date)
    return {"projections": projections, "targets": targets, "exam_date": exam_date}
