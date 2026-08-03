from __future__ import annotations

from ..interfaces.context import ROIContext
from ..interfaces.opportunity import OpportunityType, StudyOpportunity
from ..interfaces.strategy import ScoringStrategy

# Types that don't target a specific subject score on global exam pressure instead
_GLOBAL_TYPES = {OpportunityType.SIMULATION, OpportunityType.AUDIO_REVIEW}


class ExamWeightScoringStrategy(ScoringStrategy):
    """
    Dimension: How much does this subject matter for the exam?

    Score = normalised_weight × mastery_deficit.
    High-weight subject + low mastery = urgent investment.

    Weight: 0.20
    """

    @property
    def name(self) -> str:
        return "exam_weight"

    @property
    def weight(self) -> float:
        return 0.20

    def score(self, opportunity: StudyOpportunity, context: ROIContext) -> float:
        if opportunity.opportunity_type in _GLOBAL_TYPES:
            # Global opportunities score on overall exam pressure
            return context.exam_pressure

        if opportunity.subject_id is None:
            return 0.0

        mastery = next(
            (m for m in context.mastery if m.subject_id == opportunity.subject_id), None
        )
        if mastery is None:
            return 0.0

        normalised_weight = mastery.exam_weight / context.max_exam_weight
        mastery_deficit = 1.0 - mastery.mastery_score / 100.0
        return normalised_weight * mastery_deficit
