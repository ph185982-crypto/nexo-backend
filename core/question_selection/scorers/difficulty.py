"""
DifficultyScorer — rewards questions that match the current difficulty target.

Weight: 0.10

The target is set by Study Runtime (already adjusted for fatigue, performance
trajectory, and session objectives). This scorer simply measures the distance
between candidate difficulty and the requested target on a 5-level scale.

Distance 0 → 1.00   (perfect match)
Distance 1 → 0.75
Distance 2 → 0.50
Distance 3 → 0.25
Distance 4 → 0.00   (VERY_EASY vs VERY_HARD)
"""
from __future__ import annotations

from ..interfaces.context import QuestionSelectionContext
from ..models.candidate import QuestionCandidate
from ..models.enums import DIFFICULTY_VALUE


_PENALTY_PER_LEVEL = 0.25


class DifficultyScorer:
    name = "difficulty"
    weight = 0.10

    def score(self, candidate: QuestionCandidate, context: QuestionSelectionContext) -> float:
        target_val = DIFFICULTY_VALUE[context.difficulty_target]
        cand_val   = DIFFICULTY_VALUE[candidate.difficulty]
        distance   = abs(cand_val - target_val)
        return max(1.0 - distance * _PENALTY_PER_LEVEL, 0.0)
