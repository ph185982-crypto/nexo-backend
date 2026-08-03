"""
ApprovalEngine — entry point for all approval probability computation.

Responsibilities:
  - Orchestrate the three services: estimator, trend analyzer, projection calculator.
  - Produce a complete ApprovalEstimate from an ApprovalContext.
  - Nothing else.

The engine is stateless and pure: given the same context, it always
returns the same estimate. Callers own caching and data fetching.
"""
from __future__ import annotations

from .interfaces.context import ApprovalContext
from .interfaces.estimate import ApprovalEstimate
from .services.approval_estimator import ApprovalEstimatorService
from .services.trend_analyzer import TrendAnalyzerService
from .services.projection_calculator import ProjectionCalculatorService


class ApprovalEngine:
    """
    Stateless approval probability estimator.

    Usage:
        engine = ApprovalEngine()
        estimate = engine.estimate(context)
    """

    def __init__(self) -> None:
        self._estimator = ApprovalEstimatorService()
        self._trend = TrendAnalyzerService()
        self._projection = ProjectionCalculatorService()

    def estimate(self, context: ApprovalContext) -> ApprovalEstimate:
        """
        Produce a full ApprovalEstimate from the provided context.

        This method is synchronous because all computation is CPU-bound
        and does not require I/O. Callers that need async can wrap
        in asyncio.to_thread() if needed.
        """
        # Step 1: run all estimators and assemble the composite estimate
        result = self._estimator.estimate(context)

        # Step 2: compute trend vs previous snapshot
        trend = self._trend.analyze(context, result.approval_probability)
        result.trend = trend

        # Step 3: compute forward projections
        # Derive composite from estimator_detail to feed projection calculator
        total_w = sum(d.weight for d in result.estimator_detail) or 1.0
        composite = sum(d.raw_score * d.weight for d in result.estimator_detail) / total_w

        projected = self._projection.calculate(
            context,
            current_composite=composite,
            current_probability=result.approval_probability,
        )
        result.projected_growth = projected

        return result
