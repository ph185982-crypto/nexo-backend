"""
RetentionScorer — rewards questions where the forgetting curve predicts decay.

Weight: 0.15

Uses an Ebbinghaus-inspired approximation:
  retention(t) = exp(-t / τ)   where τ = 7 days (half-life ≈ 4.85 days)
  score = 1 - retention(t) = forgetting probability

Rules:
  - Never answered → 0.50 (neutral; prioritised by other scorers instead)
  - Answered < 1 hour ago → 0.00 (too fresh to be useful)
  - Answered < 1 day and mastery high (≥ 0.70) → 0.05 (recently reinforced)
  - Answered < 1 day and mastery low  (< 0.70) → 0.40 (repeat is valuable)
  - Answered ≥ 1 day → Ebbinghaus formula
"""
from __future__ import annotations

import math

from ..interfaces.context import QuestionSelectionContext
from ..models.candidate import QuestionCandidate


_TAU_DAYS = 7.0        # forgetting curve time constant


class RetentionScorer:
    name = "retention"
    weight = 0.15

    def score(self, candidate: QuestionCandidate, context: QuestionSelectionContext) -> float:
        days = candidate.days_since_last_answer

        if days is None:
            return 0.50  # unseen — neutral

        if days < (1.0 / 24.0):   # < 1 hour
            return 0.00

        if days < 1.0:
            subj_mastery = context.subject_mastery.get(str(candidate.subject_id), 0.50)
            return 0.05 if subj_mastery >= 0.70 else 0.40

        # Ebbinghaus: score = probability of having forgotten
        return min(1.0 - math.exp(-days / _TAU_DAYS), 1.0)
