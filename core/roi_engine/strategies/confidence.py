from __future__ import annotations

from ..interfaces.context import ROIContext
from ..interfaces.opportunity import OpportunityType, StudyOpportunity
from ..interfaces.strategy import ScoringStrategy

# When confidence is LOW → reinforcement types are more valuable
_REINFORCEMENT_TYPES = {
    OpportunityType.FLASHCARDS,
    OpportunityType.REVIEW_QUESTIONS,
    OpportunityType.WEAK_TOPIC_REVIEW,
    OpportunityType.LAW_READING,
    OpportunityType.STUDY_ARTICLE,
}

# When confidence is HIGH → challenge types are more valuable
_CHALLENGE_TYPES = {
    OpportunityType.SOLVE_QUESTIONS,
    OpportunityType.SIMULATION,
}

# Neutral types score at 0.5 regardless of confidence
_NEUTRAL_TYPES = {
    OpportunityType.AUDIO_REVIEW,
}


class ConfidenceScoringStrategy(ScoringStrategy):
    """
    Dimension: Does this opportunity's format match the learner's current confidence?

    Low confidence → reinforcement (flashcards, review) builds safety.
    High confidence → challenge (new questions, simulation) drives growth.
    Moderate confidence → all types equally valuable.

    Weight: 0.10
    """

    @property
    def name(self) -> str:
        return "confidence"

    @property
    def weight(self) -> float:
        return 0.10

    def score(self, opportunity: StudyOpportunity, context: ROIContext) -> float:
        c = context.confidence_level   # 0-1
        op_type = opportunity.opportunity_type

        if op_type in _NEUTRAL_TYPES:
            return 0.5

        if op_type in _REINFORCEMENT_TYPES:
            # Score rises as confidence drops (reinforcement needed more when uncertain)
            return 1.0 - c

        if op_type in _CHALLENGE_TYPES:
            # Score rises as confidence grows (ready for harder material)
            return c

        return 0.5  # fallback for any future type
