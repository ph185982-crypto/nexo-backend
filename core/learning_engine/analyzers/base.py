from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Generic, TypeVar

T = TypeVar("T")


class BaseAnalyzer(ABC, Generic[T]):
    """
    Contract for all Learning Engine analyzers.
    Each analyzer is stateless, pure, and testable without infrastructure.
    """

    @abstractmethod
    def analyze(self, *args, **kwargs) -> T:
        """Run the analysis and return a value object."""
        ...
