"""
QuestionCandidate — internal working object used during selection scoring.

Built from QuestionSnapshot by CandidatePoolBuilder and enriched by the
ranking pipeline. Never exposed outside the engine.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from .enums import DifficultyLevel, SelectionReason


@dataclass
class QuestionCandidate:
    """
    Internal mutable representation of a candidate question.

    Holds raw question metadata plus score fields that the ranker writes.
    Mutability is intentional — the ranker fills score_breakdown and
    composite_score in a single pass.
    """
    question_id: UUID
    subject_id: UUID
    topic_id: Optional[UUID]
    article_id: Optional[UUID]
    difficulty: DifficultyLevel
    exam_frequency: float           # 0–1
    is_true_false: bool
    is_exception_type: bool         # phrased with "exceto / salvo / ressalvado"
    tags: frozenset                 # frozenset[str]
    estimated_time_secs: int
    times_answered: int
    times_wrong: int
    last_answered_at: Optional[datetime]

    # Written by CandidateRanker
    composite_score: float = 0.0
    score_breakdown: dict = field(default_factory=dict)
    primary_reason: SelectionReason = SelectionReason.FALLBACK

    # ── Computed helpers ────────────────────────────────────────────────────

    @property
    def error_rate(self) -> float:
        if self.times_answered == 0:
            return 0.0
        return min(self.times_wrong / self.times_answered, 1.0)

    @property
    def is_unseen(self) -> bool:
        return self.times_answered == 0

    @property
    def days_since_last_answer(self) -> Optional[float]:
        if self.last_answered_at is None:
            return None
        now = datetime.now(timezone.utc)
        last = self.last_answered_at
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        delta = now - last
        return max(delta.total_seconds() / 86_400.0, 0.0)
