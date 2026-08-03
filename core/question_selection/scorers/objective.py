"""
ObjectiveScorer — rewards questions that align with the current session objective.

Weight: 0.08

Alignment is measured at three levels (additive):
  Subject match   → +0.60
  Topic match     → +0.30 (only if subject also matched)
  Article match   → +0.10 (only if topic also matched)

In OBJECTIVE mode the composite is amplified by 20 % (cap 1.0).

When no objective is active the scorer returns 0.50 (neutral) so it does not
penalise otherwise strong candidates.
"""
from __future__ import annotations

from ..interfaces.context import QuestionSelectionContext
from ..models.candidate import QuestionCandidate
from ..models.enums import SelectionMode


class ObjectiveScorer:
    name = "objective"
    weight = 0.08

    def score(self, candidate: QuestionCandidate, context: QuestionSelectionContext) -> float:
        if not context.current_objective:
            return 0.50  # neutral — no objective active

        alignment = 0.0

        if context.objective_subject_id and candidate.subject_id == context.objective_subject_id:
            alignment += 0.60

            if context.objective_topic_id and candidate.topic_id == context.objective_topic_id:
                alignment += 0.30

                if (context.objective_article_id
                        and candidate.article_id == context.objective_article_id):
                    alignment += 0.10

        if context.mode == SelectionMode.OBJECTIVE and alignment > 0:
            alignment = min(alignment * 1.20, 1.0)

        return min(alignment, 1.0)
