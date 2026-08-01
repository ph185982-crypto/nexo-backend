from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from uuid import UUID


@dataclass
class TopicSnapshot:
    topic_id: UUID
    topic_name: str
    mastery_score: float          # 0-100
    attempts: int
    correct_rate: float           # 0-1
    last_studied: Optional[datetime]
    weight_in_subject: float      # relative importance


@dataclass
class SubjectMasterySnapshot:
    subject_id: UUID
    subject_slug: str
    subject_name: str
    weight: float                 # exam weight (weight_prf or weight_pm)
    mastery_score: float          # 0-100
    correct_rate: float           # 0-1
    total_attempts: int
    coverage_ratio: float         # fraction of topics attempted
    topics: list[TopicSnapshot] = field(default_factory=list)


@dataclass
class ReviewQueueItem:
    card_id: UUID
    question_id: UUID
    subject_id: UUID
    topic_id: Optional[UUID]
    due_date: datetime
    ease_factor: float
    interval_days: int
    overdue_days: int             # max(0, today - due_date)


@dataclass
class RecentError:
    question_id: UUID
    subject_id: UUID
    topic_id: Optional[UUID]
    answered_at: datetime
    correct_answer: str
    user_answer: str


@dataclass
class MissionHistoryEntry:
    mission_id: UUID
    date: datetime
    completed: bool
    completion_rate: float        # 0-1
    score: Optional[float]
    duration_minutes: int


@dataclass
class DecisionInput:
    user_id: UUID
    target_exam: str              # "PRF" | "PMGO"
    available_minutes: int
    current_hour: int             # 0-23, used for energy modeling
    mastery_snapshots: list[SubjectMasterySnapshot]
    review_queue: list[ReviewQueueItem]
    recent_errors: list[RecentError]
    mission_history: list[MissionHistoryEntry]
    days_until_exam: Optional[int]
    streak_days: int
    approval_estimate: float      # 0-100
    exam_date: Optional[datetime] = None
