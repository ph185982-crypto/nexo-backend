from __future__ import annotations

from ..interfaces.enums import StepType, DecisionReason
from ..models.context import MissionContext
from .base import BaseStrategy, StepRecommendation

_BASE_SCORE = 500.0
_MAX_AVAILABLE_MINUTES = 15   # only active when very short on time
_STEP_MINUTES = 5


class ShortTimeStrategy(BaseStrategy):
    """When almost no time is available, recommend a quick law-text review."""

    def is_applicable(self, context: MissionContext) -> bool:
        return context.input.available_minutes <= _MAX_AVAILABLE_MINUTES

    def recommend(self, context: MissionContext) -> list[StepRecommendation]:
        # Pick highest-weight subject with decent attempts
        candidates = sorted(
            [s for s in context.input.mastery_snapshots if s.total_attempts > 0],
            key=lambda s: s.weight,
            reverse=True,
        )
        if not candidates:
            return []

        subj = candidates[0]
        return [
            StepRecommendation(
                step_type=StepType.LAW,
                reason=DecisionReason.OPTIMAL_ENERGY,
                priority_score=_BASE_SCORE,
                estimated_minutes=_STEP_MINUTES,
                subject_id=subj.subject_id,
                topic_id=None,
                justification="Short session — quick legal text review",
                payload={"subject_slug": subj.subject_slug},
            )
        ]
