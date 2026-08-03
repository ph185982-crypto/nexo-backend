"""
GrowthEstimator — measures momentum and learning trajectory.

A student improving fast now will close gaps before exam day;
one plateauing or declining will not, regardless of current mastery.

Weight: 0.07
"""
from __future__ import annotations

from ..interfaces.context import ApprovalContext
from ..models.estimator import BaseEstimator, EstimatorResult

_FAST_VELOCITY = 0.7    # learning_velocity above this → "fast learner"
_SLOW_VELOCITY = 0.3    # learning_velocity below this → "slow"
_HIGH_EFFICIENCY = 0.70 # review_efficiency_score above this → "efficient"


class GrowthEstimator(BaseEstimator):
    """
    Combines three trajectory signals:

    1. Learning velocity (from LearningProfile via learning_context):
       fast = 1.0; moderate = 0.6; slow = 0.3

    2. Review efficiency:
       Ratio of correct reviews to total reviews — high efficiency means
       each study session produces durable retention gains.

    3. Coverage momentum:
       Average coverage_ratio across subjects weighted by exam_weight.
       Low coverage + high velocity → high potential.
       High coverage + low velocity → plateauing.

    Formula:
        growth_score = velocity_score × 0.50 + efficiency_score × 0.30 + momentum_score × 0.20
    """

    @property
    def name(self) -> str:
        return "growth"

    @property
    def weight(self) -> float:
        return 0.07

    def estimate(self, context: ApprovalContext) -> EstimatorResult:
        velocity_score = _velocity_score(context.learning_velocity)
        efficiency_score = context.review_efficiency
        momentum_score = _coverage_momentum(context)

        score = (
            velocity_score * 0.50
            + efficiency_score * 0.30
            + momentum_score * 0.20
        )
        score = max(0.0, min(score, 1.0))

        confidence = 0.6 if context.learning_context else 0.3
        explanation = _build_explanation(score, velocity_score, efficiency_score, context)

        return EstimatorResult(
            name=self.name,
            score=round(score, 4),
            weight=self.weight,
            confidence=confidence,
            explanation=explanation,
            detail={
                "learning_velocity": round(context.learning_velocity, 4),
                "velocity_score": round(velocity_score, 4),
                "review_efficiency": round(efficiency_score, 4),
                "coverage_momentum": round(momentum_score, 4),
            },
        )


def _velocity_score(velocity: float) -> float:
    if velocity >= _FAST_VELOCITY:
        return 1.0
    if velocity <= _SLOW_VELOCITY:
        return 0.3
    # Linear interpolation between slow and fast bands
    return 0.3 + (velocity - _SLOW_VELOCITY) / (_FAST_VELOCITY - _SLOW_VELOCITY) * 0.7


def _coverage_momentum(context: ApprovalContext) -> float:
    """
    Weighted average coverage ratio across subjects.
    A student with broad but shallow coverage still has momentum —
    they're touching more topics, which is forward movement.
    """
    if not context.subjects:
        return 0.5
    total_w = context.total_exam_weight
    return sum(s.coverage_ratio * s.exam_weight for s in context.subjects) / total_w


def _build_explanation(
    score: float, velocity: float, efficiency: float, context: ApprovalContext
) -> str:
    if velocity >= _FAST_VELOCITY:
        trajectory = "Aprendizado acelerado"
    elif velocity >= _SLOW_VELOCITY:
        trajectory = "Evolução estável"
    else:
        trajectory = "Crescimento lento"

    if efficiency >= _HIGH_EFFICIENCY:
        eff_label = "revisões muito eficientes"
    elif efficiency >= 0.45:
        eff_label = "revisões moderadas"
    else:
        eff_label = "revisões pouco eficientes"

    return f"{trajectory} — {eff_label}. Score: {score:.0%}"
