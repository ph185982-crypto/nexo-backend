"""
ProjectionCalculatorService — forward-projects approval probability at 7/30/60/90 days.

Uses current composite score, learning velocity, and consistency
to simulate where the student will be at each horizon.

No external data — pure function of the inputs already available.
"""
from __future__ import annotations

import math

from ..interfaces.context import ApprovalContext
from ..interfaces.estimate import ProjectedGrowth

# Match the sigmoid parameters used in ApprovalEstimatorService
_K = 10.0
_THRESHOLD = 0.55

_HORIZONS = (7, 30, 60, 90)


class ProjectionCalculatorService:
    """Pure computation — no I/O."""

    def calculate(
        self,
        context: ApprovalContext,
        current_composite: float,
        current_probability: float,
    ) -> ProjectedGrowth:
        has_data = bool(context.subjects) and bool(context.learning_context)
        if not has_data:
            return ProjectedGrowth(
                in_7_days=current_probability,
                in_30_days=current_probability,
                in_60_days=current_probability,
                in_90_days=current_probability,
                basis="no_data",
            )

        daily_delta = _daily_composite_delta(context)
        basis = "current_trajectory" if context.consistency.activity_ratio >= 0.3 else "minimal_activity"

        projections = []
        for days in _HORIZONS:
            projected_composite = min(current_composite + daily_delta * days, 1.0)
            projected_prob = _sigmoid(projected_composite)
            projections.append(round(projected_prob, 4))

        in_7, in_30, in_60, in_90 = projections

        # Apply exam-proximity pressure: if exam is within 30 days,
        # reduce projections slightly (less time to close gaps)
        if context.days_until_exam is not None and context.days_until_exam <= 30:
            penalty = 1.0 - (30 - context.days_until_exam) / 30.0 * 0.05
            in_30 = min(round(in_30 * penalty, 4), 1.0)
            in_60 = min(round(in_60 * penalty, 4), 1.0)
            in_90 = min(round(in_90 * penalty, 4), 1.0)

        return ProjectedGrowth(
            in_7_days=in_7,
            in_30_days=in_30,
            in_60_days=in_60,
            in_90_days=in_90,
            basis=basis,
        )


def _daily_composite_delta(context: ApprovalContext) -> float:
    """
    Estimate daily composite score growth based on:
    - learning_velocity (0-1) — how fast this student acquires new knowledge
    - activity_ratio (0-1) — how many days per month they study
    - review_efficiency (0-1) — how much review sessions consolidate knowledge
    """
    velocity = context.learning_velocity
    activity = context.consistency.activity_ratio
    efficiency = context.review_efficiency

    # Empirically tuned ceiling: the fastest learner studying every day
    # with perfect review efficiency gains ~0.005 composite/day.
    daily = velocity * activity * efficiency * 0.005

    # Cap at a ceiling that keeps 90-day projections realistic
    return min(daily, 0.004)


def _sigmoid(composite: float) -> float:
    return 1.0 / (1.0 + math.exp(-_K * (composite - _THRESHOLD)))
