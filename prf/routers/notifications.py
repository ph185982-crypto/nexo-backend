"""Notifications router — pending notifications, preferences."""
from fastapi import APIRouter, Depends, Header, HTTPException
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


@router.get("/push/chave-publica")
async def push_public_key():
    """Chave VAPID que o navegador precisa para se inscrever."""
    from prf.services import push_service
    return {
        "public_key": push_service.VAPID_PUBLIC_KEY or None,
        "configured": push_service.is_configured(),
    }


@router.post("/push/inscrever")
async def push_subscribe(
    body: dict,
    user_agent: str | None = Header(default=None),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Guarda a inscrição de push deste aparelho."""
    endpoint = (body or {}).get("endpoint")
    keys = (body or {}).get("keys") or {}
    p256dh, auth = keys.get("p256dh"), keys.get("auth")
    if not endpoint or not p256dh or not auth:
        raise HTTPException(400, "Inscrição inválida: faltam endpoint ou chaves")

    await repo._execute(
        """INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (endpoint) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             p256dh  = EXCLUDED.p256dh,
             auth    = EXCLUDED.auth""",
        user_id, endpoint, p256dh, auth, (user_agent or "")[:300],
    )
    return {"inscrito": True}


@router.post("/push/cancelar")
async def push_unsubscribe(
    body: dict,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Remove a inscrição deste aparelho."""
    endpoint = (body or {}).get("endpoint")
    if not endpoint:
        raise HTTPException(400, "endpoint é obrigatório")
    await repo._execute(
        "DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2",
        endpoint, user_id,
    )
    return {"inscrito": False}


@router.post("/push/testar")
async def push_test(
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Dispara uma notificação de teste para os aparelhos deste usuário."""
    from prf.services import push_service

    if not push_service.is_configured():
        raise HTTPException(503, "Push não configurado (faltam as chaves VAPID)")

    subs = await repo._fetch(
        "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1",
        user_id,
    )
    if not subs:
        raise HTTPException(404, "Nenhum aparelho inscrito")

    ok = 0
    for s in subs:
        status = await push_service.send_push(
            dict(s), title="Estudo PRF",
            body="Notificações ligadas. É por aqui que eu vou te cobrar.",
        )
        if status < 300:
            ok += 1
    return {"aparelhos": len(subs), "entregues": ok}


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
