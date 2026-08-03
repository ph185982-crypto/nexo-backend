"""
TimeCostScorer — penalises questions that exceed the remaining session time.

Weight: 0.01 (tie-breaker, not a primary signal)

Rules:
  remaining_time_secs ≤ 0          → 0.00 for all
  estimated_time > remaining        → 0.00  (cannot fit)
  fits with > 50 % time remaining   → 1.00  (comfortable)
  fits with 0–50 % remaining        → linear decay 1.00 → 0.00

The low weight ensures this scorer only matters when all other scores are equal.
It is designed to prevent presenting a 10-minute question when only 2 minutes
remain — a poor user experience regardless of question quality.
"""
from __future__ import annotations

from ..interfaces.context import QuestionSelectionContext
from ..models.candidate import QuestionCandidate


class TimeCostScorer:
    name = "time_cost"
    weight = 0.01

    def score(self, candidate: QuestionCandidate, context: QuestionSelectionContext) -> float:
        remaining = context.remaining_time_secs

        if remaining <= 0:
            return 0.0

        if candidate.estimated_time_secs > remaining:
            return 0.0   # cannot complete within time

        ratio = candidate.estimated_time_secs / remaining
        if ratio <= 0.50:
            return 1.0   # comfortable fit

        # Linear decay from 1.0 (ratio=0.50) to 0.0 (ratio=1.0)
        return max(1.0 - (ratio - 0.50) * 2.0, 0.0)
