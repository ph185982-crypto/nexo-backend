"""
CandidatePoolBuilder — converts QuestionSnapshot → QuestionCandidate.

Responsibilities:
  - Materialise the mutable candidate objects the ranker will score.
  - No filtering at this stage (that's CandidateFilter's job).
"""
from __future__ import annotations

from ..interfaces.context import QuestionSelectionContext
from ..models.candidate import QuestionCandidate


class CandidatePoolBuilder:
    """Converts context.available_questions into scorable candidates."""

    def build(self, context: QuestionSelectionContext) -> list[QuestionCandidate]:
        candidates: list[QuestionCandidate] = []
        for snap in context.available_questions:
            candidates.append(
                QuestionCandidate(
                    question_id=snap.question_id,
                    subject_id=snap.subject_id,
                    topic_id=snap.topic_id,
                    article_id=snap.article_id,
                    difficulty=snap.difficulty,
                    exam_frequency=snap.exam_frequency,
                    is_true_false=snap.is_true_false,
                    is_exception_type=snap.is_exception_type,
                    tags=frozenset(snap.tags),
                    estimated_time_secs=snap.estimated_time_secs,
                    times_answered=snap.times_answered,
                    times_wrong=snap.times_wrong,
                    last_answered_at=snap.last_answered_at,
                )
            )
        return candidates
