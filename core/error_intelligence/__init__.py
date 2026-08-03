"""
Error Intelligence Engine — learning diagnosis for the PRF adaptive study platform.

Every wrong answer becomes an opportunity to improve approval probability.
This engine classifies WHY the user failed and prescribes what to do next.

Public API::

    from core.error_intelligence import ErrorIntelligenceEngine
    from core.error_intelligence import (
        ErrorContext, QuestionSnapshot, PreviousAttemptSnapshot,
        ErrorEntrySnapshot, ReviewCardSnapshot, MasterySnapshot,
        SessionSnapshot, LearningContextSnapshot, ApprovalContextSnapshot,
        ErrorAnalysis, TreatmentAction, PatternMatch, EvolutionStatus,
        RelatedKnowledge, ErrorRepositoryPort,
    )
    from core.error_intelligence import (
        ErrorClassification, ErrorSeverity, TreatmentActionType,
        PatternType, EvolutionDirection,
    )

Usage::

    engine = ErrorIntelligenceEngine()
    analysis = engine.analyze(context)
    report   = engine.generateReport(analysis)

    # Pattern detection on aggregate history
    patterns = engine.findPatterns(recent_errors, recent_attempts)

The engine is stateless — instantiate once, call methods as many times as needed.
Callers own all data fetching.
"""
from .engine import ErrorIntelligenceEngine

from .interfaces.context import (
    QuestionSnapshot,
    PreviousAttemptSnapshot,
    ErrorEntrySnapshot,
    ReviewCardSnapshot,
    MasterySnapshot,
    SessionSnapshot,
    LearningContextSnapshot,
    ApprovalContextSnapshot,
    ErrorContext,
)
from .interfaces.analysis import (
    TreatmentAction,
    PatternMatch,
    EvolutionStatus,
    RelatedKnowledge,
    ErrorAnalysis,
)
from .interfaces.port import ErrorRepositoryPort
from .models.enums import (
    ErrorClassification,
    ErrorSeverity,
    TreatmentActionType,
    PatternType,
    EvolutionDirection,
)

__all__ = [
    "ErrorIntelligenceEngine",
    # Context (input)
    "QuestionSnapshot",
    "PreviousAttemptSnapshot",
    "ErrorEntrySnapshot",
    "ReviewCardSnapshot",
    "MasterySnapshot",
    "SessionSnapshot",
    "LearningContextSnapshot",
    "ApprovalContextSnapshot",
    "ErrorContext",
    # Analysis (output)
    "TreatmentAction",
    "PatternMatch",
    "EvolutionStatus",
    "RelatedKnowledge",
    "ErrorAnalysis",
    # Port
    "ErrorRepositoryPort",
    # Enums
    "ErrorClassification",
    "ErrorSeverity",
    "TreatmentActionType",
    "PatternType",
    "EvolutionDirection",
]
