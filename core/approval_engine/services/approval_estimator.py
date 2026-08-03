"""
ApprovalEstimatorService — composite orchestrator.

Runs all 6 estimators, normalises their contributions,
maps the composite to a probability via sigmoid,
and assembles the final ApprovalEstimate.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from ..interfaces.context import ApprovalContext, SubjectSnapshot
from ..interfaces.estimate import (
    ApprovalEstimate,
    DomainSummary,
    EstimatorDetail,
    ProjectedGrowth,
    TrendAnalysis,
)
from ..estimators import (
    CoverageEstimator,
    RetentionEstimator,
    ConsistencyEstimator,
    ExamWeightEstimator,
    GrowthEstimator,
    ConfidenceEstimator,
)
from ..models.estimator import EstimatorResult

# Sigmoid steepness and midpoint
_K = 10.0       # steepness — controls how sharp the S-curve is
_THRESHOLD = 0.55  # composite score at which P ≈ 0.50

# CEBRASPE: net score = (2×acc − 1) × 100; need > cutoff_score
_CEBRASPE_CORRECTION = 0.5  # acc > 0.5 is positive territory

_ESTIMATORS = [
    CoverageEstimator(),
    RetentionEstimator(),
    ConsistencyEstimator(),
    ExamWeightEstimator(),
    GrowthEstimator(),
    ConfidenceEstimator(),
]


class ApprovalEstimatorService:
    """Pure computation — no I/O, no side effects."""

    def estimate(self, context: ApprovalContext) -> ApprovalEstimate:
        results = [e.estimate(context) for e in _ESTIMATORS]
        composite, confidence = _composite(results)
        probability = _sigmoid(composite)

        exam_score = _estimated_exam_score(context, composite)
        cutoff_gap = exam_score - context.exam_config.cutoff_score

        weakest, strongest = _domain_summaries(context, composite)
        days_to_ready = _days_to_ready(context, composite)

        # Trend and projection are computed by their own services;
        # here we provide neutral stubs that callers can override.
        trend = TrendAnalysis(
            direction="stable",
            acceleration="steady",
            delta_probability=0.0,
            explanation="Sem dados históricos suficientes.",
        )
        projected = ProjectedGrowth(
            in_7_days=probability,
            in_30_days=probability,
            in_60_days=probability,
            in_90_days=probability,
            basis="no_data",
        )

        explanation = _build_explanation(results, probability, context)
        detail = [_to_detail(r) for r in results]

        return ApprovalEstimate(
            user_id=context.user_id,
            target_exam=context.target_exam,
            computed_at=datetime.now(timezone.utc),
            approval_probability=round(probability, 4),
            confidence_score=round(confidence, 4),
            estimated_exam_score=round(exam_score, 2),
            estimated_cutoff_gap=round(cutoff_gap, 2),
            coverage_score=round(_find(results, "coverage"), 4),
            retention_score=round(_find(results, "retention"), 4),
            consistency_score=round(_find(results, "consistency"), 4),
            weakest_domains=weakest,
            strongest_domains=strongest,
            days_to_ready=days_to_ready,
            projected_growth=projected,
            trend=trend,
            explanation=explanation,
            estimator_detail=detail,
        )


# ── helpers ──────────────────────────────────────────────────────────────────

def _composite(results: list[EstimatorResult]) -> tuple[float, float]:
    total_w = sum(r.weight for r in results) or 1.0
    weighted_score = sum(r.score * r.weight for r in results) / total_w
    # Confidence: weighted average of per-estimator confidence
    weighted_conf = sum(r.confidence * r.weight for r in results) / total_w
    return weighted_score, weighted_conf


def _sigmoid(composite: float) -> float:
    exponent = -_K * (composite - _THRESHOLD)
    return 1.0 / (1.0 + math.exp(exponent))


def _estimated_exam_score(context: ApprovalContext, composite: float) -> float:
    """
    Project composite score onto the exam's scoring scale.

    CEBRASPE: score = (2 × accuracy − 1) × 100, range −100..100, pass ≥ cutoff_score
    AOCP: score = accuracy × 100, range 0..100, pass ≥ cutoff_score
    """
    # composite is a proxy for expected answer accuracy (0-1)
    accuracy = composite  # best approximation without per-question simulation

    if context.exam_config.scoring_method == "cebraspe":
        # Assume guessing distributes errors proportionally
        net = (2.0 * accuracy - 1.0) * 100.0
        return max(-100.0, min(net, 100.0))
    else:  # aocp or unknown
        return accuracy * 100.0


def _domain_summaries(
    context: ApprovalContext, composite: float
) -> tuple[list[DomainSummary], list[DomainSummary]]:
    if not context.subjects:
        return [], []

    summaries = [_subject_to_summary(s, composite) for s in context.subjects]
    summaries.sort(key=lambda d: d.approval_contribution)
    weakest = summaries[:3]
    strongest = list(reversed(summaries[-3:]))
    return weakest, strongest


def _subject_to_summary(s: SubjectSnapshot, composite: float) -> DomainSummary:
    # Contribution = how much this subject helps vs hurts the composite
    subject_score = s.coverage_ratio * (s.mastery_score / 100.0)
    contribution = subject_score - composite  # positive = above average

    if s.coverage_ratio < 0.20:
        key_issue = "coverage"
    elif s.mastery_score < 40.0:
        key_issue = "retention"
    elif s.correct_rate < 0.45:
        key_issue = "errors"
    elif contribution >= 0.05:
        key_issue = "strong"
    else:
        key_issue = "review_backlog"

    return DomainSummary(
        subject_id=s.subject_id,
        subject_name=s.subject_name,
        exam_weight=s.exam_weight,
        mastery_score=s.mastery_score,
        coverage_ratio=s.coverage_ratio,
        approval_contribution=round(contribution, 4),
        key_issue=key_issue,
    )


def _days_to_ready(context: ApprovalContext, composite: float) -> Optional[int]:
    """
    Rough estimate of days needed to reach approval probability ≥ 0.70 (composite ≥ ~0.57).
    Returns None when no exam date is set or already there.
    """
    target_composite = 0.57
    if composite >= target_composite:
        return 0

    gap = target_composite - composite
    # Daily growth ≈ composite × consistency × 0.005 (empirically tuned constant)
    daily_growth = max(composite * context.consistency.activity_ratio * 0.005, 0.001)
    raw_days = int(math.ceil(gap / daily_growth))

    if context.days_until_exam is not None:
        return min(raw_days, context.days_until_exam)
    return raw_days


def _build_explanation(
    results: list[EstimatorResult], probability: float, context: ApprovalContext
) -> list[str]:
    lines: list[str] = []
    lines.append(f"Probabilidade estimada de aprovação: {probability:.0%}")

    # Surface the two weakest estimators by raw score (not weighted contribution)
    sorted_r = sorted(results, key=lambda r: r.score)
    for r in sorted_r[:2]:
        lines.append(r.explanation)

    if context.exam_approaching and context.days_until_exam is not None:
        lines.append(
            f"Atenção: {context.days_until_exam} dias até o exame — "
            "foco nas matérias críticas."
        )
    return lines


def _find(results: list[EstimatorResult], name: str) -> float:
    for r in results:
        if r.name == name:
            return r.score
    return 0.0


def _to_detail(r: EstimatorResult) -> EstimatorDetail:
    return EstimatorDetail(
        name=r.name,
        raw_score=r.score,
        weight=r.weight,
        contribution=round(r.contribution, 4),
        confidence=r.confidence,
        explanation=r.explanation,
    )
