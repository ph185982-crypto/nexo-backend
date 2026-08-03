"""
RecentExposureScorer — penalises questions seen very recently.

Weight: 0.02

Three bands:
  In session_questions  → 0.00  (defensive; pipeline filter handles this)
  In recent_questions   → 0.10  (seen in last 24 h)
  Otherwise             → 1.00  (fresh)

When mastery is very low (< 0.30), recent exposure is less penalised — the
student needs repeated reinforcement and the filter already excluded same-session
questions.
"""
from __future__ import annotations

from ..interfaces.context import QuestionSelectionContext
from ..models.candidate import QuestionCandidate


class RecentExposureScorer:
    name = "recent_exposure"
    weight = 0.02

    def score(self, candidate: QuestionCandidate, context: QuestionSelectionContext) -> float:
        if candidate.question_id in frozenset(context.session_questions):
            return 0.0  # hard stop (defensive; filter already removed these)

        if candidate.question_id in frozenset(context.recent_questions):
            avg_mastery = (
                sum(context.subject_mastery.values()) / len(context.subject_mastery)
                if context.subject_mastery else 0.50
            )
            # Allow some repetition when mastery is very low
            return 0.40 if avg_mastery < 0.30 else 0.10

        return 1.0
