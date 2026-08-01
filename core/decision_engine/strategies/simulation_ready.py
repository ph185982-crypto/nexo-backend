from __future__ import annotations

from ..interfaces.enums import StepType, DecisionReason
from ..models.context import MissionContext
from .base import BaseStrategy, StepRecommendation

_BASE_SCORE = 300.0
# Suggest simulation when overall mastery is solid and exam is approaching
_MIN_MASTERY_TO_SIMULATE = 60.0
_SIMULATION_MINUTES = 30


class SimulationReadyStrategy(BaseStrategy):
    def is_applicable(self, context: MissionContext) -> bool:
        if not context.exam_approaching:
            return False
        snapshots = context.input.mastery_snapshots
        if not snapshots:
            return False
        avg_mastery = sum(s.mastery_score for s in snapshots) / len(snapshots)
        return avg_mastery >= _MIN_MASTERY_TO_SIMULATE

    def recommend(self, context: MissionContext) -> list[StepRecommendation]:
        pressure_bonus = context.exam_pressure * 200
        score = _BASE_SCORE + pressure_bonus
        days = context.input.days_until_exam
        return [
            StepRecommendation(
                step_type=StepType.SIMULATION,
                reason=DecisionReason.EXAM_APPROACHING,
                priority_score=score,
                estimated_minutes=_SIMULATION_MINUTES,
                subject_id=None,
                topic_id=None,
                justification=f"Exam in {days} day(s) — timed simulation practice",
                payload={"exam_type": context.input.target_exam},
            )
        ]
