from __future__ import annotations

from ..interfaces.context import ROIContext
from ..interfaces.opportunity import StudyOpportunity
from ..interfaces.strategy import ScoringStrategy


class KnowledgeGapScoringStrategy(ScoringStrategy):
    """
    Dimension: How large is the knowledge gap this opportunity addresses?

    Looks at the impact_score of KGE gaps that correspond to this opportunity's
    subject/topic. The highest matching gap score drives the result.

    Weight: 0.25 — biggest single driver; gap severity is the core signal.
    """

    @property
    def name(self) -> str:
        return "knowledge_gap"

    @property
    def weight(self) -> float:
        return 0.25

    def score(self, opportunity: StudyOpportunity, context: ROIContext) -> float:
        if not context.gaps:
            return 0.0

        best = 0.0
        for gap in context.gaps:
            if _matches(gap.subject_id, gap.topic_id, opportunity):
                best = max(best, gap.impact_score)

        # Also honour the opportunity's own expected_gain as a floor signal
        floor = opportunity.expected_gain * 0.4
        return max(best, floor)


def _matches(gap_subject, gap_topic, op: StudyOpportunity) -> bool:
    """True if the gap's subject/topic overlaps with the opportunity."""
    if gap_topic and op.topic_id and gap_topic == op.topic_id:
        return True
    if gap_subject and op.subject_id and gap_subject == op.subject_id:
        return True
    return False
