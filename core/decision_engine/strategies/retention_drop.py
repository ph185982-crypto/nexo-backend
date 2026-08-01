from __future__ import annotations

from ..interfaces.enums import StepType, DecisionReason
from ..models.context import MissionContext
from .base import BaseStrategy, StepRecommendation

_BASE_SCORE = 700.0
_STEP_MINUTES = 10
# Subjects where correct_rate dropped below this need flashcard reinforcement
_RETENTION_THRESHOLD = 0.65


class RetentionDropStrategy(BaseStrategy):
    def is_applicable(self, context: MissionContext) -> bool:
        return any(
            s.correct_rate < _RETENTION_THRESHOLD and s.total_attempts >= 10
            for s in context.input.mastery_snapshots
        )

    def recommend(self, context: MissionContext) -> list[StepRecommendation]:
        recs = []
        for subj in context.input.mastery_snapshots:
            if subj.correct_rate >= _RETENTION_THRESHOLD or subj.total_attempts < 10:
                continue
            drop = (_RETENTION_THRESHOLD - subj.correct_rate) * 100
            score = _BASE_SCORE + drop * 5 + subj.weight * 30
            recs.append(
                StepRecommendation(
                    step_type=StepType.FLASHCARDS,
                    reason=DecisionReason.LOW_RETENTION,
                    priority_score=score,
                    estimated_minutes=_STEP_MINUTES,
                    subject_id=subj.subject_id,
                    topic_id=None,
                    justification=(
                        f"Retention {subj.correct_rate:.0%} in {subj.subject_name} "
                        f"— flashcard reinforcement needed"
                    ),
                )
            )
        recs.sort(key=lambda r: r.priority_score, reverse=True)
        return recs
