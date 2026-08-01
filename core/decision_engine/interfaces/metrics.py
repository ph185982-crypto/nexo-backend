from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from .enums import StepType


@dataclass
class StepMetrics:
    step_id: str
    step_type: StepType
    subject_id: Optional[UUID]
    topic_id: Optional[UUID]
    planned_minutes: int
    actual_minutes: int
    items_completed: int
    items_correct: int

    @property
    def accuracy(self) -> float:
        if self.items_completed == 0:
            return 0.0
        return self.items_correct / self.items_completed


@dataclass
class MissionMetrics:
    total_items: int
    correct_items: int
    total_minutes: int
    steps: list[StepMetrics]

    @property
    def overall_accuracy(self) -> float:
        if self.total_items == 0:
            return 0.0
        return self.correct_items / self.total_items


@dataclass
class MissionResult:
    mission_id: UUID
    metrics: MissionMetrics
    approval_gain: float
    mastery_delta: dict[str, float]   # subject_slug -> delta
    xp_earned: int
    completed: bool
    feedback_summary: str
