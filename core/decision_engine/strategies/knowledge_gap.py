from __future__ import annotations

from ..interfaces.enums import DecisionReason, StepType
from ..models.context import MissionContext
from .base import BaseStrategy, StepRecommendation

_STEP_TYPE_MAP = {
    "questions": StepType.QUESTIONS,
    "review": StepType.REVIEW,
    "flashcards": StepType.FLASHCARDS,
    "law": StepType.LAW,
}
_BASE_SCORE = 800.0
_IMPACT_MULTIPLIER = 200.0
_STEP_MINUTES = 15


class KnowledgeGapStrategy(BaseStrategy):
    """
    Translates KnowledgeGraphEngine gap analysis into mission steps.
    This is the bridge between the KGE and the Decision Engine — the DE
    sees only typed KnowledgeGapSummary objects, never graph internals.
    """

    def is_applicable(self, context: MissionContext) -> bool:
        return bool(context.input.knowledge_gaps)

    def recommend(self, context: MissionContext) -> list[StepRecommendation]:
        recs = []
        for gap in context.input.knowledge_gaps:
            step_type = _STEP_TYPE_MAP.get(gap.recommended_step, StepType.QUESTIONS)
            score = _BASE_SCORE + gap.impact_score * _IMPACT_MULTIPLIER
            recs.append(
                StepRecommendation(
                    step_type=step_type,
                    reason=DecisionReason.HIGH_PRIORITY_TOPIC,
                    priority_score=score,
                    estimated_minutes=_STEP_MINUTES,
                    subject_id=gap.subject_id,
                    topic_id=gap.topic_id,
                    justification=f"[KGE] {gap.label}: {gap.explanation}",
                    payload={
                        "node_id": gap.node_id,
                        "node_type": gap.node_type,
                        "gap_score": gap.gap_score,
                        "impact_score": gap.impact_score,
                    },
                )
            )
        recs.sort(key=lambda r: r.priority_score, reverse=True)
        return recs
