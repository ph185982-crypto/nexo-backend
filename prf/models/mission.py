"""Daily mission models."""
from __future__ import annotations
from datetime import date, datetime
from enum import Enum
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field

from .user import StudyMode, EnergyLevel


class MissionStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    SKIPPED = "skipped"
    PARTIAL = "partial"


class BlockType(str, Enum):
    REVIEW = "review"
    QUESTIONS = "questions"
    LEGAL_READING = "legal_reading"
    FLASHCARDS = "flashcards"
    AUDIO_LESSON = "audio_lesson"
    SIMULATED = "simulated"


class MissionBlockOut(BaseModel):
    id: UUID
    block_type: BlockType
    subject_name: Optional[str] = None
    topic_name: Optional[str] = None
    title: str
    description: Optional[str] = None
    estimated_mins: int
    display_order: int
    content_ids: list[UUID] = Field(default_factory=list)
    is_completed: bool = False
    is_optional: bool = False
    mode: StudyMode = StudyMode.FOCUS


class DailyMissionOut(BaseModel):
    id: UUID
    date: date
    status: MissionStatus
    estimated_mins: int
    actual_mins: Optional[int] = None
    mode_suggested: StudyMode
    energy_detected: Optional[EnergyLevel] = None
    greeting: Optional[str] = None
    blocks: list[MissionBlockOut] = Field(default_factory=list)
    blocks_total: int = 0
    blocks_done: int = 0
    xp_earned: int = 0
    progress_pct: float = 0


class MissionBlockComplete(BaseModel):
    block_id: UUID
    time_spent_mins: Optional[int] = None


class MissionSummary(BaseModel):
    mission_completed: bool
    total_blocks: int
    blocks_completed: int
    time_studied_mins: float
    questions_answered: int
    accuracy: float
    xp_earned: int
    streak_updated: bool
    next_review_count: int
