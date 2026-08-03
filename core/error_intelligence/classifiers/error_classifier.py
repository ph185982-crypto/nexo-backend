"""
ErrorClassifier — assigns the primary cause to a wrong answer.

Each of the 12 classification types gets a signal score from multiple
independent heuristics. The highest-scoring classification wins.

All functions are pure — no I/O, no side effects.
"""
from __future__ import annotations

from ..interfaces.context import ErrorContext
from ..models.enums import ErrorClassification

# Minimum response-time thresholds (seconds)
_VERY_FAST_SECS = 6
_FAST_SECS = 12
_SLOW_SECS = 45

# Confidence thresholds (1-5 scale)
_HIGH_CONFIDENCE = 4
_LOW_CONFIDENCE = 2


def classify(context: ErrorContext) -> tuple[ErrorClassification, dict[str, float]]:
    """
    Returns:
        (winning_classification, scores_dict)

    scores_dict maps classification names to their 0-1 signal score
    for transparency / debugging.
    """
    scorers = {
        ErrorClassification.UNKNOWN_CONTENT:     _score_unknown_content,
        ErrorClassification.MEMORY_FAILURE:      _score_memory_failure,
        ErrorClassification.CONCEPT_CONFUSION:   _score_concept_confusion,
        ErrorClassification.MISREAD_QUESTION:    _score_misread_question,
        ErrorClassification.DISTRACTION:         _score_distraction,
        ErrorClassification.LAW_CONFUSION:       _score_law_confusion,
        ErrorClassification.INTERPRETATION_ERROR: _score_interpretation_error,
        ErrorClassification.EXCEPTION_CONFUSION: _score_exception_confusion,
        ErrorClassification.OVERCONFIDENCE:      _score_overconfidence,
        ErrorClassification.LOW_CONFIDENCE:      _score_low_confidence,
        ErrorClassification.TIME_PRESSURE:       _score_time_pressure,
        ErrorClassification.GUESS:               _score_guess,
    }

    scores = {cls.value: fn(context) for cls, fn in scorers.items()}
    best = max(scores, key=lambda k: scores[k])
    return ErrorClassification(best), scores


# ── Individual scorers ────────────────────────────────────────────────────


def _score_unknown_content(ctx: ErrorContext) -> float:
    score = 0.0
    if ctx.is_first_attempt:
        score += 0.45
    if ctx.mastery is None or ctx.mastery.mastery_level == 0.0:
        score += 0.30
    if ctx.review_card is None:
        score += 0.15
    if ctx.response_time_secs is not None and ctx.response_time_secs < _VERY_FAST_SECS:
        score += 0.10
    return min(score, 1.0)


def _score_memory_failure(ctx: ErrorContext) -> float:
    score = 0.0
    # Had correct attempts before — was known
    if ctx.prev_correct_count > 0:
        score += 0.30
    if ctx.is_overdue_for_review:
        score += 0.30
    if ctx.review_card and ctx.review_card.lapsed:
        score += 0.20
    if ctx.learning and ctx.learning.forgetting_velocity_subject > 0.30:
        score += 0.10
    if ctx.mastery and ctx.mastery.mastery_level > 0.40:
        score += 0.10
    return min(score, 1.0)


def _score_concept_confusion(ctx: ErrorContext) -> float:
    score = 0.0
    if ctx.learning and ctx.topic_id_str:
        if ctx.topic_id_str in ctx.learning.confused_topics:
            score += 0.45
        # Any confusion pair involves this topic
        for a, b, s in ctx.learning.confusion_pairs:
            if ctx.topic_id_str in (a, b) and s > 0.30:
                score += 0.25
                break
    if ctx.is_recurring_error:
        score += 0.20
    if ctx.question.has_multiple_legal_refs:
        score += 0.10
    return min(score, 1.0)


def _score_misread_question(ctx: ErrorContext) -> float:
    score = 0.0
    if ctx.response_time_secs is not None:
        if ctx.response_time_secs < _VERY_FAST_SECS:
            score += 0.35
        elif ctx.response_time_secs < _FAST_SECS:
            score += 0.20
    # Fast relative to personal average
    if ctx.response_time_secs and ctx.avg_past_time:
        if ctx.response_time_secs < ctx.avg_past_time * 0.5:
            score += 0.30
    # High confidence + wrong → likely misread, not unknown
    if ctx.confidence and ctx.confidence >= _HIGH_CONFIDENCE:
        score += 0.20
    # Question is long (interpretation-style) but user answered fast
    if ctx.question.is_interpretation_type and ctx.response_time_secs and ctx.response_time_secs < _SLOW_SECS:
        score += 0.15
    return min(score, 1.0)


def _score_distraction(ctx: ErrorContext) -> float:
    score = 0.0
    if ctx.session:
        if ctx.learning:
            if ctx.session.duration_so_far_mins > ctx.learning.fatigue_threshold_mins:
                score += 0.35
        if ctx.session.energy_level == "low":
            score += 0.30
        # Accuracy declining across session
        if ctx.session.accuracy_so_far < 0.50 and ctx.session.position_in_session > 10:
            score += 0.20
        # Very fast response in a long session
        if (
            ctx.response_time_secs is not None
            and ctx.response_time_secs < _FAST_SECS
            and ctx.session.duration_so_far_mins > 30
        ):
            score += 0.15
    return min(score, 1.0)


def _score_law_confusion(ctx: ErrorContext) -> float:
    score = 0.0
    if ctx.question.has_multiple_legal_refs:
        score += 0.35
    if ctx.question.content_type == "lei_seca":
        score += 0.25
    # Recurring error on law-type questions
    if ctx.is_recurring_error and ctx.question.content_type == "lei_seca":
        score += 0.25
    # Existing error_type already tagged as conceptual in error_notebook
    if ctx.error_entry and ctx.error_entry.error_type == "conceptual":
        score += 0.15
    return min(score, 1.0)


def _score_interpretation_error(ctx: ErrorContext) -> float:
    score = 0.0
    if ctx.question.is_interpretation_type:
        score += 0.55
    # Slow response — reader struggled to parse
    if ctx.response_time_secs and ctx.response_time_secs > _SLOW_SECS:
        score += 0.25
    if ctx.error_entry and ctx.error_entry.error_type == "interpretation":
        score += 0.20
    return min(score, 1.0)


def _score_exception_confusion(ctx: ErrorContext) -> float:
    score = 0.0
    if ctx.question.is_exception_type:
        score += 0.55
    if ctx.is_recurring_error and ctx.question.is_exception_type:
        score += 0.30
    if ctx.error_entry and ctx.error_entry.error_type == "conceptual" and ctx.question.is_exception_type:
        score += 0.15
    return min(score, 1.0)


def _score_overconfidence(ctx: ErrorContext) -> float:
    score = 0.0
    if ctx.confidence and ctx.confidence >= _HIGH_CONFIDENCE:
        score += 0.50
    if ctx.learning and ctx.learning.confidence_calibration < 0.40:
        score += 0.30
    if ctx.mastery and ctx.mastery.accuracy > 0.60:
        score += 0.20
    return min(score, 1.0)


def _score_low_confidence(ctx: ErrorContext) -> float:
    score = 0.0
    if ctx.confidence is not None and ctx.confidence <= _LOW_CONFIDENCE:
        score += 0.45
    if ctx.response_time_secs and ctx.response_time_secs > _SLOW_SECS:
        score += 0.25
    if ctx.mastery and ctx.mastery.mastery_level < 0.35:
        score += 0.30
    return min(score, 1.0)


def _score_time_pressure(ctx: ErrorContext) -> float:
    score = 0.0
    if ctx.response_time_secs is not None:
        if ctx.response_time_secs < _VERY_FAST_SECS:
            score += 0.50
        elif ctx.response_time_secs < _FAST_SECS:
            score += 0.30
    if ctx.session and ctx.session.position_in_session > 30:
        score += 0.25
    # Significant deviation from personal average
    if ctx.response_time_secs and ctx.avg_past_time:
        if ctx.response_time_secs < ctx.avg_past_time * 0.40:
            score += 0.25
    return min(score, 1.0)


def _score_guess(ctx: ErrorContext) -> float:
    score = 0.0
    if ctx.response_time_secs is not None and ctx.response_time_secs < _VERY_FAST_SECS:
        score += 0.40
    if ctx.confidence is None or (ctx.confidence is not None and ctx.confidence == 1):
        score += 0.30
    if ctx.is_first_attempt:
        score += 0.20
    if ctx.mastery is None or (ctx.mastery and ctx.mastery.mastery_level < 0.15):
        score += 0.10
    return min(score, 1.0)
