"""
RetentionEstimator — measures how much of what was learned is being retained.

Retention directly predicts exam performance: material forgotten by exam day
counts for zero regardless of how well it was once known.

Weight: 0.25 — second-highest; the forgetting curve is the exam's biggest enemy.
"""
from __future__ import annotations
import math

from ..interfaces.context import ApprovalContext
from ..models.estimator import BaseEstimator, EstimatorResult

_MAX_OVERDUE = 30        # overdue cards at which retention pressure maxes out
_STRONG_EASE_FACTOR = 2.8  # SM-2 EF at which retention is considered "strong"


class RetentionEstimator(BaseEstimator):
    """
    Combines three retention signals:

    1. SM-2 stability (from LearningProfile retention_category):
       strong = 0.9, medium = 0.6, weak = 0.3

    2. Review backlog pressure:
       overdue cards reduce retention score proportionally.

    3. Forgetting velocity per subject (from LearningProfile forgetting_velocity):
       high velocity subjects get a penalty.

    Formula:
        retention_score = stability_base × (1 - overdue_pressure) × (1 - velocity_penalty)
    """

    @property
    def name(self) -> str:
        return "retention"

    @property
    def weight(self) -> float:
        return 0.25

    def estimate(self, context: ApprovalContext) -> EstimatorResult:
        stability_base = _stability_from_category(context.retention_category)
        overdue_pressure = _overdue_pressure(context.review_backlog)
        velocity_penalty = _velocity_penalty(context.learning_context)

        score = stability_base * (1.0 - overdue_pressure) * (1.0 - velocity_penalty)
        score = max(0.0, min(score, 1.0))

        confidence = 0.7 if context.learning_context else 0.4
        explanation = _build_explanation(
            score, context.retention_category,
            context.review_backlog.total_overdue,
            overdue_pressure,
        )

        return EstimatorResult(
            name=self.name,
            score=round(score, 4),
            weight=self.weight,
            confidence=confidence,
            explanation=explanation,
            detail={
                "stability_base": round(stability_base, 4),
                "overdue_pressure": round(overdue_pressure, 4),
                "velocity_penalty": round(velocity_penalty, 4),
                "total_overdue": context.review_backlog.total_overdue,
                "retention_category": context.retention_category,
            },
        )


def _stability_from_category(category: str) -> float:
    return {"strong": 0.90, "medium": 0.60, "weak": 0.30}.get(category, 0.55)


def _overdue_pressure(backlog) -> float:
    """0 = no overdue cards, 1 = maxed out at _MAX_OVERDUE+."""
    return min(backlog.total_overdue / _MAX_OVERDUE, 1.0)


def _velocity_penalty(learning_context: dict) -> float:
    """
    High forgetting velocity across subjects → penalty.
    forgetting_velocity is dict: subject_id → rate/day (0-1).
    Mean rate → penalty capped at 0.3.
    """
    fv = learning_context.get("forgetting_velocity", {})
    if not fv:
        return 0.10   # conservative default
    avg_velocity = sum(fv.values()) / len(fv)
    return min(avg_velocity * 0.5, 0.30)


def _build_explanation(score: float, category: str, overdue: int, pressure: float) -> str:
    parts = []
    if category == "weak":
        parts.append("Retenção fraca — material esquecendo rapidamente")
    elif category == "medium":
        parts.append("Retenção moderada")
    else:
        parts.append("Retenção forte")

    if overdue > 10:
        parts.append(f"{overdue} revisões atrasadas aumentam o risco de esquecimento")
    elif overdue > 0:
        parts.append(f"{overdue} revisões atrasadas")

    return " — ".join(parts) + f". Score: {score:.0%}"
