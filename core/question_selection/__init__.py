"""
Question Selection — single authority for choosing the next question.

Public API::

    from core.question_selection import QuestionSelectionEngine
    from core.question_selection import (
        QuestionSnapshot, QuestionSelectionContext, QuestionSelectionResult,
    )
    from core.question_selection import (
        DifficultyLevel, SelectionMode, SelectionReason,
    )

Usage::

    engine = QuestionSelectionEngine()
    result = engine.select(
        QuestionSelectionContext(
            user_id=user_id,
            available_questions=snapshots,   # from DB
            knowledge_gaps=gaps,             # from KGE
            subject_mastery=mastery,         # from Learning Engine
            fatigue_level="FRESH",           # from Study Runtime
            difficulty_target=DifficultyLevel.MEDIUM,
        )
    )
    # result.question_id → fetch content from DB
"""
from .engine import QuestionSelectionEngine

from .models.enums import DifficultyLevel, DIFFICULTY_VALUE, SelectionMode, SelectionReason
from .models.candidate import QuestionCandidate

from .interfaces.context import QuestionSnapshot, QuestionSelectionContext
from .interfaces.output import QuestionSelectionResult
from .interfaces.port import QuestionSelectionPort

from .scorers import (
    Scorer,
    KnowledgeGapScorer, ExamWeightScorer, RecurrenceScorer,
    RetentionScorer, DifficultyScorer, LearningGainScorer,
    CoverageScorer, ObjectiveScorer, RecentExposureScorer, TimeCostScorer,
    default_scorers,
)

from .pipeline import CandidatePoolBuilder, CandidateFilter, CandidateRanker

__all__ = [
    # Engine
    "QuestionSelectionEngine",
    # Enums
    "DifficultyLevel", "DIFFICULTY_VALUE", "SelectionMode", "SelectionReason",
    # Models
    "QuestionCandidate",
    # I/O
    "QuestionSnapshot", "QuestionSelectionContext", "QuestionSelectionResult",
    # Port
    "QuestionSelectionPort",
    # Scorers
    "Scorer",
    "KnowledgeGapScorer", "ExamWeightScorer", "RecurrenceScorer",
    "RetentionScorer", "DifficultyScorer", "LearningGainScorer",
    "CoverageScorer", "ObjectiveScorer", "RecentExposureScorer",
    "TimeCostScorer", "default_scorers",
    # Pipeline
    "CandidatePoolBuilder", "CandidateFilter", "CandidateRanker",
]
