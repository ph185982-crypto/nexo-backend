"""
LearningGainScorer — estimates how much the student will gain from this question.

Weight: 0.10

Formula:
  gain = mastery_potential × 0.75
       + unseen_bonus       × 0.15   (first encounter has high value)
       + exception_bonus    × 0.10   (exception questions require deeper processing)

mastery_potential = 1 - subject_mastery  (low mastery → high gain opportunity)

When fatigue is HIGH or EXHAUSTED, time-efficiency is factored in: shorter
questions are preferred because cognitive bandwidth is limited.
"""
from __future__ import annotations

from ..interfaces.context import QuestionSelectionContext
from ..models.candidate import QuestionCandidate


_HIGH_FATIGUE_LEVELS = {"HIGH", "EXHAUSTED"}


class LearningGainScorer:
    name = "learning_gain"
    weight = 0.10

    def score(self, candidate: QuestionCandidate, context: QuestionSelectionContext) -> float:
        subj_mastery = context.subject_mastery.get(str(candidate.subject_id), 0.50)
        mastery_potential = 1.0 - subj_mastery

        unseen_bonus    = 0.15 if candidate.is_unseen else 0.0
        exception_bonus = 0.10 if candidate.is_exception_type else 0.0

        if context.fatigue_level in _HIGH_FATIGUE_LEVELS:
            # Prefer shorter questions when fatigued — more gain per cognitive unit
            max_t = 300.0  # 5 min cap
            time_efficiency = max(1.0 - candidate.estimated_time_secs / max_t, 0.0)
            return min(
                mastery_potential * 0.50
                + time_efficiency * 0.25
                + unseen_bonus,
                1.0,
            )

        return min(
            mastery_potential * 0.75
            + unseen_bonus
            + exception_bonus,
            1.0,
        )
