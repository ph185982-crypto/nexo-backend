"""
Smart Notification Service — generates contextual, useful notifications.

Types:
  - mission_start: beginning of the study day
  - commute_time: time to switch to audio mode
  - review_due: overdue spaced repetition reviews
  - session_end: wrap up current session
  - goal_reached: congratulations on hitting a goal
  - streak_warning: about to break a streak
  - gentle_return: soft reminder after missing a day
  - weekly_report: end-of-week summary
"""
from __future__ import annotations
from datetime import datetime, time, timedelta, timezone
from typing import Optional
from uuid import UUID

from prf.database.repository import PRFRepository

# O servidor roda em UTC e o candidato estuda no horário de Brasília. Comparar
# o silêncio noturno contra a hora do servidor faria a plataforma calar às 19h
# e cobrar às 4h da manhã.
BRT = timezone(timedelta(hours=-3))


NOTIFICATION_TEMPLATES = {
    "mission_start": {
        "title": "Missão do dia pronta",
        "templates": [
            "Sua missão de hoje está preparada. {mins} minutos de estudo focado.",
            "Hora de avançar. {mins} minutos separam você do progresso de hoje.",
        ],
    },
    "commute_time": {
        "title": "Modo deslocamento",
        "templates": [
            "No trânsito? Ative o modo áudio e aproveite o tempo.",
            "Deslocamento detectado. Conteúdo em áudio preparado.",
        ],
    },
    "review_due": {
        "title": "Revisões pendentes",
        "templates": [
            "{count} revisões vencem hoje. 10 minutos resolvem.",
            "Revisão espaçada: {count} itens aguardando. Não deixe acumular.",
        ],
    },
    "streak_warning": {
        "title": "Sequência em risco",
        "templates": [
            "Sua sequência de {streak} dias pode acabar hoje. 5 minutos bastam para mantê-la.",
            "{streak} dias seguidos. Não quebre agora — uma sessão rápida resolve.",
        ],
    },
    "gentle_return": {
        "title": "Sentimos sua falta",
        "templates": [
            "Sem pressão. Uma sessão leve de 10 minutos já conta.",
            "Um dia sem estudar é normal. Volte com calma — preparei algo leve.",
        ],
    },
    "goal_reached": {
        "title": "Meta atingida!",
        "templates": [
            "Você completou a meta de hoje. Excelente disciplina.",
            "Missão cumprida. Descanse — amanhã tem mais.",
        ],
    },
    "weekly_report": {
        "title": "Relatório semanal",
        "templates": [
            "Semana encerrada: {hours}h estudadas, {accuracy}% de acurácia. {trend}.",
        ],
    },
}


class NotificationService:
    def __init__(self, repo: PRFRepository):
        self.repo = repo

    async def check_and_queue_notifications(self, user_id: UUID):
        """Check all notification triggers and queue relevant ones."""
        prefs = await self.repo.get_notification_prefs(user_id)
        if not prefs:
            return

        now = datetime.now(BRT)
        quiet_start = prefs.get("quiet_start")
        quiet_end = prefs.get("quiet_end")
        if quiet_start and quiet_end:
            current_time = now.time()
            if isinstance(quiet_start, str):
                quiet_start = time.fromisoformat(quiet_start)
            if isinstance(quiet_end, str):
                quiet_end = time.fromisoformat(quiet_end)
            if quiet_start <= current_time or current_time <= quiet_end:
                return

        if prefs.get("review_due", True):
            await self._check_review_due(user_id)

        if prefs.get("streak_warning", True):
            await self._check_streak_warning(user_id)

        if prefs.get("mission_reminder", True):
            await self._check_mission_reminder(user_id)

    async def _check_review_due(self, user_id: UUID):
        count = await self.repo.count_due_reviews(user_id)
        if count >= 5:
            import random
            template = random.choice(NOTIFICATION_TEMPLATES["review_due"]["templates"])
            await self.repo.create_notification(user_id, {
                "type": "review_due",
                "title": NOTIFICATION_TEMPLATES["review_due"]["title"],
                "body": template.format(count=count),
            })

    async def _check_streak_warning(self, user_id: UUID):
        streak = await self.repo.get_streak(user_id)
        if not streak or streak["current_streak"] < 3:
            return

        from datetime import date, timedelta
        today = date.today()
        if streak["last_active_date"] == today - timedelta(days=1):
            mission = await self.repo.get_todays_mission(user_id)
            if not mission or mission["status"] == "pending":
                import random
                template = random.choice(NOTIFICATION_TEMPLATES["streak_warning"]["templates"])
                await self.repo.create_notification(user_id, {
                    "type": "streak_warning",
                    "title": NOTIFICATION_TEMPLATES["streak_warning"]["title"],
                    "body": template.format(streak=streak["current_streak"]),
                })

    async def _check_mission_reminder(self, user_id: UUID):
        mission = await self.repo.get_todays_mission(user_id)
        if not mission or mission["status"] != "pending":
            return

        import random
        template = random.choice(NOTIFICATION_TEMPLATES["mission_start"]["templates"])
        await self.repo.create_notification(user_id, {
            "type": "mission_start",
            "title": NOTIFICATION_TEMPLATES["mission_start"]["title"],
            "body": template.format(mins=mission.get("estimated_mins", 30)),
        })

    async def send_goal_reached(self, user_id: UUID):
        import random
        template = random.choice(NOTIFICATION_TEMPLATES["goal_reached"]["templates"])
        await self.repo.create_notification(user_id, {
            "type": "goal_reached",
            "title": NOTIFICATION_TEMPLATES["goal_reached"]["title"],
            "body": template,
        })

    async def send_gentle_return(self, user_id: UUID):
        import random
        template = random.choice(NOTIFICATION_TEMPLATES["gentle_return"]["templates"])
        await self.repo.create_notification(user_id, {
            "type": "gentle_return",
            "title": NOTIFICATION_TEMPLATES["gentle_return"]["title"],
            "body": template,
        })
