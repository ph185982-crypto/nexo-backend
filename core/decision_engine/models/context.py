from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
from uuid import UUID

from ..interfaces.inputs import (
    DecisionInput, SubjectMasterySnapshot, ReviewQueueItem, RecentError,
)


@dataclass
class MissionContext:
    """Enriched view of DecisionInput used by all strategies."""
    input: DecisionInput

    # Derived / pre-computed for cheap strategy access
    overdue_cards: list[ReviewQueueItem] = field(default_factory=list)
    critical_subjects: list[SubjectMasterySnapshot] = field(default_factory=list)
    weak_subjects: list[SubjectMasterySnapshot] = field(default_factory=list)
    low_coverage_subjects: list[SubjectMasterySnapshot] = field(default_factory=list)
    error_subject_ids: set[UUID] = field(default_factory=set)
    exam_pressure: float = 0.0        # 0-1, higher when exam is soon
    time_budget_remaining: int = 0    # minutes available after mandatory steps

    @property
    def is_time_constrained(self) -> bool:
        return self.input.available_minutes < 20

    @property
    def exam_approaching(self) -> bool:
        return (
            self.input.days_until_exam is not None
            and self.input.days_until_exam <= 30
        )


class ContextBuilder:
    CRITICAL_MASTERY_THRESHOLD = 40.0
    WEAK_MASTERY_THRESHOLD = 60.0
    LOW_COVERAGE_THRESHOLD = 0.3      # < 30% topics attempted
    OVERDUE_DAYS_THRESHOLD = 0        # any overdue card counts

    def build(self, inp: DecisionInput) -> MissionContext:
        ctx = MissionContext(input=inp)

        ctx.overdue_cards = [c for c in inp.review_queue if c.overdue_days > self.OVERDUE_DAYS_THRESHOLD]

        ctx.critical_subjects = [
            s for s in inp.mastery_snapshots
            if s.mastery_score < self.CRITICAL_MASTERY_THRESHOLD and s.weight > 0
        ]
        ctx.weak_subjects = [
            s for s in inp.mastery_snapshots
            if self.CRITICAL_MASTERY_THRESHOLD <= s.mastery_score < self.WEAK_MASTERY_THRESHOLD and s.weight > 0
        ]
        ctx.low_coverage_subjects = [
            s for s in inp.mastery_snapshots
            if s.coverage_ratio < self.LOW_COVERAGE_THRESHOLD and s.weight > 0
        ]

        ctx.error_subject_ids = {e.subject_id for e in inp.recent_errors}

        if inp.days_until_exam is not None and inp.days_until_exam > 0:
            ctx.exam_pressure = max(0.0, 1.0 - inp.days_until_exam / 180)
        else:
            ctx.exam_pressure = 0.0

        ctx.time_budget_remaining = inp.available_minutes

        return ctx
