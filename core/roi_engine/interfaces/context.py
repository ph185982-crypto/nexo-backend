from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from uuid import UUID


# ── Input types (ROI Engine owns these; callers map from external types) ──

@dataclass
class GapInfo:
    """Knowledge gap produced by the KGE, projected into ROI Engine's vocabulary."""
    node_id: str
    node_type: str                  # "subject" | "topic"
    label: str
    subject_id: Optional[UUID]
    topic_id: Optional[UUID]
    gap_score: float                # 0-1: importance × mastery_deficit
    importance: float               # 0-1: normalised edital weight
    impact_score: float             # 0-1: composite (gap + error + review pressure)
    recommended_step: str           # "questions" | "review" | "flashcards" | "law"


@dataclass
class MasteryInfo:
    subject_id: UUID
    subject_slug: str
    subject_name: str
    exam_weight: float              # subject weight in the current exam
    mastery_score: float            # 0-100
    correct_rate: float             # 0-1
    total_attempts: int
    coverage_ratio: float           # 0-1: fraction of topics ever attempted


@dataclass
class ReviewInfo:
    question_id: UUID
    subject_id: UUID
    topic_id: Optional[UUID]
    overdue_days: int               # 0 if not overdue
    ease_factor: float              # SM-2 ease_factor (default 2.5)


@dataclass
class ErrorInfo:
    question_id: UUID
    subject_id: UUID
    topic_id: Optional[UUID]
    times_wrong: int                # total error occurrences (times_repeated in DB)


@dataclass
class HistoryEntry:
    date: datetime
    completed: bool
    score: Optional[float]          # accuracy or exam score
    duration_minutes: int


@dataclass
class ROIContext:
    """
    Everything the ROI Engine needs to score opportunities.
    All fields are plain data — no domain objects from other engines.
    """
    user_id: UUID
    target_exam: str                    # "PRF" | "PMGO"
    available_minutes: int
    current_hour: int                   # 0-23
    gaps: list[GapInfo]
    mastery: list[MasteryInfo]
    pending_reviews: list[ReviewInfo]
    recent_errors: list[ErrorInfo]
    history: list[HistoryEntry]
    streak_days: int
    approval_estimate: float            # 0-100, current
    days_until_exam: Optional[int]
    confidence_level: float = 0.5       # 0-1; 0.5 = neutral / unknown

    # ── Derived (computed once, used by strategies) ───────────────────

    @property
    def max_exam_weight(self) -> float:
        if not self.mastery:
            return 1.0
        return max(m.exam_weight for m in self.mastery) or 1.0

    @property
    def overdue_reviews(self) -> list[ReviewInfo]:
        return [r for r in self.pending_reviews if r.overdue_days > 0]

    @property
    def exam_approaching(self) -> bool:
        return self.days_until_exam is not None and self.days_until_exam <= 30

    @property
    def exam_pressure(self) -> float:
        """0-1; rises as exam approaches. 0 when no exam date set."""
        if self.days_until_exam is None or self.days_until_exam <= 0:
            return 0.0
        return max(0.0, 1.0 - self.days_until_exam / 180.0)

    @property
    def is_commute_hour(self) -> bool:
        return self.current_hour in range(6, 10) or self.current_hour in range(17, 20)

    @property
    def avg_mastery(self) -> float:
        if not self.mastery:
            return 0.0
        weights = [m.exam_weight for m in self.mastery]
        total_w = sum(weights) or 1.0
        return sum(m.mastery_score * m.exam_weight for m in self.mastery) / total_w
