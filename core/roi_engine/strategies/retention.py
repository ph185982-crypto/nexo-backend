from __future__ import annotations

from ..interfaces.context import ROIContext
from ..interfaces.opportunity import OpportunityType, StudyOpportunity
from ..interfaces.strategy import ScoringStrategy

_RETENTION_TYPES = {
    OpportunityType.REVIEW_QUESTIONS,
    OpportunityType.FLASHCARDS,
    OpportunityType.AUDIO_REVIEW,
}
_RETENTION_THRESHOLD = 0.65     # correct_rate below this signals retention risk
_MAX_OVERDUE = 10               # overdue count at which score saturates


class RetentionScoringStrategy(ScoringStrategy):
    """
    Dimension: How urgent is the retention risk for this opportunity?

    Combines two signals:
    - Overdue SM-2 review cards (forgetting curve urgency)
    - Correct rate below threshold (retention already degraded)

    Weight: 0.20 — forgetting is irreversible short-term; retention types get a boost.
    """

    @property
    def name(self) -> str:
        return "retention"

    @property
    def weight(self) -> float:
        return 0.20

    def score(self, opportunity: StudyOpportunity, context: ROIContext) -> float:
        overdue_score = self._overdue_score(opportunity, context)
        degradation_score = self._degradation_score(opportunity, context)

        base = max(overdue_score, degradation_score)

        # Multiply for review/flashcard types — they directly address retention
        if opportunity.opportunity_type in _RETENTION_TYPES:
            return min(base * 1.3, 1.0)
        return base

    def _overdue_score(self, op: StudyOpportunity, ctx: ROIContext) -> float:
        if op.subject_id is None:
            return 0.0
        overdue = [
            r for r in ctx.overdue_reviews
            if r.subject_id == op.subject_id
            and (op.topic_id is None or r.topic_id == op.topic_id)
        ]
        return min(len(overdue) / _MAX_OVERDUE, 1.0)

    def _degradation_score(self, op: StudyOpportunity, ctx: ROIContext) -> float:
        if op.subject_id is None:
            return 0.0
        mastery = next(
            (m for m in ctx.mastery if m.subject_id == op.subject_id), None
        )
        if mastery is None or mastery.total_attempts < 5:
            return 0.0
        if mastery.correct_rate >= _RETENTION_THRESHOLD:
            return 0.0
        return (_RETENTION_THRESHOLD - mastery.correct_rate) / _RETENTION_THRESHOLD
