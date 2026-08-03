from __future__ import annotations
import math

from ..interfaces.context import ROIContext
from ..interfaces.opportunity import StudyOpportunity
from ..interfaces.strategy import ScoringStrategy

_REFERENCE_MINUTES = 15.0   # baseline session length for normalisation


class TimeEfficiencyScoringStrategy(ScoringStrategy):
    """
    Dimension: How much gain does this opportunity deliver per minute?

    When time is tight, short high-impact sessions score higher.
    Formula: gain_per_minute × time_scarcity_factor.

    The time_scarcity_factor amplifies short opportunities when available_minutes
    is low, and is neutral (1.0) when time is plentiful.

    Weight: 0.10
    """

    @property
    def name(self) -> str:
        return "time_efficiency"

    @property
    def weight(self) -> float:
        return 0.10

    def score(self, opportunity: StudyOpportunity, context: ROIContext) -> float:
        if opportunity.estimated_minutes <= 0:
            return 0.0

        # Opportunity does not fit — apply a heavy penalty rather than 0
        # so that the ranking still demotes it without making it invisible
        if not opportunity.fits_in(context.available_minutes):
            return 0.05

        gain_per_minute = opportunity.expected_gain / opportunity.estimated_minutes
        # Normalise against the reference (15 min at 0.35 gain ≈ 0.023)
        normalised = gain_per_minute / (_BASE_GAIN_PER_MIN)

        # Time scarcity factor: rises when time is short
        scarcity = _time_scarcity(context.available_minutes)

        return min(normalised * scarcity, 1.0)


# Reference: 15 min session delivering 0.35 gain → 0.023 gain/min
_BASE_GAIN_PER_MIN = 0.35 / _REFERENCE_MINUTES


def _time_scarcity(available: int) -> float:
    """
    Sigmoid-like boost: returns ~1.0 when time is plentiful (>= 30 min),
    rises to ~2.0 when time is very short (< 10 min).
    """
    if available <= 0:
        return 2.0
    return 1.0 + math.exp(-available / 15.0)
