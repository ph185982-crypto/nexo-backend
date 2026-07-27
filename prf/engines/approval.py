"""
Approval Probability Estimator — predicts the user's chance of passing
the PRF exam based on current mastery across all subjects.

The model weights:
  1. Per-subject mastery × PRF exam weight
  2. Trend direction (improving vs declining)
  3. Consistency of study
  4. Retention score
  5. Error patterns
  6. Time remaining until exam

This is a heuristic model, not a statistical prediction.
It serves as a motivational compass, not a guarantee.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date
from typing import Optional


@dataclass
class SubjectMastery:
    subject_name: str
    weight_prf: float       # official exam weight (normalized to 1.0 scale)
    mastery: float          # 0.0 to 1.0
    accuracy: float         # recent accuracy
    total_attempts: int
    error_count: int
    trend: float = 0.0     # positive = improving


@dataclass
class SubjectImpact:
    subject_name: str
    weight: float
    mastery: float
    contribution: float     # mastery × weight (what this subject adds)
    gap: float              # (1 - mastery) × weight (potential gain)
    hours_to_improve: float # estimated hours to move the needle


@dataclass
class ApprovalPrediction:
    probability: float      # 0.0 to 1.0
    trend: str              # 'improving', 'stable', 'declining'
    factors: list[SubjectImpact]
    highest_impact_subject: Optional[str] = None
    study_hours_needed: Optional[float] = None
    days_until_exam: Optional[int] = None


PASSING_THRESHOLD = 0.70   # typical PRF cut-off
HOURS_PER_MASTERY_POINT = 8.0


def estimate_approval(
    subjects: list[SubjectMastery],
    consistency_score: float = 50.0,
    retention_score: float = 50.0,
    exam_date: Optional[date] = None,
    today: Optional[date] = None,
) -> ApprovalPrediction:
    """
    Estimate approval probability based on current subject mastery.
    """
    today = today or date.today()

    if not subjects:
        return ApprovalPrediction(
            probability=0.0,
            trend="stable",
            factors=[],
        )

    total_weight = sum(s.weight_prf for s in subjects)
    if total_weight == 0:
        total_weight = 1.0

    factors: list[SubjectImpact] = []
    weighted_mastery = 0.0
    overall_trend = 0.0

    for s in subjects:
        norm_weight = s.weight_prf / total_weight
        contribution = s.mastery * norm_weight
        gap = (1.0 - s.mastery) * norm_weight
        hours_needed = gap * total_weight * HOURS_PER_MASTERY_POINT

        weighted_mastery += contribution
        overall_trend += s.trend * norm_weight

        factors.append(SubjectImpact(
            subject_name=s.subject_name,
            weight=round(norm_weight, 3),
            mastery=round(s.mastery, 3),
            contribution=round(contribution, 3),
            gap=round(gap, 3),
            hours_to_improve=round(max(0, hours_needed), 1),
        ))

    # Base probability from weighted mastery
    raw_probability = weighted_mastery

    # Consistency bonus/penalty (±10%)
    consistency_factor = (consistency_score - 50) / 500  # -0.1 to +0.1
    raw_probability += consistency_factor

    # Retention bonus/penalty (±8%)
    retention_factor = (retention_score - 50) / 625  # -0.08 to +0.08
    raw_probability += retention_factor

    # Time pressure adjustment
    days_left = None
    if exam_date:
        days_left = (exam_date - today).days
        if days_left > 0:
            if days_left < 30:
                raw_probability *= 0.95  # slight penalty for last-minute
            elif days_left > 180:
                raw_probability *= 1.05  # bonus for long runway
        else:
            days_left = 0

    probability = max(0.0, min(1.0, raw_probability))

    # Determine trend
    if overall_trend > 0.02:
        trend = "improving"
    elif overall_trend < -0.02:
        trend = "declining"
    else:
        trend = "stable"

    # Sort factors by gap (biggest improvement opportunity first)
    factors.sort(key=lambda f: f.gap, reverse=True)

    highest_impact = factors[0].subject_name if factors else None
    total_hours_needed = sum(f.hours_to_improve for f in factors)

    return ApprovalPrediction(
        probability=round(probability, 3),
        trend=trend,
        factors=factors,
        highest_impact_subject=highest_impact,
        study_hours_needed=round(total_hours_needed, 1) if total_hours_needed else None,
        days_until_exam=days_left,
    )


def impact_of_extra_hour(
    subjects: list[SubjectMastery],
    target_subject: str,
) -> float:
    """
    Estimate how much one extra hour of study in a given subject
    would increase the overall approval probability.
    """
    mastery_gain_per_hour = 1.0 / HOURS_PER_MASTERY_POINT  # ~0.125

    total_weight = sum(s.weight_prf for s in subjects) or 1.0
    for s in subjects:
        if s.subject_name == target_subject:
            norm_weight = s.weight_prf / total_weight
            potential_gain = min(mastery_gain_per_hour, 1.0 - s.mastery) * norm_weight
            return round(potential_gain, 4)
    return 0.0
