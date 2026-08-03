"""
ApprovalContext — everything the Approval Engine needs to estimate approval probability.

All types are projections owned by the Approval Engine.
Callers (infrastructure, routers) are responsible for mapping from external contracts
(SubjectMasterySnapshot, LearningProfile, etc.) into these types.
This keeps the Approval Engine decoupled from the internal structure of other engines.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from uuid import UUID


@dataclass
class SubjectSnapshot:
    """
    Projected from SubjectMasterySnapshot (DE) or subject_mastery table.
    Represents the user's current state in one exam subject.
    """
    subject_id: UUID
    subject_slug: str
    subject_name: str
    exam_weight: float           # absolute weight in the exam (e.g. 2.5 for PRF)
    mastery_score: float         # 0-100 (domain mastery)
    correct_rate: float          # 0-1 (recent accuracy)
    total_attempts: int          # total questions answered in this subject
    coverage_ratio: float        # 0-1 (fraction of topics ever attempted)
    last_studied: Optional[datetime]


@dataclass
class GapSnapshot:
    """
    Projected from KnowledgeGapSummary (DE) or KGE GapResult.
    Represents a knowledge gap that reduces approval probability.
    """
    subject_id: Optional[UUID]
    topic_id: Optional[UUID]
    label: str                   # human-readable name
    gap_score: float             # 0-1 (importance × mastery deficit)
    impact_score: float          # 0-1 (composite: gap + error + review pressure)
    importance: float            # 0-1 (normalised edital weight)
    explanation: str             # why this gap matters


@dataclass
class MissionRecord:
    """Projected from MissionHistoryEntry (DE)."""
    date: datetime
    completed: bool
    completion_rate: float       # 0-1
    score: Optional[float]       # accuracy 0-1 if available


@dataclass
class ReviewBacklog:
    """
    Aggregated from ReviewQueueItem list (DE) or review_cards table.
    Represents the urgency of unreviewed material.
    """
    total_due: int
    total_overdue: int
    overdue_by_subject: dict[str, int] = field(default_factory=dict)  # subject_slug → count


@dataclass
class StudyConsistency:
    """
    Aggregated study regularity metrics.
    Projected from behavior_metrics table or computed from session/mission history.
    """
    streak_days: int
    days_active_last_30: int
    avg_daily_questions: float
    avg_session_accuracy: float    # 0-1
    total_missions_last_30: int
    completed_missions_last_30: int

    @property
    def mission_completion_rate(self) -> float:
        if self.total_missions_last_30 == 0:
            return 0.0
        return self.completed_missions_last_30 / self.total_missions_last_30

    @property
    def activity_ratio(self) -> float:
        """Fraction of last 30 days with study activity."""
        return min(self.days_active_last_30 / 30.0, 1.0)


@dataclass
class ExamConfig:
    """
    Exam-specific parameters for score calculation and pass criteria.
    """
    exam_id: str                 # "PRF" | "PMGO"
    total_questions: int         # 120 for PRF, 50 for PMGO
    cutoff_score: float          # minimum raw score to pass (0-100 scale)
    scoring_method: str          # "cebraspe" (certas-erradas) | "aocp" (simple accuracy)
    blocks: int                  # number of question blocks (PRF=3, PMGO=2)
    block_cutoff: float          # minimum per-block score to pass


@dataclass
class ApprovalContext:
    """
    Complete input context for the Approval Engine.

    Callers assemble this from data across multiple engines and DB queries.
    The Approval Engine never fetches data — it only computes.
    """
    user_id: UUID
    target_exam: str
    days_until_exam: Optional[int]

    # ── Core knowledge state ──────────────────────────────────────────
    subjects: list[SubjectSnapshot]
    gaps: list[GapSnapshot]

    # ── Study behaviour ───────────────────────────────────────────────
    missions: list[MissionRecord]
    review_backlog: ReviewBacklog
    consistency: StudyConsistency

    # ── Exam configuration ────────────────────────────────────────────
    exam_config: ExamConfig

    # ── Cognitive context (from LearningProfile.as_roi_context()) ────
    # Dict projection to avoid direct coupling to Learning Engine internals.
    # Keys: learning_speed_category, retention_category, review_efficiency_score,
    #       confidence_overall, confidence_by_subject, forgetting_velocity,
    #       fatigue_threshold_minutes, preferred_format
    learning_context: dict = field(default_factory=dict)

    # ── Previous estimate for trend calculation ───────────────────────
    # Pass None when no prior estimate exists.
    previous_approval_probability: Optional[float] = None  # 0-1
    previous_computed_at: Optional[datetime] = None

    # ── Convenience properties ────────────────────────────────────────

    @property
    def max_exam_weight(self) -> float:
        if not self.subjects:
            return 1.0
        return max(s.exam_weight for s in self.subjects) or 1.0

    @property
    def total_exam_weight(self) -> float:
        return sum(s.exam_weight for s in self.subjects) or 1.0

    @property
    def avg_mastery(self) -> float:
        """Unweighted mean mastery score across all subjects."""
        if not self.subjects:
            return 0.0
        return sum(s.mastery_score for s in self.subjects) / len(self.subjects)

    @property
    def weighted_mastery(self) -> float:
        """Exam-weight-adjusted mastery score, accounting for coverage gaps."""
        if not self.subjects:
            return 0.0
        total_w = self.total_exam_weight
        return sum(
            s.mastery_score * s.exam_weight * s.coverage_ratio
            for s in self.subjects
        ) / total_w

    @property
    def exam_approaching(self) -> bool:
        return self.days_until_exam is not None and self.days_until_exam <= 60

    @property
    def retention_category(self) -> str:
        return self.learning_context.get("retention_category", "medium")

    @property
    def learning_velocity(self) -> float:
        return self.learning_context.get("learning_velocity", 0.5)

    @property
    def review_efficiency(self) -> float:
        return self.learning_context.get("review_efficiency_score", 0.5)

    @property
    def confidence_overall(self) -> float:
        return self.learning_context.get("confidence_overall", 0.5)
