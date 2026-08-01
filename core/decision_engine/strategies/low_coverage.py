from __future__ import annotations

from ..interfaces.enums import StepType, DecisionReason
from ..models.context import MissionContext
from .base import BaseStrategy, StepRecommendation

_BASE_SCORE = 600.0
_WEIGHT_MULTIPLIER = 40.0
_STEP_MINUTES = 15


class LowCoverageStrategy(BaseStrategy):
    def is_applicable(self, context: MissionContext) -> bool:
        return bool(context.low_coverage_subjects)

    def recommend(self, context: MissionContext) -> list[StepRecommendation]:
        recs = []
        for subj in context.low_coverage_subjects:
            # Prefer uncovered high-weight subjects
            score = _BASE_SCORE + subj.weight * _WEIGHT_MULTIPLIER - subj.coverage_ratio * 100
            recs.append(
                StepRecommendation(
                    step_type=StepType.QUESTIONS,
                    reason=DecisionReason.LOW_COVERAGE,
                    priority_score=score,
                    estimated_minutes=_STEP_MINUTES,
                    subject_id=subj.subject_id,
                    topic_id=None,
                    justification=(
                        f"Only {subj.coverage_ratio:.0%} topics covered "
                        f"in {subj.subject_name}"
                    ),
                )
            )
        recs.sort(key=lambda r: r.priority_score, reverse=True)
        return recs
