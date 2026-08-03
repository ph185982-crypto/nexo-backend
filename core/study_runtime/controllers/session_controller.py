"""
SessionController — manages the StudySession lifecycle.

Responsible for:
  - Validating preconditions before lifecycle transitions
  - Delegating state transitions to the SessionStateMachine
  - Emitting lifecycle events

Does NOT: execute steps, evaluate rules, or modify session data beyond state.
"""
from __future__ import annotations

from ..interfaces.events import (
    SessionEvent,
    SessionPausedEvent,
    SessionResumedEvent,
    SessionStartedEvent,
)
from ..models.enums import SessionState
from ..models.session import StudySession
from ..state_machine.machine import SessionStateMachine


class SessionController:
    """Enforces lifecycle preconditions and delegates to the state machine."""

    def __init__(self, machine: SessionStateMachine) -> None:
        self._machine = machine

    def prepare(self, session: StudySession) -> None:
        """CREATED → READY: validate that objectives and duration are set."""
        if not session.objectives:
            raise ValueError("Cannot prepare a session with no objectives.")
        if session.planned_duration_mins <= 0:
            raise ValueError("Session duration must be positive.")
        self._machine.transition(SessionState.READY)

    def start(self, session: StudySession) -> list[SessionEvent]:
        """READY → STARTING → RUNNING."""
        self._machine.transition(SessionState.STARTING)
        self._machine.transition(SessionState.RUNNING)
        return [
            SessionStartedEvent.create(
                session_id=session.session_id,
                user_id=session.user_id,
                planned_duration_mins=session.planned_duration_mins,
                objectives_count=len(session.objectives),
            )
        ]

    def pause(self, session: StudySession) -> list[SessionEvent]:
        """RUNNING/* → PAUSED."""
        if session.state == SessionState.PAUSED:
            return []
        self._machine.transition(SessionState.PAUSED)
        return [SessionPausedEvent.create(session_id=session.session_id)]

    def resume(self, session: StudySession) -> list[SessionEvent]:
        """PAUSED → RUNNING."""
        if session.state != SessionState.PAUSED:
            return []
        paused_secs = 0.0
        if session.paused_at:
            from datetime import datetime, timezone
            paused_secs = (datetime.now(timezone.utc) - session.paused_at).total_seconds()
        self._machine.transition(SessionState.RUNNING)
        return [SessionResumedEvent.create(session_id=session.session_id, paused_secs=paused_secs)]

    def complete(self, session: StudySession) -> None:
        """→ COMPLETED."""
        if not session.is_terminal:
            self._machine.transition(SessionState.COMPLETED)

    def interrupt(self, session: StudySession) -> None:
        """→ INTERRUPTED (from any non-terminal state)."""
        if not session.is_terminal:
            self._machine.transition(SessionState.INTERRUPTED)

    def fail(self, session: StudySession, reason: str = "") -> None:
        """→ FAILED (emergency)."""
        self._machine.force_fail(reason)
