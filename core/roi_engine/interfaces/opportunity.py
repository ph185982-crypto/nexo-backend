from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional
from uuid import UUID


class OpportunityType(str, Enum):
    STUDY_ARTICLE = "study_article"
    SOLVE_QUESTIONS = "solve_questions"
    REVIEW_QUESTIONS = "review_questions"
    FLASHCARDS = "flashcards"
    AUDIO_REVIEW = "audio_review"
    SIMULATION = "simulation"
    WEAK_TOPIC_REVIEW = "weak_topic_review"
    LAW_READING = "law_reading"


@dataclass
class StudyOpportunity:
    """
    A single actionable study opportunity.
    The ROI Engine scores and ranks these; it does not create or execute them.
    """
    id: str
    opportunity_type: OpportunityType
    estimated_minutes: int
    knowledge_node_ids: list[str]           # KGE node_ids ("subject:uuid", "topic:uuid")
    subject_id: Optional[UUID]
    topic_id: Optional[UUID]
    label: str
    expected_gain: float                    # estimated approval_estimate delta (0-1)
    metadata: dict[str, Any] = field(default_factory=dict)

    def fits_in(self, available_minutes: int) -> bool:
        return self.estimated_minutes <= available_minutes
