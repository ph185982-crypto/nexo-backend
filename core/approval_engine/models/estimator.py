"""
BaseEstimator contract and EstimatorResult intermediate type.
All estimators return EstimatorResult — the composite service aggregates them.
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from ..interfaces.context import ApprovalContext


@dataclass
class EstimatorResult:
    """Intermediate output of a single estimator."""
    name: str
    score: float                    # 0-1 contribution score
    weight: float                   # this estimator's configured weight
    confidence: float               # 0-1 reliability of this estimate
    explanation: str                # human-readable rationale
    detail: dict = field(default_factory=dict)  # structured breakdown for debugging

    @property
    def contribution(self) -> float:
        return self.score * self.weight


class BaseEstimator(ABC):
    """
    Contract for all Approval Engine estimators.

    Each estimator:
    - Has a fixed name and weight.
    - Is stateless and pure — no I/O, no side effects.
    - Returns an EstimatorResult in [0, 1] score range.
    - Includes a human-readable explanation of its verdict.

    Weights across all estimators must sum to 1.0.
    """

    @property
    @abstractmethod
    def name(self) -> str: ...

    @property
    @abstractmethod
    def weight(self) -> float: ...

    @abstractmethod
    def estimate(self, context: ApprovalContext) -> EstimatorResult: ...
