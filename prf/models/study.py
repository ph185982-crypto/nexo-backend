"""Study session and spaced repetition models."""
from __future__ import annotations
from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field

from .user import StudyMode, EnergyLevel


class ReviewQuality(str, Enum):
    BLACKOUT = "blackout"
    WRONG = "wrong"
    HARD = "hard"
    GOOD = "good"
    EASY = "easy"


class SessionStart(BaseModel):
    mode: StudyMode = StudyMode.FOCUS
    energy: Optional[EnergyLevel] = None
    available_minutes: Optional[int] = None


class SessionOut(BaseModel):
    id: UUID
    started_at: datetime
    ended_at: Optional[datetime] = None
    mode: StudyMode
    duration_mins: Optional[float] = None
    questions_total: int
    questions_correct: int
    is_completed: bool


class SessionEnd(BaseModel):
    energy_at_end: Optional[EnergyLevel] = None


class ReviewCardOut(BaseModel):
    id: UUID
    question_id: Optional[UUID] = None
    flashcard_id: Optional[UUID] = None
    article_id: Optional[UUID] = None
    next_review: datetime
    interval_days: float
    repetitions: int
    ease_factor: float
    streak: int
    content_preview: Optional[str] = None
    subject_name: Optional[str] = None


class ReviewSubmission(BaseModel):
    card_id: UUID
    quality: ReviewQuality


class ReviewResult(BaseModel):
    card_id: UUID
    new_interval_days: float
    new_ease_factor: float
    next_review: datetime
    xp_earned: int = 0


class ReviewDueSummary(BaseModel):
    total_due: int
    overdue: int
    due_today: int
    due_tomorrow: int
    by_subject: dict[str, int] = Field(default_factory=dict)


class FlashcardOut(BaseModel):
    id: UUID
    front: str
    back: str
    subject_name: Optional[str] = None
    topic_name: Optional[str] = None
    source: str = "system"


class FlashcardCreate(BaseModel):
    front: str
    back: str
    subject_id: Optional[UUID] = None
    topic_id: Optional[UUID] = None
    question_id: Optional[UUID] = None
    article_id: Optional[UUID] = None
