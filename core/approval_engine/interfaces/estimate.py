"""
ApprovalEstimate and all its output types.
These are the Approval Engine's public outputs — read-only by other systems.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from uuid import UUID


@dataclass(frozen=True)
class DomainSummary:
    """Summary of one exam subject's contribution to approval probability."""
    subject_id: UUID
    subject_name: str
    exam_weight: float            # normalised 0-1
    mastery_score: float          # 0-100
    coverage_ratio: float         # 0-1
    approval_contribution: float  # positive = helps, negative = hurts (delta to overall)
    key_issue: str                # "coverage" | "retention" | "errors" | "review_backlog" | "strong"


@dataclass(frozen=True)
class TrendAnalysis:
    """Direction and rate of approval probability change."""
    direction: str       # "improving" | "stable" | "declining"
    acceleration: str    # "accelerating" | "steady" | "decelerating"
    delta_probability: float  # change in approval_probability vs previous estimate
    explanation: str


@dataclass(frozen=True)
class ProjectedGrowth:
    """Forward projection of approval probability under current study behaviour."""
    in_7_days: float     # 0-1
    in_30_days: float    # 0-1
    in_60_days: float    # 0-1
    in_90_days: float    # 0-1
    basis: str           # "current_trajectory" | "minimal_activity" | "no_data"


@dataclass(frozen=True)
class EstimatorDetail:
    """Per-estimator breakdown included in the final estimate."""
    name: str
    raw_score: float     # 0-1 what the estimator returned
    weight: float        # this estimator's weight
    contribution: float  # raw_score × weight
    confidence: float    # 0-1 how reliable this estimate is
    explanation: str     # human-readable rationale


@dataclass
class ApprovalEstimate:
    """
    Complete approval probability estimate.
    The Approval Engine's sole output type.
    All other engines read this — nothing writes to it except the Approval Engine.
    """
    user_id: UUID
    target_exam: str
    computed_at: datetime

    # ── Core probability ──────────────────────────────────────────────
    approval_probability: float       # 0-1; probability of passing the exam
    confidence_score: float           # 0-1; reliability of this estimate

    # ── Dimensional scores (0-1 each) ────────────────────────────────
    coverage_score: float             # breadth of topics studied at minimum depth
    retention_score: float            # how well learned content is retained
    consistency_score: float          # study regularity over last 30 days

    # ── Exam score projection ─────────────────────────────────────────
    estimated_exam_score: float       # 0-100 predicted raw exam score
    estimated_cutoff_gap: float       # estimated_exam_score - cutoff (negative = failing)

    # ── Domain analysis ───────────────────────────────────────────────
    weakest_domains: list[DomainSummary]
    strongest_domains: list[DomainSummary]

    # ── Projections ───────────────────────────────────────────────────
    days_to_ready: Optional[int]      # days until approval_probability crosses 0.70
    projected_growth: ProjectedGrowth

    # ── Trend ─────────────────────────────────────────────────────────
    trend: TrendAnalysis

    # ── Explanations ─────────────────────────────────────────────────
    explanation: list[str]            # bullet points explaining the estimate
    estimator_detail: list[EstimatorDetail] = field(default_factory=list)

    # ── Helpers ───────────────────────────────────────────────────────

    @property
    def approval_pct(self) -> float:
        """Approval probability as 0-100 percentage."""
        return round(self.approval_probability * 100, 1)

    @property
    def is_passing(self) -> bool:
        return self.estimated_cutoff_gap >= 0

    @property
    def risk_level(self) -> str:
        if self.approval_probability >= 0.70:
            return "low"
        if self.approval_probability >= 0.45:
            return "medium"
        return "high"

    def as_summary_dict(self) -> dict:
        """Lightweight dict for API responses — no heavy nested objects."""
        return {
            "approval_probability": round(self.approval_probability, 4),
            "approval_pct": self.approval_pct,
            "confidence_score": round(self.confidence_score, 4),
            "estimated_exam_score": round(self.estimated_exam_score, 1),
            "estimated_cutoff_gap": round(self.estimated_cutoff_gap, 1),
            "coverage_score": round(self.coverage_score, 4),
            "retention_score": round(self.retention_score, 4),
            "consistency_score": round(self.consistency_score, 4),
            "trend_direction": self.trend.direction,
            "risk_level": self.risk_level,
            "days_to_ready": self.days_to_ready,
            "projected_30d": round(self.projected_growth.in_30_days, 4),
            "weakest": [d.subject_name for d in self.weakest_domains[:3]],
            "strongest": [d.subject_name for d in self.strongest_domains[:3]],
            "explanation": self.explanation,
        }
