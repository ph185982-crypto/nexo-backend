"""Checklist router — fases eliminatórias além da objetiva (investigação social, psicotécnico, médica)."""
from fastapi import APIRouter, Depends
from typing import Optional
from datetime import date
from uuid import UUID
from pydantic import BaseModel

from prf.routers.deps import get_repo, get_current_user_id
from prf.database.repository import PRFRepository
from prf.seeds.checklist_items import CHECKLIST_ITEMS

router = APIRouter()


class ChecklistUpdate(BaseModel):
    is_done: bool = False
    due_date: Optional[date] = None
    notes: Optional[str] = None


@router.get("/")
async def get_checklist(
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Lista os itens fixos das fases eliminatórias, mesclados com o status do usuário."""
    status_by_key = {s["item_key"]: s for s in await repo.get_checklist_status(user_id)}

    items = []
    for item in CHECKLIST_ITEMS:
        s = status_by_key.get(item["key"])
        items.append({
            **item,
            "is_done": bool(s["is_done"]) if s else False,
            "due_date": s["due_date"] if s else None,
            "notes": s["notes"] if s else None,
        })

    by_category: dict[str, list] = {}
    for it in items:
        by_category.setdefault(it["category"], []).append(it)

    done_count = sum(1 for it in items if it["is_done"])
    return {
        "items": items,
        "by_category": by_category,
        "total": len(items),
        "done": done_count,
    }


@router.patch("/{item_key}")
async def update_checklist_item(
    item_key: str,
    body: ChecklistUpdate,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    if item_key not in {i["key"] for i in CHECKLIST_ITEMS}:
        return {"updated": False, "error": "item desconhecido"}
    row = await repo.upsert_checklist_status(user_id, item_key, body.model_dump())
    return {"updated": True, "item_key": item_key, "is_done": row["is_done"]}
