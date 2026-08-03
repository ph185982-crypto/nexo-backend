"""
SessionStateMachine — enforces valid transitions in the Study Runtime FSM.

All state changes go through this machine. It raises ValueError on invalid
transitions, making illegal session states impossible to reach by accident.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from ..models.enums import SessionState
from ..models.session import StudySession
from .transitions import validate


class SessionStateMachine:
    """
    Enforces FSM semantics on a StudySession.

    The machine holds a reference to the session and mutates session.state
    only when the transition is valid.
    """

    def __init__(self, session: StudySession) -> None:
        self._session = session

    @property
    def current(self) -> SessionState:
        return self._session.state

    @property
    def is_terminal(self) -> bool:
        return self._session.is_terminal

    def can_transition_to(self, target: SessionState) -> bool:
        from .transitions import is_valid
        return is_valid(self._session.state, target)

    def transition(
        self,
        target: SessionState,
        *,
        timestamp: Optional[datetime] = None,
    ) -> SessionState:
        """
        Perform a validated state transition.

        Mutates session.state and records timestamps for lifecycle states.
        Returns the new state.
        """
        validate(self._session.state, target)
        previous = self._session.state
        self._session.state = target
        ts = timestamp or datetime.now(timezone.utc)

        # Record lifecycle timestamps
        if target == SessionState.RUNNING and previous == SessionState.STARTING:
            self._session.started_at = ts

        elif target == SessionState.PAUSED:
            self._session.paused_at = ts

        elif target == SessionState.RUNNING and previous == SessionState.PAUSED:
            if self._session.paused_at:
                paused_duration = (ts - self._session.paused_at).total_seconds()
                self._session.total_paused_secs += paused_duration
                self._session.paused_at = None

        elif target in (SessionState.COMPLETED, SessionState.INTERRUPTED, SessionState.FAILED):
            self._session.completed_at = ts

        return target

    def force_fail(self, reason: str = "") -> None:
        """Emergency transition to FAILED from any non-terminal state."""
        if not self._session.is_terminal:
            self._session.state = SessionState.FAILED
            self._session.completed_at = datetime.now(timezone.utc)
