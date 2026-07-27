"""User, profile, routine, and behavior models."""
from __future__ import annotations
from datetime import date, time, datetime
from enum import Enum
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field


class EnergyLevel(str, Enum):
    VERY_LOW = "very_low"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    VERY_HIGH = "very_high"


class StudyMode(str, Enum):
    FOCUS = "focus"
    COMMUTE = "commute"
    MICRO = "micro"
    TIRED = "tired"
    HIGH_ENERGY = "high_energy"


class StudyLevel(str, Enum):
    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"


class ContentFormat(str, Enum):
    TEXT = "text"
    AUDIO = "audio"
    FLASHCARD = "flashcard"
    QUESTION = "question"
    LEGAL_ARTICLE = "legal_article"
    SIMULATED = "simulated"


# ── Registration / Auth ──────────────────────────────────────────────────────

class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str = Field(min_length=2, max_length=100)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: UUID
    email: str
    name: str
    created_at: datetime
    last_login_at: Optional[datetime] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ── Onboarding ───────────────────────────────────────────────────────────────

class DayRoutine(BaseModel):
    day_of_week: int = Field(ge=0, le=6)
    available_from: Optional[str] = None    # HH:MM
    available_to: Optional[str] = None
    study_minutes: int = 90
    commute_start: Optional[str] = None
    commute_end: Optional[str] = None
    commute_minutes: int = 0
    work_start: Optional[str] = None
    work_end: Optional[str] = None
    typical_energy: EnergyLevel = EnergyLevel.MEDIUM
    is_rest_day: bool = False


class OnboardingRequest(BaseModel):
    target_exam: str = "PRF"
    exam_date: Optional[date] = None
    weekly_goal_hours: float = Field(default=10.0, ge=1, le=40)
    preferred_format: ContentFormat = ContentFormat.TEXT
    audio_preference: bool = True
    study_level: StudyLevel = StudyLevel.BEGINNER
    priority_subjects: list[str] = Field(default_factory=list)
    routines: list[DayRoutine] = Field(default_factory=list)


class OnboardingResponse(BaseModel):
    profile_id: UUID
    plan_generated: bool
    first_mission_ready: bool
    message: str


# ── Profile ──────────────────────────────────────────────────────────────────

class UserProfile(BaseModel):
    id: UUID
    user_id: UUID
    target_exam: str
    exam_date: Optional[date] = None
    weekly_goal_hours: float
    preferred_format: ContentFormat
    audio_preference: bool
    onboarding_complete: bool
    study_level: str
    priority_subjects: list[str]


class RoutineOut(BaseModel):
    day_of_week: int
    study_minutes: int
    commute_minutes: int
    typical_energy: EnergyLevel
    is_rest_day: bool
    available_from: Optional[str] = None
    available_to: Optional[str] = None
    commute_start: Optional[str] = None
    commute_end: Optional[str] = None


# ── Behavior ─────────────────────────────────────────────────────────────────

class BehaviorMetrics(BaseModel):
    best_study_hour: Optional[int] = None
    avg_session_minutes: float = 0
    avg_accuracy: float = 0
    avg_questions_per_day: float = 0
    preferred_block_size: int = 15
    total_study_hours: float = 0
    total_questions: int = 0
    total_correct: int = 0
    consistency_score: float = 0
    retention_score: float = 0
    fatigue_threshold_mins: int = 45
    days_active: int = 0


class EnergyLog(BaseModel):
    energy: EnergyLevel
    context: Optional[str] = None


# ── Study Context (passed to engines) ────────────────────────────────────────

class UserStudyContext(BaseModel):
    user_id: UUID
    current_energy: EnergyLevel = EnergyLevel.MEDIUM
    current_mode: StudyMode = StudyMode.FOCUS
    available_minutes: int = 30
    hour_of_day: int = 12
    day_of_week: int = 0
    is_commuting: bool = False
    exam_date: Optional[date] = None
    days_until_exam: Optional[int] = None
