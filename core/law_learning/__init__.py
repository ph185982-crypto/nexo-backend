"""
Law Learning Engine — transforms legal articles into intelligent study objects.

Every legal article becomes an ArticleLearningObject containing:
  - Plain-language explanation (pluggable provider — no AI required yet)
  - Difficulty estimate (5 levels)
  - Exam importance estimate (4 levels)
  - Related articles, questions, and topics (from KGE)
  - Personal mastery, mistake count, review count
  - Study status (NOT_STARTED → IN_PROGRESS → NEEDS_REVIEW → MASTERED)
  - Recommended next action with priority and estimated time
  - Estimated approval probability gain from mastering this article

Public API::

    from core.law_learning import LawLearningEngine
    from core.law_learning import (
        ArticleContext, ArticleSnapshot, PersonalProgressSnapshot,
        RelatedContentSnapshot, LearningContextSnapshot,
        ApprovalContextSnapshot, ArticleLearningObject,
    )
    from core.law_learning import (
        DifficultyLevel, ImportanceLevel, StudyStatus, NextActionType,
    )
    from core.law_learning import ExplanationProvider, StaticExplanationProvider

Usage::

    engine = LawLearningEngine()                      # uses StaticExplanationProvider
    # engine = LawLearningEngine(provider=MyAIProvider())  # swap when ready

    context = ArticleContext(
        user_id=user_id,
        article=ArticleSnapshot(...),
        progress=PersonalProgressSnapshot(...),
        related_content=RelatedContentSnapshot(...),  # pre-populated from KGE
        learning=LearningContextSnapshot(...),
        approval=ApprovalContextSnapshot(...),
    )

    obj = engine.analyze(context)
    print(obj.recommended_next_action.action)
    print(obj.estimated_learning_gain)

The engine is stateless — instantiate once, call analyze() as many times as needed.
Callers own all data fetching. See LawLearningRepositoryPort for the data contract.
"""
from .engine import LawLearningEngine

from .interfaces.context import (
    ArticleSnapshot,
    PersonalProgressSnapshot,
    RelatedContentSnapshot,
    LearningContextSnapshot,
    ApprovalContextSnapshot,
    ArticleContext,
)
from .interfaces.output import (
    ArticleExplanation,
    ArticleDifficulty,
    ArticleImportance,
    RelatedArticleRef,
    StudyRecommendation,
    ArticleLearningObject,
)
from .interfaces.port import LawLearningRepositoryPort

from .models.enums import DifficultyLevel, ImportanceLevel, StudyStatus, NextActionType

from .providers.base import ExplanationProvider
from .providers.static import StaticExplanationProvider

__all__ = [
    "LawLearningEngine",
    # Context (input)
    "ArticleSnapshot",
    "PersonalProgressSnapshot",
    "RelatedContentSnapshot",
    "LearningContextSnapshot",
    "ApprovalContextSnapshot",
    "ArticleContext",
    # Output
    "ArticleExplanation",
    "ArticleDifficulty",
    "ArticleImportance",
    "RelatedArticleRef",
    "StudyRecommendation",
    "ArticleLearningObject",
    # Port (guides infrastructure — not consumed by engine)
    "LawLearningRepositoryPort",
    # Enums
    "DifficultyLevel",
    "ImportanceLevel",
    "StudyStatus",
    "NextActionType",
    # Providers
    "ExplanationProvider",
    "StaticExplanationProvider",
]
