from __future__ import annotations
from abc import ABC, abstractmethod

from .context import ROIContext
from .opportunity import StudyOpportunity


class ScoringStrategy(ABC):
    """
    Base class for all ROI scoring strategies.

    Each strategy answers ONE dimension of 'how valuable is this opportunity?'
    Strategies are additive — the engine sums their weighted contributions.

    To add a new strategy:
      1. Subclass ScoringStrategy
      2. Set `name` and `weight` (total weights in the engine must sum to 1.0)
      3. Implement `score()` returning a float in [0, 1]
      4. Register in `_DEFAULT_STRATEGIES` in engine.py
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique strategy identifier used in score breakdown."""

    @property
    @abstractmethod
    def weight(self) -> float:
        """
        Contribution weight [0, 1]. All strategy weights in the engine should
        sum to 1.0 so that the total ROI score stays in [0, 1].
        """

    @abstractmethod
    def score(self, opportunity: StudyOpportunity, context: ROIContext) -> float:
        """
        Score this opportunity on this strategy's dimension.
        Returns a value in [0, 1]. Higher = more valuable from this perspective.
        """
