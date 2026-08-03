"""
TrendAnalyzerService — detects direction and acceleration of approval probability.

Compares the current estimate against the previous snapshot to
classify trend direction (improving / stable / declining) and
acceleration (accelerating / steady / decelerating).
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Optional

from ..interfaces.context import ApprovalContext
from ..interfaces.estimate import TrendAnalysis

_STABLE_BAND = 0.03          # delta below this → "stable" (noise floor)
_ACCEL_THRESHOLD = 0.005     # daily rate difference to count as acceleration


class TrendAnalyzerService:
    """Pure computation — no I/O."""

    def analyze(
        self,
        context: ApprovalContext,
        current_probability: float,
    ) -> TrendAnalysis:
        prev = context.previous_approval_probability
        prev_at = context.previous_computed_at

        if prev is None or prev_at is None:
            return TrendAnalysis(
                direction="stable",
                acceleration="steady",
                delta_probability=0.0,
                explanation="Sem histórico anterior para comparação.",
            )

        delta = current_probability - prev
        direction = _direction(delta)

        # Daily rate: how much probability changed per day
        elapsed_days = _elapsed_days(prev_at)
        if elapsed_days <= 0:
            daily_rate = 0.0
        else:
            daily_rate = delta / elapsed_days

        acceleration = _acceleration(daily_rate, context)
        explanation = _build_explanation(direction, acceleration, delta, elapsed_days)

        return TrendAnalysis(
            direction=direction,
            acceleration=acceleration,
            delta_probability=round(delta, 4),
            explanation=explanation,
        )


def _direction(delta: float) -> str:
    if delta > _STABLE_BAND:
        return "improving"
    if delta < -_STABLE_BAND:
        return "declining"
    return "stable"


def _elapsed_days(prev_at: datetime) -> float:
    now = datetime.now(timezone.utc)
    if prev_at.tzinfo is None:
        prev_at = prev_at.replace(tzinfo=timezone.utc)
    return max((now - prev_at).total_seconds() / 86_400.0, 0.0)


def _acceleration(daily_rate: float, context: ApprovalContext) -> str:
    """
    Compare daily rate against the student's recent activity ratio.
    Higher activity → we expect a baseline daily rate.
    If actual > expected → accelerating; if lower → decelerating.
    """
    expected_daily = context.consistency.activity_ratio * 0.004  # empirical baseline
    if daily_rate > expected_daily + _ACCEL_THRESHOLD:
        return "accelerating"
    if daily_rate < expected_daily - _ACCEL_THRESHOLD:
        return "decelerating"
    return "steady"


def _build_explanation(
    direction: str, acceleration: str, delta: float, elapsed_days: float
) -> str:
    sign = "+" if delta >= 0 else ""
    period = f"{int(elapsed_days)} dias" if elapsed_days >= 1 else "período recente"

    if direction == "improving":
        base = f"Probabilidade subiu {sign}{delta:.1%} nos últimos {period}"
    elif direction == "declining":
        base = f"Probabilidade caiu {delta:.1%} nos últimos {period}"
    else:
        base = f"Probabilidade estável nos últimos {period}"

    accel_map = {
        "accelerating": " — ritmo acelerado.",
        "decelerating": " — ritmo desacelerado.",
        "steady": ".",
    }
    return base + accel_map.get(acceleration, ".")
