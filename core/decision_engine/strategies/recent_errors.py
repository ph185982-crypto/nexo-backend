from __future__ import annotations
from collections import Counter

from ..interfaces.enums import StepType, DecisionReason
from ..models.context import MissionContext
from .base import BaseStrategy, StepRecommendation

_BASE_SCORE = 900.0
_PER_ERROR = 20.0
_STEP_MINUTES = 10


class RecentErrorsStrategy(BaseStrategy):
    def is_applicable(self, context: MissionContext) -> bool:
        return bool(context.input.recent_errors)

    def recommend(self, context: MissionContext) -> list[StepRecommendation]:
        error_count: Counter = Counter(
            e.subject_id for e in context.input.recent_errors
        )
        recs = []
        for subject_id, count in error_count.most_common():
            score = _BASE_SCORE + count * _PER_ERROR
            question_ids = [
                str(e.question_id)
                for e in context.input.recent_errors
                if e.subject_id == subject_id
            ]
            recs.append(
                StepRecommendation(
                    step_type=StepType.QUESTIONS,
                    reason=DecisionReason.RECENT_ERRORS,
                    priority_score=score,
                    estimated_minutes=_STEP_MINUTES,
                    subject_id=subject_id,
                    topic_id=None,
                    justification=f"{count} recent error(s) in subject",
                    payload={"question_ids": question_ids, "mode": "retry"},
                )
            )
        return recs
