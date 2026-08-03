"""
Session event types — emitted by the runtime after every significant action.

Callers consume events to drive side effects (persist state, notify UI,
trigger other engines). The runtime never persists or notifies directly.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from ..models.enums import (
    AdaptationAction, AdaptationTrigger, FatigueLevel,
    SessionEventType, SessionState, StepType,
)


@dataclass(frozen=True)
class SessionEvent:
    """Base event. All events are immutable value objects."""
    event_id: UUID
    event_type: SessionEventType
    session_id: UUID
    occurred_at: datetime

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)


@dataclass(frozen=True)
class SessionStartedEvent(SessionEvent):
    user_id: UUID
    planned_duration_mins: int
    objectives_count: int

    @staticmethod
    def create(session_id: UUID, user_id: UUID, planned_duration_mins: int, objectives_count: int) -> "SessionStartedEvent":
        return SessionStartedEvent(
            event_id=uuid4(), event_type=SessionEventType.SESSION_STARTED,
            session_id=session_id, occurred_at=SessionEvent._now(),
            user_id=user_id, planned_duration_mins=planned_duration_mins,
            objectives_count=objectives_count,
        )


@dataclass(frozen=True)
class SessionPausedEvent(SessionEvent):
    @staticmethod
    def create(session_id: UUID) -> "SessionPausedEvent":
        return SessionPausedEvent(
            event_id=uuid4(), event_type=SessionEventType.SESSION_PAUSED,
            session_id=session_id, occurred_at=SessionEvent._now(),
        )


@dataclass(frozen=True)
class SessionResumedEvent(SessionEvent):
    paused_secs: float

    @staticmethod
    def create(session_id: UUID, paused_secs: float) -> "SessionResumedEvent":
        return SessionResumedEvent(
            event_id=uuid4(), event_type=SessionEventType.SESSION_RESUMED,
            session_id=session_id, occurred_at=SessionEvent._now(),
            paused_secs=paused_secs,
        )


@dataclass(frozen=True)
class SessionCompletedEvent(SessionEvent):
    objectives_achieved: int
    objectives_total: int
    total_steps: int

    @staticmethod
    def create(session_id: UUID, objectives_achieved: int, objectives_total: int, total_steps: int) -> "SessionCompletedEvent":
        return SessionCompletedEvent(
            event_id=uuid4(), event_type=SessionEventType.SESSION_COMPLETED,
            session_id=session_id, occurred_at=SessionEvent._now(),
            objectives_achieved=objectives_achieved, objectives_total=objectives_total,
            total_steps=total_steps,
        )


@dataclass(frozen=True)
class SessionInterruptedEvent(SessionEvent):
    reason: str

    @staticmethod
    def create(session_id: UUID, reason: str) -> "SessionInterruptedEvent":
        return SessionInterruptedEvent(
            event_id=uuid4(), event_type=SessionEventType.SESSION_INTERRUPTED,
            session_id=session_id, occurred_at=SessionEvent._now(),
            reason=reason,
        )


@dataclass(frozen=True)
class StepStartedEvent(SessionEvent):
    step_type: StepType

    @staticmethod
    def create(session_id: UUID, step_type: StepType) -> "StepStartedEvent":
        return StepStartedEvent(
            event_id=uuid4(), event_type=SessionEventType.STEP_STARTED,
            session_id=session_id, occurred_at=SessionEvent._now(),
            step_type=step_type,
        )


@dataclass(frozen=True)
class StepCompletedEvent(SessionEvent):
    step_type: StepType
    accuracy: Optional[float]
    mistakes: int
    duration_secs: float

    @staticmethod
    def create(session_id: UUID, step_type: StepType, accuracy: Optional[float], mistakes: int, duration_secs: float) -> "StepCompletedEvent":
        return StepCompletedEvent(
            event_id=uuid4(), event_type=SessionEventType.STEP_COMPLETED,
            session_id=session_id, occurred_at=SessionEvent._now(),
            step_type=step_type, accuracy=accuracy,
            mistakes=mistakes, duration_secs=duration_secs,
        )


@dataclass(frozen=True)
class ObjectiveReachedEvent(SessionEvent):
    objective_id: UUID
    objective_description: str
    final_value: float
    target_value: float

    @staticmethod
    def create(session_id: UUID, objective_id: UUID, description: str, final_value: float, target_value: float) -> "ObjectiveReachedEvent":
        return ObjectiveReachedEvent(
            event_id=uuid4(), event_type=SessionEventType.OBJECTIVE_REACHED,
            session_id=session_id, occurred_at=SessionEvent._now(),
            objective_id=objective_id, objective_description=description,
            final_value=final_value, target_value=target_value,
        )


@dataclass(frozen=True)
class AdaptationTriggeredEvent(SessionEvent):
    trigger: AdaptationTrigger
    action: AdaptationAction
    reason: str
    to_step_type: Optional[StepType]

    @staticmethod
    def create(
        session_id: UUID,
        trigger: AdaptationTrigger,
        action: AdaptationAction,
        reason: str,
        to_step_type: Optional[StepType] = None,
    ) -> "AdaptationTriggeredEvent":
        return AdaptationTriggeredEvent(
            event_id=uuid4(), event_type=SessionEventType.ADAPTATION_TRIGGERED,
            session_id=session_id, occurred_at=SessionEvent._now(),
            trigger=trigger, action=action, reason=reason, to_step_type=to_step_type,
        )


@dataclass(frozen=True)
class FatigueWarningEvent(SessionEvent):
    fatigue_level: FatigueLevel
    recommendation: str

    @staticmethod
    def create(session_id: UUID, fatigue_level: FatigueLevel, recommendation: str) -> "FatigueWarningEvent":
        return FatigueWarningEvent(
            event_id=uuid4(), event_type=SessionEventType.FATIGUE_WARNING,
            session_id=session_id, occurred_at=SessionEvent._now(),
            fatigue_level=fatigue_level, recommendation=recommendation,
        )


@dataclass(frozen=True)
class BreakStartedEvent(SessionEvent):
    recommended_duration_mins: int

    @staticmethod
    def create(session_id: UUID, recommended_duration_mins: int) -> "BreakStartedEvent":
        return BreakStartedEvent(
            event_id=uuid4(), event_type=SessionEventType.BREAK_STARTED,
            session_id=session_id, occurred_at=SessionEvent._now(),
            recommended_duration_mins=recommended_duration_mins,
        )


@dataclass(frozen=True)
class MissionCompletedEvent(SessionEvent):
    @staticmethod
    def create(session_id: UUID) -> "MissionCompletedEvent":
        return MissionCompletedEvent(
            event_id=uuid4(), event_type=SessionEventType.MISSION_COMPLETED,
            session_id=session_id, occurred_at=SessionEvent._now(),
        )
