"""
KnowledgeGapScorer — rewards questions that address the student's known gaps.

Weight: 0.20 (highest — gap-filling is the primary purpose of adaptive study).

Signal sources:
  - context.knowledge_gaps   (from KGE)
  - context.review_backlog   (spaced-repetition queue)
  - SelectionMode.REVIEW     (backlog questions become top priority)
"""
from __future__ import annotations

from ..interfaces.context import QuestionSelectionContext
from ..models.candidate import QuestionCandidate
from ..models.enums import SelectionMode


class KnowledgeGapScorer:
    name = "knowledge_gap"
    weight = 0.20

    def score(self, candidate: QuestionCandidate, context: QuestionSelectionContext) -> float:
        backlog_set = frozenset(context.review_backlog)

        # REVIEW mode: backlog questions take precedence; others are depressed
        if context.mode == SelectionMode.REVIEW:
            if candidate.question_id in backlog_set:
                return 1.0
            return 0.20

        # No gap information → neutral
        if not context.knowledge_gaps:
            base = 0.50
        else:
            gap_set = frozenset(context.knowledge_gaps)
            overlap = len(candidate.tags & gap_set)
            if overlap == 0:
                base = 0.10
            else:
                # Overlap ratio, mapped to [0.30, 1.00]
                ratio = min(overlap / max(len(candidate.tags), 1), 1.0)
                base = 0.30 + ratio * 0.70

        # Backlog questions get an additional boost in any mode
        if candidate.question_id in backlog_set:
            base = min(base + 0.20, 1.0)

        return base
