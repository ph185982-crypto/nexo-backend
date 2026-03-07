"""
Notifications Router + Service
Supports: Email (via SMTP/SendGrid) and Telegram Bot
Triggers: new product score >= threshold, daily digest
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from database.db import Database
from routers.auth import get_current_user
import httpx, smtplib, os, logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

router = APIRouter()
db = Database()
logger = logging.getLogger(__name__)


class NotifSettings(BaseModel):
    email_enabled: bool = True
    telegram_enabled: bool = False
    telegram_chat_id: Optional[str] = None
    min_score_alert: int = 85
    daily_digest: bool = True


@router.get("/settings")
async def get_settings(user=Depends(get_current_user)):
    settings = await db.get_notif_settings(user["id"])
    return settings or {}

@router.put("/settings")
async def update_settings(settings: NotifSettings, user=Depends(get_current_user)):
    await db.save_notif_settings(user["id"], settings.dict())
    return {"updated": True}

@router.post("/test")
async def test_notification(user=Depends(get_current_user)):
    settings = await db.get_notif_settings(user["id"])
    if not settings:
        return {"error": "Configure notificações primeiro"}
    await send_notification(
        user=user,
        settings=settings,
        subject="🧪 NEXO — Teste de Notificação",
        body="Suas notificações estão funcionando perfeitamente!"
    )
    return {"sent": True}

@router.get("")
async def get_notifications(limit: int=50, user=Depends(get_current_user)):
    return {"notifications": await db.get_notifications(user["id"], limit=limit)}

@router.post("/{notif_id}/read")
async def mark_read(notif_id: str, user=Depends(get_current_user)):
    await db.mark_notification_read(notif_id)
    return {"read": True}


# ── Notification Sender ───────────────────────────────────────────────────────

async def send_notification(user: dict, settings: dict, subject: str, body: str, product: dict = None):
    """Send notification via email and/or Telegram based on user settings."""
    if settings.get("email_enabled") and user.get("email"):
        await send_email(user["email"], subject, body, product)
    if settings.get("telegram_enabled") and settings.get("telegram_chat_id"):
        await send_telegram(settings["telegram_chat_id"], f"*{subject}*\n\n{body}")


async def send_email(to_email: str, subject: str, body: str, product: dict = None):
    """Send HTML email via SMTP."""
    SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER = os.getenv("SMTP_USER", "")
    SMTP_PASS = os.getenv("SMTP_PASS", "")

    if not SMTP_USER:
        logger.warning("SMTP not configured, skipping email")
        return

    product_html = ""
    if product:
        product_html = f"""
        <div style="background:#EEF3FF;border-radius:12px;padding:18px;margin:16px 0;">
          <strong>{product.get('title','')}</strong><br>
          Score: <b>{product.get('score','')}/100</b> &nbsp;|&nbsp;
          Markup: <b>×{product.get('markup','')}</b> &nbsp;|&nbsp;
          Status BR: <b>{product.get('br_status','')}</b>
        </div>"""

    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:540px;margin:0 auto;">
      <div style="background:linear-gradient(135deg,#0F2356,#1A56DB);padding:24px;border-radius:16px 16px 0 0;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:28px;">⚡ NEXO</h1>
        <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;">Product Intelligence Platform</p>
      </div>
      <div style="background:#fff;padding:28px;border:1px solid #E8ECF4;border-top:none;border-radius:0 0 16px 16px;">
        <h2 style="color:#0F2356;margin:0 0 16px;">{subject.replace('🔥 NEXO — ','').replace('🧪 NEXO — ','')}</h2>
        <p style="color:#334155;line-height:1.7;">{body}</p>
        {product_html}
        <hr style="border:none;border-top:1px solid #E8ECF4;margin:20px 0;">
        <p style="color:#94A3B8;font-size:12px;text-align:center;">NEXO Product Intelligence · Apenas você recebe este email</p>
      </div>
    </div>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"NEXO <{SMTP_USER}>"
    msg["To"]      = to_email
    msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, to_email, msg.as_string())
        logger.info(f"Email sent to {to_email}")
    except Exception as e:
        logger.error(f"Email failed: {e}")


async def send_telegram(chat_id: str, message: str):
    """Send message via Telegram Bot API."""
    BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
    if not BOT_TOKEN:
        logger.warning("TELEGRAM_BOT_TOKEN not set, skipping")
        return
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json={"chat_id": chat_id, "text": message, "parse_mode": "Markdown"})
        logger.info(f"Telegram sent to {chat_id}")
    except Exception as e:
        logger.error(f"Telegram failed: {e}")


async def notify_new_product(product: dict):
    """Called by scheduler when a high-score product is detected."""
    users = await db.get_users_with_notifications()
    for user in users:
        settings = await db.get_notif_settings(user["id"])
        if not settings:
            continue
        threshold = settings.get("min_score_alert", 85)
        if product.get("score", 0) >= threshold:
            await send_notification(
                user=user,
                settings=settings,
                subject=f"🔥 NEXO — Novo produto detectado: {product['title'][:40]}",
                body=f"A NEXO encontrou um produto com score {product['score']}/100 que ainda não está saturado no Brasil.",
                product=product
            )
            await db.create_notification(
                user_id=user["id"],
                title=f"Novo produto: {product['title'][:50]}",
                body=f"Score {product['score']}/100 · Markup ×{product.get('markup',0):.1f} · {product.get('br_status','')}",
                product_id=product.get("id")
            )
