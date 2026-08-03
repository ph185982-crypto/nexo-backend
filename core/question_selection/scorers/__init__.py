from .base import Scorer
from .knowledge_gap import KnowledgeGapScorer
from .exam_weight import ExamWeightScorer
from .recurrence import RecurrenceScorer
from .retention import RetentionScorer
from .difficulty import DifficultyScorer
from .learning_gain import LearningGainScorer
from .coverage import CoverageScorer
from .objective import ObjectiveScorer
from .recent_exposure import RecentExposureScorer
from .time_cost import TimeCostScorer

__all__ = [
    "Scorer",
    "KnowledgeGapScorer", "ExamWeightScorer", "RecurrenceScorer",
    "RetentionScorer", "DifficultyScorer", "LearningGainScorer",
    "CoverageScorer", "ObjectiveScorer", "RecentExposureScorer",
    "TimeCostScorer",
]


def default_scorers() -> list[tuple]:
    """Return the default (scorer, weight) list used by QuestionSelectionEngine."""
    return [
        (KnowledgeGapScorer(),   KnowledgeGapScorer.weight),    # 0.20
        (ExamWeightScorer(),     ExamWeightScorer.weight),       # 0.15
        (RecurrenceScorer(),     RecurrenceScorer.weight),       # 0.15
        (RetentionScorer(),      RetentionScorer.weight),        # 0.15
        (DifficultyScorer(),     DifficultyScorer.weight),       # 0.10
        (LearningGainScorer(),   LearningGainScorer.weight),     # 0.10
        (ObjectiveScorer(),      ObjectiveScorer.weight),        # 0.08
        (CoverageScorer(),       CoverageScorer.weight),         # 0.04
        (RecentExposureScorer(), RecentExposureScorer.weight),   # 0.02
        (TimeCostScorer(),       TimeCostScorer.weight),         # 0.01
    ]                                                            # Σ = 1.00
