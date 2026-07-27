"""Notifications router — pending notifications, preferences."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from uuid import UUID

from prf.routers.deps import get_repo, get_current_user_id
from prf.database.repository import PRFRepository

router = APIRouter()


class NotificationPrefsUpdate(BaseModel):
    mission_reminder: Optional[bool] = None
    commute_reminder: Optional[bool] = None
    review_due: Optional[bool] = None
    streak_warning: Optional[bool] = None
    weekly_report: Optional[bool] = None
    quiet_start: Optional[str] = None   # HH:MM
    quiet_end: Optional[str] = None


@router.get("/pending")
async def get_pending(
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Get pending notifications."""
    notifications = await repo.get_pending_notifications(user_id)
    return {"notifications": notifications}


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: UUID,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Mark a notification as read."""
    await repo._execute(
        "UPDATE notification_queue SET read_at = NOW() WHERE id = $1 AND user_id = $2",
        notification_id, user_id,
    )
    return {"read": True}


@router.get("/preferences")
async def get_preferences(
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Get notification preferences."""
    prefs = await repo.get_notification_prefs(user_id)
    return prefs or {"message": "No preferences set. Complete onboarding."}


@router.put("/preferences")
async def update_preferences(
    body: NotificationPrefsUpdate,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Update notification preferences."""
    updates = body.model_dump(exclude_none=True)
    if not updates:
        return {"updated": False}

    set_clauses = []
    params = [user_id]
    idx = 2
    for key, value in updates.items():
        set_clauses.append(f"{key} = ${idx}")
        params.append(value)
        idx += 1

    await repo._execute(
        f"UPDATE notification_preferences SET {', '.join(set_clauses)} WHERE user_id = $1",
        *params,
    )
    return {"updated": True}
