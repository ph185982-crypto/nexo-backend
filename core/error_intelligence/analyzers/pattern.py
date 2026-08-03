"""
PatternAnalyzer — detects recurring behavioural patterns across error history.

Operates on aggregate data passed by the caller.
No I/O — pure function of the input lists.
"""
from __future__ import annotations

from ..interfaces.context import ErrorEntrySnapshot, PreviousAttemptSnapshot
from ..interfaces.analysis import PatternMatch
from ..models.enums import PatternType

# Detection thresholds
_FAST_ANSWER_SECS = 10
_MIN_OCCURRENCES  = 3    # minimum matches to declare a pattern


def detect(
    recent_errors: list[ErrorEntrySnapshot],
    recent_attempts: list[PreviousAttemptSnapshot],
) -> list[PatternMatch]:
    """
    Runs all detectors and returns detected patterns with confidence ≥ 0.50.
    """
    detectors = [
        _detect_fast_answerer,
        _detect_exception_misser,
        _detect_overconfident,
        _detect_fatigue_errors,
        _detect_law_confuser,
        _detect_topic_blind_spot,
    ]
    patterns: list[PatternMatch] = []
    for fn in detectors:
        result = fn(recent_errors, recent_attempts)
        if result and result.confidence >= 0.50:
            patterns.append(result)
    return patterns


# ── Individual detectors ──────────────────────────────────────────────────


def _detect_fast_answerer(
    errors: list[ErrorEntrySnapshot],
    attempts: list[PreviousAttemptSnapshot],
) -> PatternMatch | None:
    fast = [a for a in attempts if a.time_spent_secs is not None and a.time_spent_secs < _FAST_ANSWER_SECS]
    if not attempts or len(fast) < _MIN_OCCURRENCES:
        return None
    ratio = len(fast) / len(attempts)
    if ratio < 0.25:
        return None
    return PatternMatch(
        pattern_type=PatternType.FAST_ANSWERER.value,
        description=f"O aluno responde muito rapidamente (<{_FAST_ANSWER_SECS}s) em {ratio:.0%} das tentativas.",
        occurrences=len(fast),
        confidence=min(ratio * 1.5, 0.95),
        examples=[f"{a.time_spent_secs}s em {a.answered_at.strftime('%d/%m')}" for a in fast[:3]],
    )


def _detect_exception_misser(
    errors: list[ErrorEntrySnapshot],
    attempts: list[PreviousAttemptSnapshot],
) -> PatternMatch | None:
    exception_errors = [
        e for e in errors
        if e.error_type in ("conceptual",) and not e.resolved
        and e.times_repeated >= 2
    ]
    if len(exception_errors) < _MIN_OCCURRENCES:
        return None
    ratio = len(exception_errors) / max(len(errors), 1)
    if ratio < 0.20:
        return None
    return PatternMatch(
        pattern_type=PatternType.EXCEPTION_MISSER.value,
        description=f"Padrão de erros em questões de exceção — {len(exception_errors)} registros repetidos.",
        occurrences=len(exception_errors),
        confidence=min(ratio * 2.0, 0.90),
        examples=[f"Repetido {e.times_repeated}× (último: {e.last_error_at.strftime('%d/%m')})" for e in exception_errors[:3]],
    )


def _detect_overconfident(
    errors: list[ErrorEntrySnapshot],
    attempts: list[PreviousAttemptSnapshot],
) -> PatternMatch | None:
    wrong_with_high_conf = [
        a for a in attempts
        if not a.is_correct and a.confidence is not None and a.confidence >= 4
    ]
    wrong_total = [a for a in attempts if not a.is_correct]
    if not wrong_total or len(wrong_with_high_conf) < _MIN_OCCURRENCES:
        return None
    ratio = len(wrong_with_high_conf) / len(wrong_total)
    if ratio < 0.25:
        return None
    return PatternMatch(
        pattern_type=PatternType.OVERCONFIDENT.value,
        description=f"{ratio:.0%} dos erros foram cometidos com alta confiança (4-5/5).",
        occurrences=len(wrong_with_high_conf),
        confidence=min(ratio * 1.8, 0.90),
        examples=[
            f"Confiança {a.confidence}/5 em {a.answered_at.strftime('%d/%m')}"
            for a in wrong_with_high_conf[:3]
        ],
    )


def _detect_fatigue_errors(
    errors: list[ErrorEntrySnapshot],
    attempts: list[PreviousAttemptSnapshot],
) -> PatternMatch | None:
    # Proxy: errors that occurred at high-numbered positions (> 25 attempts in session).
    # Full detection requires session position data — here we use timestamp clustering.
    # Group attempts by date and check if errors cluster at end of day.
    from itertools import groupby
    from datetime import timedelta

    if len(attempts) < 10:
        return None

    sorted_attempts = sorted(attempts, key=lambda a: a.answered_at)
    error_at_high_pos: list[PreviousAttemptSnapshot] = []

    # Use day-level grouping — errors in last third of a day's session
    for _, day_group in groupby(sorted_attempts, key=lambda a: a.answered_at.date()):
        day_list = list(day_group)
        threshold_idx = int(len(day_list) * 0.66)
        errors_in_day = [a for a in day_list if not a.is_correct]
        errors_late = [a for a in day_list[threshold_idx:] if not a.is_correct]
        if errors_in_day and len(errors_late) / max(len(errors_in_day), 1) >= 0.60:
            error_at_high_pos.extend(errors_late)

    if len(error_at_high_pos) < _MIN_OCCURRENCES:
        return None

    ratio = len(error_at_high_pos) / max(len([a for a in attempts if not a.is_correct]), 1)
    if ratio < 0.35:
        return None

    return PatternMatch(
        pattern_type=PatternType.FATIGUE_ERRORS.value,
        description=f"{ratio:.0%} dos erros ocorrem no terço final das sessões de estudo.",
        occurrences=len(error_at_high_pos),
        confidence=min(ratio * 1.5, 0.85),
        examples=[a.answered_at.strftime("%d/%m %H:%M") for a in error_at_high_pos[:3]],
    )


def _detect_law_confuser(
    errors: list[ErrorEntrySnapshot],
    attempts: list[PreviousAttemptSnapshot],
) -> PatternMatch | None:
    conceptual_repeated = [
        e for e in errors
        if e.error_type == "conceptual" and e.times_repeated >= 2 and not e.resolved
    ]
    if len(conceptual_repeated) < _MIN_OCCURRENCES:
        return None
    ratio = len(conceptual_repeated) / max(len(errors), 1)
    if ratio < 0.20:
        return None
    return PatternMatch(
        pattern_type=PatternType.LAW_CONFUSER.value,
        description=f"{len(conceptual_repeated)} erros conceituais recorrentes — o aluno confunde legislações relacionadas.",
        occurrences=len(conceptual_repeated),
        confidence=min(0.65 + ratio * 0.3, 0.90),
        examples=[f"Repetido {e.times_repeated}×" for e in conceptual_repeated[:3]],
    )


def _detect_topic_blind_spot(
    errors: list[ErrorEntrySnapshot],
    attempts: list[PreviousAttemptSnapshot],
) -> PatternMatch | None:
    high_recurrence = [
        e for e in errors
        if e.times_repeated >= 4 and not e.resolved
    ]
    if len(high_recurrence) < 2:
        return None
    return PatternMatch(
        pattern_type=PatternType.TOPIC_BLIND_SPOT.value,
        description=f"{len(high_recurrence)} questões com 4+ erros repetidos — ponto cego de conhecimento.",
        occurrences=len(high_recurrence),
        confidence=min(0.60 + len(high_recurrence) * 0.05, 0.90),
        examples=[f"Repetido {e.times_repeated}× (último: {e.last_error_at.strftime('%d/%m')})" for e in high_recurrence[:3]],
    )
