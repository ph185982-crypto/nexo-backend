"""
Approval Engine — single source of truth for approval probability estimation.

Public API:

    from core.approval_engine import ApprovalEngine, ApprovalContext
    from core.approval_engine import (
        ApprovalEstimate, SubjectSnapshot, GapSnapshot,
        MissionRecord, ReviewBacklog, StudyConsistency, ExamConfig,
        DomainSummary, TrendAnalysis, ProjectedGrowth, EstimatorDetail,
    )

Usage:

    engine = ApprovalEngine()
    context = ApprovalContext(...)
    estimate = engine.estimate(context)
    print(estimate.approval_pct)       # e.g. 67.3
    print(estimate.risk_level)         # "low" | "medium" | "high"
    summary = estimate.as_summary_dict()

The engine is stateless: instantiate once, call estimate() as many times as needed.
Callers own data fetching, caching, and persistence.
"""
from .engine import ApprovalEngine
from .interfaces.context import (
    ApprovalContext,
    SubjectSnapshot,
    GapSnapshot,
    MissionRecord,
    ReviewBacklog,
    StudyConsistency,
    ExamConfig,
)
from .interfaces.estimate import (
    ApprovalEstimate,
    DomainSummary,
    TrendAnalysis,
    ProjectedGrowth,
    EstimatorDetail,
)

__all__ = [
    "ApprovalEngine",
    "ApprovalContext",
    "SubjectSnapshot",
    "GapSnapshot",
    "MissionRecord",
    "ReviewBacklog",
    "StudyConsistency",
    "ExamConfig",
    "ApprovalEstimate",
    "DomainSummary",
    "TrendAnalysis",
    "ProjectedGrowth",
    "EstimatorDetail",
]
