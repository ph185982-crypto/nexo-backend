"""Output type produced by QuestionSelectionEngine.select()."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional
from uuid import UUID

from ..models.enums import DifficultyLevel, SelectionMode, SelectionReason


@dataclass(frozen=True)
class QuestionSelectionResult:
    """
    The engine's answer: which question to present next, and why.

    Callers use question_id to fetch full question content from the DB.
    The score_breakdown supports transparent reasoning and debugging.
    """
    question_id: UUID
    selection_reason: SelectionReason
    selection_score: float              # composite 0–1
    difficulty: DifficultyLevel
    estimated_learning_gain: float      # 0–1 proxy from LearningGainScorer
    estimated_time_secs: int
    related_article_id: Optional[UUID]
    related_topic_id: Optional[UUID]
    score_breakdown: dict               # dict[str, float] scorer → raw score
    alternative_question_ids: tuple     # tuple[UUID, ...] next 3 best candidates
    selection_mode: SelectionMode

    def as_dict(self) -> dict:
        return {
            "question_id":           str(self.question_id),
            "selection_reason":      self.selection_reason.value,
            "selection_score":       round(self.selection_score, 4),
            "difficulty":            self.difficulty.value,
            "estimated_learning_gain": round(self.estimated_learning_gain, 4),
            "estimated_time_secs":   self.estimated_time_secs,
            "related_article_id":    str(self.related_article_id) if self.related_article_id else None,
            "related_topic_id":      str(self.related_topic_id) if self.related_topic_id else None,
            "score_breakdown":       {k: round(v, 4) for k, v in self.score_breakdown.items()},
            "alternatives":          [str(qid) for qid in self.alternative_question_ids],
            "selection_mode":        self.selection_mode.value,
        }
