from __future__ import annotations
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .opportunity import StudyOpportunity


@dataclass
class ScoreComponent:
    """Single strategy's contribution to the final ROI score."""
    strategy_name: str
    raw_score: float        # 0-1, what the strategy returned
    weight: float           # strategy's configured weight
    contribution: float     # raw_score × weight

    def __str__(self) -> str:
        return f"{self.strategy_name}: {self.raw_score:.3f} × {self.weight:.2f} = {self.contribution:.3f}"


@dataclass
class ROIScore:
    """
    Composite score for a single StudyOpportunity.
    total = Σ(contribution) across all strategies; range [0, 1] since weights sum to 1.
    """
    total: float
    components: list[ScoreComponent] = field(default_factory=list)

    def breakdown(self) -> str:
        lines = [f"ROI total: {self.total:.4f}"]
        for c in sorted(self.components, key=lambda x: x.contribution, reverse=True):
            lines.append(f"  {c}")
        return "\n".join(lines)

    def top_driver(self) -> str:
        if not self.components:
            return "no strategies"
        top = max(self.components, key=lambda c: c.contribution)
        return top.strategy_name


@dataclass
class ROIResult:
    """A scored and ranked StudyOpportunity — the engine's output unit."""
    opportunity: "StudyOpportunity"
    roi_score: ROIScore
    rank: int                   # 1 = highest ROI
    fits_in_time: bool          # opportunity.estimated_minutes <= available_minutes
    explanation: str            # one-line human-readable rationale
