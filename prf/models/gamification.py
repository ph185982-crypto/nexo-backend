"""Gamification models — XP, streaks, achievements."""
from __future__ import annotations
from datetime import date, datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field


class StreakOut(BaseModel):
    current_streak: int = 0
    longest_streak: int = 0
    last_active_date: Optional[date] = None
    freeze_available: int = 1


class XPOut(BaseModel):
    total_xp: int = 0
    level: int = 1
    xp_to_next: int = 100
    level_progress_pct: float = 0


class XPTransaction(BaseModel):
    amount: int
    reason: str
    created_at: datetime


class AchievementOut(BaseModel):
    id: UUID
    slug: str
    name: str
    description: str
    category: str
    icon: Optional[str] = None
    xp_reward: int = 0
    unlocked: bool = False
    unlocked_at: Optional[datetime] = None


class GamificationSummary(BaseModel):
    streak: StreakOut
    xp: XPOut
    recent_achievements: list[AchievementOut] = Field(default_factory=list)
    achievements_total: int = 0
    achievements_unlocked: int = 0
