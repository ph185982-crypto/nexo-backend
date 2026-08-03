from __future__ import annotations

from ..interfaces.context import ROIContext
from ..interfaces.opportunity import OpportunityType, StudyOpportunity
from ..interfaces.strategy import ScoringStrategy

_MISTAKE_TYPES = {
    OpportunityType.REVIEW_QUESTIONS,
    OpportunityType.FLASHCARDS,
    OpportunityType.SOLVE_QUESTIONS,
    OpportunityType.WEAK_TOPIC_REVIEW,
}
_MAX_ERRORS = 8     # error count at which score saturates


class RecentMistakeScoringStrategy(ScoringStrategy):
    """
    Dimension: How many unresolved errors exist in this opportunity's domain?

    Errors are strong signals: the learner has been tested and failed.
    Addressing them directly has high ROI because the gap is precisely known.

    Only applies to practice and review types — reading law or simulation
    doesn't directly address known errors.

    Weight: 0.15
    """

    @property
    def name(self) -> str:
        return "recent_mistake"

    @property
    def weight(self) -> float:
        return 0.15

    def score(self, opportunity: StudyOpportunity, context: ROIContext) -> float:
        if opportunity.opportunity_type not in _MISTAKE_TYPES:
            return 0.0
        if opportunity.subject_id is None:
            return 0.0

        total_errors = sum(
            e.times_wrong
            for e in context.recent_errors
            if e.subject_id == opportunity.subject_id
            and (opportunity.topic_id is None or e.topic_id == opportunity.topic_id)
        )
        return min(total_errors / _MAX_ERRORS, 1.0)
