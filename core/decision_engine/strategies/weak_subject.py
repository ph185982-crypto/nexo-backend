from __future__ import annotations

from ..interfaces.enums import StepType, DecisionReason
from ..models.context import MissionContext
from .base import BaseStrategy, StepRecommendation

_CRITICAL_BASE = 900.0
_WEAK_BASE = 700.0
_WEIGHT_MULTIPLIER = 50.0
_STEP_MINUTES = 15


class WeakSubjectStrategy(BaseStrategy):
    def is_applicable(self, context: MissionContext) -> bool:
        return bool(context.critical_subjects or context.weak_subjects)

    def recommend(self, context: MissionContext) -> list[StepRecommendation]:
        recs = []

        for subj in context.critical_subjects:
            score = _CRITICAL_BASE + subj.weight * _WEIGHT_MULTIPLIER - subj.mastery_score
            recs.append(
                StepRecommendation(
                    step_type=StepType.QUESTIONS,
                    reason=DecisionReason.WEAK_SUBJECT,
                    priority_score=score,
                    estimated_minutes=_STEP_MINUTES,
                    subject_id=subj.subject_id,
                    topic_id=None,
                    justification=(
                        f"Critical mastery {subj.mastery_score:.0f}/100 "
                        f"on {subj.subject_name} (weight {subj.weight})"
                    ),
                )
            )

        for subj in context.weak_subjects:
            score = _WEAK_BASE + subj.weight * _WEIGHT_MULTIPLIER - subj.mastery_score
            recs.append(
                StepRecommendation(
                    step_type=StepType.QUESTIONS,
                    reason=DecisionReason.WEAK_SUBJECT,
                    priority_score=score,
                    estimated_minutes=_STEP_MINUTES,
                    subject_id=subj.subject_id,
                    topic_id=None,
                    justification=(
                        f"Weak mastery {subj.mastery_score:.0f}/100 "
                        f"on {subj.subject_name} (weight {subj.weight})"
                    ),
                )
            )

        recs.sort(key=lambda r: r.priority_score, reverse=True)
        return recs
