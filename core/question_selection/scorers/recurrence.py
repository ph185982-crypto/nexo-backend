"""
RecurrenceScorer — rewards questions the student has historically struggled with.

Weight: 0.15

Priority order:
  1. REINFORCEMENT mode + concept/article match → 1.0
  2. Question in recent_errors (exact match) → 0.90
  3. Question tags overlap error_concept_tags → 0.50–0.80
  4. Historical error_rate contribution → 0.00–0.50

In REINFORCEMENT mode the engine is explicitly asked to consolidate a concept.
Returning the *same* question that was wrong is avoided by session deduplication
(the pipeline filter removes session_questions), so this scorer can safely boost
concept-matching questions without risk of exact repetition.
"""
from __future__ import annotations

from ..interfaces.context import QuestionSelectionContext
from ..models.candidate import QuestionCandidate
from ..models.enums import SelectionMode


class RecurrenceScorer:
    name = "recurrence"
    weight = 0.15

    def score(self, candidate: QuestionCandidate, context: QuestionSelectionContext) -> float:
        # ── REINFORCEMENT mode ──────────────────────────────────────────────
        if context.mode == SelectionMode.REINFORCEMENT:
            if (context.reinforcement_article_id
                    and candidate.article_id == context.reinforcement_article_id):
                return 1.0
            reinf_tags = frozenset(context.reinforcement_concept_tags)
            if reinf_tags and candidate.tags & reinf_tags:
                overlap = len(candidate.tags & reinf_tags) / max(len(candidate.tags), 1)
                return min(0.60 + overlap * 0.40, 1.0)

        # ── Normal mode ─────────────────────────────────────────────────────
        error_set = frozenset(context.recent_errors)
        if candidate.question_id in error_set:
            return 0.90

        error_tags = frozenset(context.error_concept_tags)
        if error_tags and candidate.tags & error_tags:
            overlap = len(candidate.tags & error_tags) / max(len(candidate.tags), 1)
            return 0.50 + overlap * 0.30

        # Historical error rate (weak signal)
        return candidate.error_rate * 0.50
