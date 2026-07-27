"""
Study Priority Engine — decides what the user should study next.

Combines multiple signals into a single priority score per subject/topic:
  1. Pending reviews (overdue cards)
  2. Error frequency (subjects with most errors)
  3. PRF exam weight (official weight of subject in the exam)
  4. Proximity to exam (urgency multiplier)
  5. User energy level (match content difficulty to energy)
  6. Time of day / study mode (format suitability)
  7. Recency (avoid studying the same subject repeatedly)
  8. Time available (fit content to the time block)
  9. Error recurrence (patterns of repeated mistakes)
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional
from uuid import UUID

from prf.models.user import EnergyLevel, StudyMode


@dataclass
class SubjectState:
    subject_id: UUID
    subject_name: str
    weight_prf: float = 1.0
    mastery: float = 0.0           # 0.0 to 1.0
    accuracy: float = 0.0
    total_attempts: int = 0
    error_count: int = 0
    reviews_due: int = 0
    last_studied: Optional[datetime] = None
    study_time_mins: float = 0
    recurring_errors: int = 0


@dataclass
class PriorityResult:
    subject_id: UUID
    subject_name: str
    score: float
    reason: str
    recommended_format: str        # 'questions', 'legal_reading', 'flashcards', 'audio'
    recommended_mins: int


@dataclass
class PriorityContext:
    energy: EnergyLevel = EnergyLevel.MEDIUM
    mode: StudyMode = StudyMode.FOCUS
    available_minutes: int = 30
    hour_of_day: int = 12
    days_until_exam: Optional[int] = None
    today: date = field(default_factory=date.today)


def compute_priorities(
    subjects: list[SubjectState],
    context: PriorityContext,
) -> list[PriorityResult]:
    """
    Rank subjects by study priority, highest first.
    Returns a scored, sorted list of PriorityResult.
    """
    results = []
    for s in subjects:
        score = _compute_subject_score(s, context)
        fmt = _recommend_format(s, context)
        mins = _recommend_duration(s, context)
        reason = _explain_priority(s, context, score)

        results.append(PriorityResult(
            subject_id=s.subject_id,
            subject_name=s.subject_name,
            score=round(score, 2),
            reason=reason,
            recommended_format=fmt,
            recommended_mins=mins,
        ))

    results.sort(key=lambda r: r.score, reverse=True)
    return results


def _compute_subject_score(s: SubjectState, ctx: PriorityContext) -> float:
    score = 0.0

    # 1. Pending reviews — highest priority signal
    if s.reviews_due > 0:
        score += min(s.reviews_due * 8, 40)

    # 2. Error frequency — subjects with more errors need more attention
    if s.total_attempts > 0:
        error_rate = 1.0 - s.accuracy
        score += error_rate * 25

    # 3. PRF exam weight — heavier subjects deserve more time
    score += s.weight_prf * 10

    # 4. Recurring errors — pattern of the same mistakes is critical
    score += min(s.recurring_errors * 5, 20)

    # 5. Low mastery boost — subjects barely studied get a push
    if s.mastery < 0.3:
        score += (0.3 - s.mastery) * 20
    elif s.mastery > 0.8:
        score -= 5  # reduce priority for well-mastered subjects

    # 6. Recency penalty — avoid re-studying what was just studied
    if s.last_studied:
        hours_since = (datetime.utcnow() - s.last_studied).total_seconds() / 3600
        if hours_since < 4:
            score -= 15
        elif hours_since < 24:
            score -= 5

    # 7. Exam urgency multiplier
    if ctx.days_until_exam is not None and ctx.days_until_exam < 60:
        urgency = max(0.5, 1 + (60 - ctx.days_until_exam) / 60)
        if s.weight_prf >= 2.0:
            score *= urgency

    # 8. Energy-adjusted difficulty matching
    energy_mult = _energy_multiplier(ctx.energy, s.mastery)
    score *= energy_mult

    return score


def _energy_multiplier(energy: EnergyLevel, mastery: float) -> float:
    """
    When energy is low, favor easier/mastered content (review).
    When energy is high, favor challenging content (new/weak areas).
    """
    if energy in (EnergyLevel.VERY_LOW, EnergyLevel.LOW):
        return 1.2 if mastery > 0.5 else 0.7
    if energy in (EnergyLevel.HIGH, EnergyLevel.VERY_HIGH):
        return 1.2 if mastery < 0.5 else 0.9
    return 1.0


def _recommend_format(s: SubjectState, ctx: PriorityContext) -> str:
    if ctx.mode == StudyMode.COMMUTE:
        return "audio"
    if ctx.mode == StudyMode.MICRO:
        return "flashcards"
    if ctx.mode == StudyMode.TIRED:
        return "flashcards" if s.reviews_due > 0 else "legal_reading"
    if s.reviews_due > 0:
        return "flashcards"
    if s.accuracy < 0.5 and s.total_attempts > 5:
        return "legal_reading"
    return "questions"


def _recommend_duration(s: SubjectState, ctx: PriorityContext) -> int:
    base = min(ctx.available_minutes, 30)
    if ctx.mode == StudyMode.MICRO:
        return min(10, ctx.available_minutes)
    if ctx.mode == StudyMode.TIRED:
        return min(15, ctx.available_minutes)
    if ctx.mode == StudyMode.COMMUTE:
        return min(ctx.available_minutes, 45)
    return base


def _explain_priority(s: SubjectState, ctx: PriorityContext, score: float) -> str:
    parts = []
    if s.reviews_due > 0:
        parts.append(f"{s.reviews_due} revisões pendentes")
    if s.accuracy < 0.5 and s.total_attempts > 3:
        parts.append(f"acurácia baixa ({s.accuracy:.0%})")
    if s.weight_prf >= 2.0:
        parts.append("alto peso no edital")
    if s.recurring_errors > 2:
        parts.append(f"{s.recurring_errors} erros recorrentes")
    if s.mastery < 0.3:
        parts.append("nível de domínio baixo")
    if not parts:
        parts.append("manutenção regular")
    return "; ".join(parts)
