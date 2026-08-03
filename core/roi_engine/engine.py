from __future__ import annotations
from typing import Optional

from .interfaces.context import ROIContext
from .interfaces.opportunity import StudyOpportunity
from .interfaces.score import ROIResult, ROIScore, ScoreComponent
from .interfaces.strategy import ScoringStrategy
from .models.generator import OpportunityGenerator
from .strategies.confidence import ConfidenceScoringStrategy
from .strategies.exam_weight import ExamWeightScoringStrategy
from .strategies.knowledge_gap import KnowledgeGapScoringStrategy
from .strategies.recent_mistake import RecentMistakeScoringStrategy
from .strategies.retention import RetentionScoringStrategy
from .strategies.time_efficiency import TimeEfficiencyScoringStrategy

_DEFAULT_STRATEGIES: list[ScoringStrategy] = [
    KnowledgeGapScoringStrategy(),      # weight=0.25
    ExamWeightScoringStrategy(),         # weight=0.20
    RetentionScoringStrategy(),          # weight=0.20
    RecentMistakeScoringStrategy(),      # weight=0.15
    TimeEfficiencyScoringStrategy(),     # weight=0.10
    ConfidenceScoringStrategy(),         # weight=0.10
    # weights sum = 1.00 ✓
]


class ROIEngine:
    """
    Answers one question: "What study action produces the highest approval gain
    RIGHT NOW?"

    Inputs  → ROIContext (all relevant user state)
    Process → generate opportunities → score each across all strategies → rank
    Output  → list[ROIResult] sorted highest ROI first

    The engine has no side effects. It never persists anything. It never talks to
    the database. It never creates missions or updates mastery.
    """

    def __init__(self, strategies: Optional[list[ScoringStrategy]] = None) -> None:
        self._strategies = strategies if strategies is not None else _DEFAULT_STRATEGIES
        self._generator = OpportunityGenerator()
        self._validate_weights()

    def rank(
        self,
        context: ROIContext,
        limit: int = 10,
        include_unfitting: bool = False,
    ) -> list[ROIResult]:
        """
        Generate and rank all study opportunities.

        Args:
            context: Full user state at decision time.
            limit: Maximum number of results to return.
            include_unfitting: If False (default), opportunities that exceed
                available_minutes are pushed to the end, not excluded entirely.

        Returns:
            list[ROIResult] ordered by roi_score.total descending, rank starting at 1.
        """
        opportunities = self._generator.generate(context)
        scored = [self._score(op, context) for op in opportunities]
        scored.sort(key=lambda r: (r.fits_in_time, r.roi_score.total), reverse=True)

        if not include_unfitting:
            fitting = [r for r in scored if r.fits_in_time]
            unfitting = [r for r in scored if not r.fits_in_time]
            scored = fitting + unfitting

        # Assign rank and cap
        results = []
        for i, result in enumerate(scored[:limit], start=1):
            results.append(ROIResult(
                opportunity=result.opportunity,
                roi_score=result.roi_score,
                rank=i,
                fits_in_time=result.fits_in_time,
                explanation=result.explanation,
            ))
        return results

    # ------------------------------------------------------------------

    def _score(self, opportunity: StudyOpportunity, context: ROIContext) -> ROIResult:
        components: list[ScoreComponent] = []
        for strategy in self._strategies:
            raw = strategy.score(opportunity, context)
            raw = max(0.0, min(raw, 1.0))   # clamp
            contribution = raw * strategy.weight
            components.append(ScoreComponent(
                strategy_name=strategy.name,
                raw_score=raw,
                weight=strategy.weight,
                contribution=contribution,
            ))

        total = sum(c.contribution for c in components)
        roi_score = ROIScore(total=round(total, 6), components=components)
        fits = opportunity.fits_in(context.available_minutes)
        explanation = self._explain(opportunity, roi_score, context)

        return ROIResult(
            opportunity=opportunity,
            roi_score=roi_score,
            rank=0,             # assigned after sorting
            fits_in_time=fits,
            explanation=explanation,
        )

    @staticmethod
    def _explain(
        opportunity: StudyOpportunity, roi_score: ROIScore, context: ROIContext
    ) -> str:
        driver = roi_score.top_driver()
        gain_pct = f"{opportunity.expected_gain * 100:.1f}%"
        time_str = f"{opportunity.estimated_minutes}min"
        return (
            f"{opportunity.label} — ganho esperado {gain_pct} em {time_str} "
            f"[driver: {driver}, roi={roi_score.total:.3f}]"
        )

    def _validate_weights(self) -> None:
        total = sum(s.weight for s in self._strategies)
        if abs(total - 1.0) > 0.01:
            import warnings
            warnings.warn(
                f"ROIEngine strategy weights sum to {total:.3f}, expected 1.0. "
                "Scores will not be in [0, 1].",
                stacklevel=2,
            )
