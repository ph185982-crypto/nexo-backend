"""
Raw data types that the LearningRepositoryPort returns.
These are projection types — the infrastructure layer maps from DB rows to these.
No domain logic here.
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
from uuid import UUID


@dataclass
class AttemptRecord:
    """One question attempt by one user."""
    id: UUID
    user_id: UUID
    question_id: UUID
    subject_id: Optional[UUID]
    topic_id: Optional[UUID]
    is_correct: bool
    time_spent_secs: Optional[int]   # None if not recorded
    confidence: Optional[int]        # 1-5 self-rating, None if not recorded
    session_id: Optional[UUID]
    answered_at: datetime


@dataclass
class SessionRecord:
    """A completed (or ongoing) study session."""
    id: UUID
    user_id: UUID
    mode: str                        # "questions" | "review" | "simulation" | "reading" | "audio"
    energy_at_start: Optional[str]   # "high" | "medium" | "low" | None
    energy_at_end: Optional[str]
    started_at: datetime
    ended_at: Optional[datetime]
    duration_mins: Optional[int]
    questions_total: int
    questions_correct: int
    is_completed: bool


@dataclass
class ReviewCardRecord:
    """An SM-2 spaced repetition card."""
    question_id: Optional[UUID]
    flashcard_id: Optional[UUID]
    article_id: Optional[UUID]
    subject_id: Optional[UUID]       # joined from questions table
    topic_id: Optional[UUID]         # joined from questions table
    ease_factor: float               # SM-2 EF, default 2.5, range 1.3-3.5+
    interval_days: int               # current interval
    repetitions: int
    next_review: datetime
    last_review: Optional[datetime]
    last_quality: Optional[int]      # 0-5 quality rating
    total_reviews: int
    total_correct: int
    streak: int                      # consecutive correct
    lapsed: bool                     # card reverted to learning phase
    is_overdue: bool                 # next_review < now


@dataclass
class ErrorRecord:
    """An entry in the user's error notebook."""
    question_id: UUID
    subject_id: Optional[UUID]
    topic_id: Optional[UUID]
    times_repeated: int              # how many times this error recurred
    resolved: bool
    last_error_at: datetime
    error_type: Optional[str]        # category of error if available


@dataclass
class MasteryRecord:
    """Subject or topic-level mastery snapshot."""
    subject_id: UUID
    topic_id: Optional[UUID]         # None = subject-level
    mastery_level: float             # 0-1
    total_attempts: int
    total_correct: int
    accuracy: float                  # 0-1
    last_studied: Optional[datetime]
    error_count: int


@dataclass
class BehaviorMetricsRecord:
    """Pre-aggregated behavioral stats from user_behavior_metrics table."""
    best_study_hour: Optional[int]
    avg_session_minutes: float
    avg_accuracy: float
    avg_questions_per_day: float
    preferred_block_size: int
    total_study_hours: float
    total_questions: int
    total_correct: int
    consistency_score: float
    retention_score: float
    fatigue_threshold_mins: int
    days_active: int
    last_computed_at: Optional[datetime]
