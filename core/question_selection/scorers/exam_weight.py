"""
ExamWeightScorer — rewards questions that appear in real PRF/CEBRASPE exams.

Weight: 0.15

In EXAM_SIMULATION mode the frequency signal is amplified by 50 %
(capped at 1.0) so the selection profile mirrors actual exam question density.
"""
from __future__ import annotations

from ..interfaces.context import QuestionSelectionContext
from ..models.candidate import QuestionCandidate
from ..models.enums import SelectionMode


class ExamWeightScorer:
    name = "exam_weight"
    weight = 0.15

    def score(self, candidate: QuestionCandidate, context: QuestionSelectionContext) -> float:
        base = candidate.exam_frequency   # already 0–1 from the snapshot
        if context.mode == SelectionMode.EXAM_SIMULATION:
            base = min(base * 1.5, 1.0)
        return base
