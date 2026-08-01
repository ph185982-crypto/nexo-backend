from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from ..interfaces.enums import StepType, DecisionReason
from ..models.context import MissionContext


@dataclass
class StepRecommendation:
    step_type: StepType
    reason: DecisionReason
    priority_score: float             # higher = more important
    estimated_minutes: int
    subject_id: Optional[UUID]
    topic_id: Optional[UUID]
    justification: str
    payload: dict = None

    def __post_init__(self):
        if self.payload is None:
            self.payload = {}


class BaseStrategy(ABC):
    """Each strategy answers one question: what should the user study and why?"""

    @abstractmethod
    def is_applicable(self, context: MissionContext) -> bool:
        """Return True if this strategy has anything to recommend."""

    @abstractmethod
    def recommend(self, context: MissionContext) -> list[StepRecommendation]:
        """Return ordered recommendations (highest priority_score first)."""
