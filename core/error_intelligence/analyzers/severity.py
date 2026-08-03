"""
SeverityAnalyzer — scores how much this error hurts approval probability.

Six factors, all 0-1, weighted and summed to a final severity score
that maps to LOW / MEDIUM / HIGH / CRITICAL.
"""
from __future__ import annotations

from ..interfaces.context import ErrorContext
from ..models.enums import ErrorClassification, ErrorSeverity

# Severity score thresholds
_CRITICAL = 0.72
_HIGH     = 0.50
_MEDIUM   = 0.28

# Maximum exam weight assumed for normalization (PRF heaviest subject ~3.0)
_MAX_EXAM_WEIGHT = 3.0

# Classifications that inherently carry extra urgency
_HIGH_URGENCY_CLASSIFICATIONS = {
    ErrorClassification.UNKNOWN_CONTENT,
    ErrorClassification.MEMORY_FAILURE,
    ErrorClassification.EXCEPTION_CONFUSION,
    ErrorClassification.LAW_CONFUSION,
}


def score(
    context: ErrorContext,
    classification: ErrorClassification,
) -> ErrorSeverity:
    raw = _compute_score(context, classification)
    if raw >= _CRITICAL:
        return ErrorSeverity.CRITICAL
    if raw >= _HIGH:
        return ErrorSeverity.HIGH
    if raw >= _MEDIUM:
        return ErrorSeverity.MEDIUM
    return ErrorSeverity.LOW


def score_numeric(
    context: ErrorContext,
    classification: ErrorClassification,
) -> float:
    """Returns the raw 0-1 severity score (for estimated_gain computation)."""
    return _compute_score(context, classification)


def _compute_score(ctx: ErrorContext, classification: ErrorClassification) -> float:
    exam_weight_f    = _exam_weight_factor(ctx)
    concept_imp_f    = _concept_importance_factor(ctx)
    recurrence_f     = _recurrence_factor(ctx)
    difficulty_f     = _difficulty_factor(ctx)
    history_f        = _history_factor(ctx)
    retention_f      = _retention_factor(ctx)
    urgency_bonus    = 0.10 if classification in _HIGH_URGENCY_CLASSIFICATIONS else 0.0

    raw = (
        exam_weight_f  * 0.25
        + concept_imp_f  * 0.20
        + recurrence_f   * 0.25
        + difficulty_f   * 0.10
        + history_f      * 0.10
        + retention_f    * 0.10
        + urgency_bonus
    )
    return min(raw, 1.0)


def _exam_weight_factor(ctx: ErrorContext) -> float:
    if ctx.approval and ctx.approval.subject_weight:
        return min(ctx.approval.subject_weight / _MAX_EXAM_WEIGHT, 1.0)
    return 0.5  # neutral default


def _concept_importance_factor(ctx: ErrorContext) -> float:
    """
    Use KGE node metrics if available via origin_result.
    Falls back to question global difficulty.
    """
    if ctx.origin_result and ctx.origin_result.question_node:
        m = ctx.origin_result.question_node.metrics
        if m:
            return min(m.impact_score, 1.0)
    # Fallback: harder questions → higher importance
    return _difficulty_factor(ctx)


def _recurrence_factor(ctx: ErrorContext) -> float:
    if ctx.error_entry is None:
        return 0.0  # first-time error
    # 1 repeat = low; 5+ repeats = maxed out
    return min(ctx.error_entry.times_repeated / 5.0, 1.0)


def _difficulty_factor(ctx: ErrorContext) -> float:
    mapping = {"easy": 0.25, "medium": 0.55, "hard": 0.90}
    return mapping.get(ctx.question.difficulty, 0.55)


def _history_factor(ctx: ErrorContext) -> float:
    """Worse historical accuracy → more severe."""
    if ctx.mastery:
        return max(0.0, 1.0 - ctx.mastery.accuracy)
    return 0.60  # conservative default when no history


def _retention_factor(ctx: ErrorContext) -> float:
    """High forgetting velocity → more likely to lose this again."""
    if ctx.learning:
        return min(ctx.learning.forgetting_velocity_subject * 2.0, 1.0)
    return 0.20  # optimistic default
