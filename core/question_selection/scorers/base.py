"""Scorer protocol — every scorer must satisfy this contract."""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from ..models.candidate import QuestionCandidate
from ..interfaces.context import QuestionSelectionContext


@runtime_checkable
class Scorer(Protocol):
    name: str
    weight: float

    def score(
        self,
        candidate: QuestionCandidate,
        context: QuestionSelectionContext,
    ) -> float:
        """Return a value in [0, 1]. Higher = more desirable candidate."""
        ...
