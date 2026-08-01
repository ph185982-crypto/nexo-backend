from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Optional
from uuid import UUID

from .enums import StepType, DecisionReason, MissionPriority


@dataclass
class MissionStep:
    step_id: str
    step_type: StepType
    estimated_minutes: int
    reason: DecisionReason
    subject_id: Optional[UUID]
    topic_id: Optional[UUID]
    priority_score: float
    justification: str
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class MissionPlan:
    steps: list[MissionStep]
    priority: MissionPriority
    estimated_duration_minutes: int
    expected_approval_gain: float     # delta in approval_estimate
    decision_trace: list[str]         # human-readable reasoning log
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def total_minutes(self) -> int:
        return sum(s.estimated_minutes for s in self.steps)
