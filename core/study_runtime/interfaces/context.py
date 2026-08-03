"""
Input and output types for the Study Runtime public API.

StepResult — caller provides this after executing each step.
StepRecommendation — runtime returns this to tell the caller what to do next.
StudySessionReport — final output when a session completes or is interrupted.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from uuid import UUID

from ..models.enums import (
    AdaptationAction,
    AdaptationTrigger,
    FatigueLevel,
    SessionState,
    StepType,
)


@dataclass(frozen=True)
class StepResult:
    """
    Caller provides this after executing a step (via Mission Executor, etc.).

    The runtime does not execute steps — it processes results.
    """
    step_type: StepType
    duration_secs: float
    accuracy: Optional[float]           # 0-1; None for non-question steps
    confidence: Optional[float]         # 1-5 Likert; None if not reported
    mistakes: int
    reaction_time_secs: Optional[float] # avg response time; None if not applicable
    mastery_delta: float                # change in mastery (from Learning Engine)
    retention_delta: float              # change in retention (from Learning Engine)
    knowledge_gain: float               # knowledge graph gain (from KGE)
    completed_successfully: bool
    subject_id: Optional[UUID] = None
    topic_id: Optional[UUID] = None
    article_id: Optional[UUID] = None
    metadata: dict = field(default_factory=dict)


@dataclass(frozen=True)
class StepRecommendation:
    """
    What the runtime recommends as the next step.

    The caller uses step_type to fetch appropriate content (question list,
    article, etc.) from Mission Executor or other engines.
    """
    step_type: StepType
    reason: str
    priority: int                          # 1-10
    difficulty: float                      # 0-1 (suggested difficulty for next step)
    estimated_duration_mins: int
    triggered_by_adaptation: bool
    adaptation_trigger: Optional[AdaptationTrigger]
    adaptation_action: Optional[AdaptationAction]
    subject_id: Optional[UUID] = None
    topic_id: Optional[UUID] = None
    article_id: Optional[UUID] = None


@dataclass(frozen=True)
class FatigueEstimate:
    """Snapshot of the current fatigue assessment."""
    level: FatigueLevel
    score: float               # 0-1 (higher = more fatigued)
    attention_drop: float      # 0-1 estimate of attention degradation
    performance_drop: float    # 0-1 estimate of performance degradation
    session_quality: float     # 0-1 (inverse of fatigue)
    learning_efficiency: float # 0-1 (how much of study is actually retained)


@dataclass
class StudySessionReport:
    """
    Final diagnostic report generated when a session ends (completed or interrupted).

    Consumed by:
      - Approval Engine (for next approval estimate update)
      - Learning Engine (for LearningProfile update)
      - Decision Engine (for next session planning)
      - UI (for progress display)
    """
    # Identity
    session_id: UUID
    user_id: UUID

    # Time
    started_at: Optional[datetime]
    completed_at: datetime
    planned_duration_mins: int
    actual_duration_mins: float

    # Objectives
    objectives_achieved: int
    objectives_total: int
    objectives_completion_pct: float
    objectives_details: list[dict]   # [{id, description, achieved, final_value, target}]

    # Steps
    total_steps: int
    total_questions_answered: int
    overall_accuracy: float
    overall_confidence: float

    # Learning gains
    knowledge_gain: float
    mastery_gain: float
    retention_gain: float
    confidence_gain: float

    # Errors
    total_mistakes: int
    total_adaptations: int

    # Distribution
    time_distribution: dict[str, float]   # step_type_name → minutes
    efficiency: float                      # 0-1

    # Fatigue
    fatigue_curve: list[float]             # fatigue score at end of each step
    final_fatigue_level: FatigueLevel

    # Recommendation
    next_session_recommendation: str

    # Terminal state
    terminal_state: SessionState

    def as_dict(self) -> dict:
        return {
            "session_id": str(self.session_id),
            "user_id": str(self.user_id),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat(),
            "planned_duration_mins": self.planned_duration_mins,
            "actual_duration_mins": round(self.actual_duration_mins, 2),
            "objectives": {
                "achieved": self.objectives_achieved,
                "total": self.objectives_total,
                "completion_pct": round(self.objectives_completion_pct, 2),
                "details": self.objectives_details,
            },
            "steps": {
                "total": self.total_steps,
                "questions_answered": self.total_questions_answered,
                "overall_accuracy": round(self.overall_accuracy, 4),
                "overall_confidence": round(self.overall_confidence, 4) if self.overall_confidence else None,
            },
            "gains": {
                "knowledge": round(self.knowledge_gain, 4),
                "mastery": round(self.mastery_gain, 4),
                "retention": round(self.retention_gain, 4),
                "confidence": round(self.confidence_gain, 4),
            },
            "errors": {
                "total_mistakes": self.total_mistakes,
                "total_adaptations": self.total_adaptations,
            },
            "time_distribution": {k: round(v, 2) for k, v in self.time_distribution.items()},
            "efficiency": round(self.efficiency, 4),
            "fatigue_curve": [round(f, 3) for f in self.fatigue_curve],
            "final_fatigue_level": self.final_fatigue_level,
            "next_session_recommendation": self.next_session_recommendation,
            "terminal_state": self.terminal_state,
        }
