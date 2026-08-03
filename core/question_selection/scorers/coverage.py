"""
CoverageScorer — penalises over-represented articles in recent history.

Weight: 0.04

Rule: if the same article has appeared ≥ MAX_SAME_ARTICLE times in
recent_article_ids (the caller's rolling window of recently seen articles),
the score drops to 0. Linear decay in between.

This implements the diversity rule: avoid five questions from the same article
unless the objective explicitly targets that article.

Exception: when the current objective targets the candidate's article, the
penalty is waived (ObjectiveScorer already rewards it strongly).
"""
from __future__ import annotations

from ..interfaces.context import QuestionSelectionContext
from ..models.candidate import QuestionCandidate


_MAX_SAME_ARTICLE = 5


class CoverageScorer:
    name = "coverage"
    weight = 0.04

    def score(self, candidate: QuestionCandidate, context: QuestionSelectionContext) -> float:
        if not candidate.article_id:
            return 1.0  # no article → no diversity concern

        # Waive penalty if this article is the session's explicit objective
        if context.objective_article_id and candidate.article_id == context.objective_article_id:
            return 1.0

        count = context.recent_article_ids.count(candidate.article_id)
        return max(1.0 - count / _MAX_SAME_ARTICLE, 0.0)
