"""
ConsistencyEstimator — measures study regularity over the last 30 days.

Consistency is a proxy for long-term retention and mission discipline.
A student who studies every day retains dramatically more than one who
crams occasionally, even with the same total hours.

Weight: 0.15
"""
from __future__ import annotations

from ..interfaces.context import ApprovalContext
from ..models.estimator import BaseEstimator, EstimatorResult

_STRONG_STREAK = 14        # 2 weeks → "consistent"
_GOOD_ACTIVITY_RATIO = 0.6  # 18 of 30 days → "active"
_GOOD_MISSION_RATE = 0.70   # 70% mission completion → "disciplined"


class ConsistencyEstimator(BaseEstimator):
    """
    Combines:

    1. Study streak (streak_days):
       streak ≥ 14 → 1.0; streak < 3 → 0.2

    2. Activity ratio (days_active / 30):
       ≥ 60% active → strong contribution

    3. Mission completion rate (completed / total last 30):
       ≥ 70% → full contribution; 0% → zero

    Formula:
        consistency = streak_score × 0.30 + activity_score × 0.40 + mission_score × 0.30
    """

    @property
    def name(self) -> str:
        return "consistency"

    @property
    def weight(self) -> float:
        return 0.15

    def estimate(self, context: ApprovalContext) -> EstimatorResult:
        c = context.consistency

        streak_score = _streak_score(c.streak_days)
        activity_score = c.activity_ratio
        mission_score = c.mission_completion_rate

        score = (streak_score * 0.30 + activity_score * 0.40 + mission_score * 0.30)
        score = max(0.0, min(score, 1.0))

        # Confidence is high when there's 30 days of data
        confidence = min(c.days_active_last_30 / 20.0, 0.95)

        explanation = _build_explanation(score, c.streak_days, c.activity_ratio, mission_score)

        return EstimatorResult(
            name=self.name,
            score=round(score, 4),
            weight=self.weight,
            confidence=round(confidence, 4),
            explanation=explanation,
            detail={
                "streak_days": c.streak_days,
                "streak_score": round(streak_score, 4),
                "activity_ratio": round(c.activity_ratio, 4),
                "mission_completion_rate": round(mission_score, 4),
                "days_active_last_30": c.days_active_last_30,
                "avg_daily_questions": round(c.avg_daily_questions, 1),
            },
        )


def _streak_score(streak_days: int) -> float:
    if streak_days <= 0:
        return 0.0
    if streak_days >= _STRONG_STREAK:
        return 1.0
    # Logarithmic ramp: first days matter most
    import math
    return min(math.log(streak_days + 1) / math.log(_STRONG_STREAK + 1), 1.0)


def _build_explanation(score: float, streak: int, activity: float, mission_rate: float) -> str:
    parts = []
    if streak >= _STRONG_STREAK:
        parts.append(f"Sequência sólida de {streak} dias")
    elif streak > 0:
        parts.append(f"Sequência de {streak} dias")
    else:
        parts.append("Sem sequência de estudo")

    if activity >= _GOOD_ACTIVITY_RATIO:
        parts.append(f"Ativo {activity:.0%} dos últimos 30 dias")
    else:
        parts.append(f"Atividade baixa ({activity:.0%} dos últimos 30 dias)")

    if mission_rate >= _GOOD_MISSION_RATE:
        parts.append(f"Missões bem cumpridas ({mission_rate:.0%})")
    elif mission_rate > 0:
        parts.append(f"Missões: {mission_rate:.0%} de conclusão")

    return " — ".join(parts) + f". Score: {score:.0%}"
