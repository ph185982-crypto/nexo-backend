"""
Domain model for a study session.

StudySession is the single mutable object that evolves through the runtime
lifecycle. All other value objects in this module are frozen (immutable).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from .enums import (
    AdaptationAction,
    AdaptationTrigger,
    FatigueLevel,
    ObjectiveType,
    SessionState,
    StepType,
)


# ── Immutable value objects ──────────────────────────────────────────────────

@dataclass(frozen=True)
class SessionObjective:
    """A learning objective that this session aims to achieve."""
    objective_id: UUID
    objective_type: ObjectiveType
    description: str
    target_value: float          # e.g. 0.85 for "reach 85% mastery"
    subject_id: Optional[UUID] = None
    topic_id: Optional[UUID] = None
    article_id: Optional[UUID] = None

    @staticmethod
    def create(
        objective_type: ObjectiveType,
        description: str,
        target_value: float,
        subject_id: Optional[UUID] = None,
        topic_id: Optional[UUID] = None,
        article_id: Optional[UUID] = None,
    ) -> "SessionObjective":
        return SessionObjective(
            objective_id=uuid4(),
            objective_type=objective_type,
            description=description,
            target_value=target_value,
            subject_id=subject_id,
            topic_id=topic_id,
            article_id=article_id,
        )


@dataclass(frozen=True)
class StepRecord:
    """Immutable record of one completed step, stored in session history."""
    step_id: UUID
    step_type: StepType
    started_at: datetime
    completed_at: datetime
    duration_secs: float
    accuracy: Optional[float]         # None for non-question steps
    confidence: Optional[float]       # None if not reported
    mistakes: int
    reaction_time_secs: Optional[float]
    study_speed: float                # normalized 0-1
    mastery_delta: float
    retention_delta: float
    knowledge_gain: float
    fatigue_contribution: float       # how much this step added to fatigue (0-1)
    was_adapted: bool                 # this step resulted from an adaptation


@dataclass(frozen=True)
class AdaptationRecord:
    """Immutable record of one adaptation decision."""
    adaptation_id: UUID
    triggered_at: datetime
    trigger: AdaptationTrigger
    action: AdaptationAction
    reason: str
    from_step_type: Optional[StepType]
    to_step_type: Optional[StepType]
    difficulty_delta: float = 0.0


@dataclass(frozen=True)
class ObjectiveProgress:
    """Current state of one objective within the session."""
    objective_id: UUID
    current_value: float
    is_achieved: bool
    achieved_at: Optional[datetime]


# ── Mutable session model ────────────────────────────────────────────────────

class StudySession:
    """
    The live, mutable representation of an active study session.

    Mutated only by RuntimeCoordinator through its component pipeline.
    Callers receive a reference but should treat it as read-only —
    mutation belongs to the runtime.
    """

    def __init__(
        self,
        user_id: UUID,
        objectives: list[SessionObjective],
        planned_duration_mins: int,
        initial_step_type: StepType = StepType.QUESTIONS,
    ) -> None:
        self.session_id: UUID = uuid4()
        self.user_id: UUID = user_id
        self.objectives: list[SessionObjective] = list(objectives)
        self.planned_duration_mins: int = planned_duration_mins
        self.initial_step_type: StepType = initial_step_type

        # State machine
        self.state: SessionState = SessionState.CREATED
        self.current_step_type: Optional[StepType] = None

        # Timestamps
        self.created_at: datetime = datetime.now(timezone.utc)
        self.started_at: Optional[datetime] = None
        self.paused_at: Optional[datetime] = None
        self.completed_at: Optional[datetime] = None
        self.total_paused_secs: float = 0.0

        # History
        self.step_history: list[StepRecord] = []
        self.adaptation_history: list[AdaptationRecord] = []

        # Runtime state (mutable counters)
        self.fatigue_level: FatigueLevel = FatigueLevel.FRESH
        self.current_difficulty: float = 0.50
        self.pending_adaptation: Optional[AdaptationRecord] = None
        self.consecutive_mistakes: int = 0
        self.steps_since_break: int = 0
        self.steps_since_adaptation: int = 99   # starts ready to adapt

        # Objective progress tracking
        self._objective_progress: dict[UUID, ObjectiveProgress] = {
            obj.objective_id: ObjectiveProgress(
                objective_id=obj.objective_id,
                current_value=0.0,
                is_achieved=False,
                achieved_at=None,
            )
            for obj in objectives
        }

    # ── Computed properties ──────────────────────────────────────────────────

    @property
    def active_duration_secs(self) -> float:
        if not self.started_at:
            return 0.0
        now = datetime.now(timezone.utc)
        end = self.completed_at or self.paused_at or now
        elapsed = (end - self.started_at).total_seconds()
        return max(0.0, elapsed - self.total_paused_secs)

    @property
    def active_duration_mins(self) -> float:
        return self.active_duration_secs / 60.0

    @property
    def remaining_mins(self) -> float:
        return max(0.0, self.planned_duration_mins - self.active_duration_mins)

    @property
    def total_steps(self) -> int:
        return len(self.step_history)

    @property
    def total_mistakes(self) -> int:
        return sum(r.mistakes for r in self.step_history)

    @property
    def overall_accuracy(self) -> float:
        question_steps = [
            r for r in self.step_history
            if r.accuracy is not None
        ]
        if not question_steps:
            return 0.0
        return sum(r.accuracy for r in question_steps) / len(question_steps)

    @property
    def cumulative_knowledge_gain(self) -> float:
        return sum(r.knowledge_gain for r in self.step_history)

    @property
    def cumulative_mastery_gain(self) -> float:
        return sum(r.mastery_delta for r in self.step_history)

    @property
    def cumulative_retention_gain(self) -> float:
        return sum(r.retention_delta for r in self.step_history)

    @property
    def objectives_achieved(self) -> int:
        return sum(1 for p in self._objective_progress.values() if p.is_achieved)

    @property
    def all_objectives_achieved(self) -> bool:
        return bool(self.objectives) and self.objectives_achieved == len(self.objectives)

    @property
    def is_terminal(self) -> bool:
        return self.state in (
            SessionState.COMPLETED,
            SessionState.INTERRUPTED,
            SessionState.FAILED,
        )

    @property
    def can_continue(self) -> bool:
        if self.is_terminal:
            return False
        if self.state == SessionState.PAUSED:
            return False
        return self.remaining_mins > 0

    # ── Objective progress accessors ─────────────────────────────────────────

    def get_objective_progress(self, objective_id: UUID) -> Optional[ObjectiveProgress]:
        return self._objective_progress.get(objective_id)

    def update_objective_progress(self, progress: ObjectiveProgress) -> None:
        self._objective_progress[progress.objective_id] = progress

    def all_progress(self) -> list[ObjectiveProgress]:
        return list(self._objective_progress.values())

    def as_snapshot(self) -> dict:
        return {
            "session_id": str(self.session_id),
            "user_id": str(self.user_id),
            "state": self.state,
            "fatigue_level": self.fatigue_level,
            "active_duration_mins": round(self.active_duration_mins, 2),
            "remaining_mins": round(self.remaining_mins, 2),
            "total_steps": self.total_steps,
            "overall_accuracy": round(self.overall_accuracy, 4),
            "cumulative_knowledge_gain": round(self.cumulative_knowledge_gain, 4),
            "objectives_achieved": self.objectives_achieved,
            "objectives_total": len(self.objectives),
            "adaptations": len(self.adaptation_history),
        }
