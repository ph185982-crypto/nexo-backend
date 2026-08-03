"""
StepExecutor — processes each step's lifecycle within the runtime.

Responsibilities:
  - Signal the state machine when a step begins (RUNNING → step state)
  - Signal the state machine when a step ends (step state → RUNNING/ADAPTING)
  - Track step-level counters (steps_since_break, steps_since_adaptation)

Does NOT: execute step content, call external engines, apply adaptation logic.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from ..interfaces.events import BreakStartedEvent, SessionEvent, StepStartedEvent
from ..models.enums import STEP_TYPE_TO_STATE, SessionState, StepType
from ..models.session import StudySession
from ..state_machine.machine import SessionStateMachine


class StepExecutor:
    """
    Manages the begin/end lifecycle of a single step within the session FSM.
    Called by RuntimeCoordinator — one begin() per step, one end() per result.
    """

    def __init__(self, machine: SessionStateMachine) -> None:
        self._machine = machine
        self._step_started_at: Optional[datetime] = None

    def begin(
        self,
        session: StudySession,
        step_type: StepType,
    ) -> list[SessionEvent]:
        """
        Transition FSM into the active step state and record start time.
        Returns events to emit (StepStartedEvent, BreakStartedEvent if BREAK).
        """
        target_state = STEP_TYPE_TO_STATE.get(step_type, SessionState.RUNNING)
        if self._machine.can_transition_to(target_state):
            self._machine.transition(target_state)
        session.current_step_type = step_type
        self._step_started_at = datetime.now(timezone.utc)

        events: list[SessionEvent] = [
            StepStartedEvent.create(session_id=session.session_id, step_type=step_type)
        ]
        if step_type == StepType.BREAK:
            events.append(
                BreakStartedEvent.create(session_id=session.session_id, recommended_duration_mins=5)
            )
            session.steps_since_break = 0
        return events

    def end(self, session: StudySession, transition_to_adapting: bool = False) -> None:
        """
        Transition FSM back to RUNNING (or ADAPTING if adaptation is pending).
        Updates step-since-break and step-since-adaptation counters.
        """
        target = SessionState.ADAPTING if transition_to_adapting else SessionState.RUNNING

        if self._machine.can_transition_to(target):
            self._machine.transition(target)
        elif self._machine.can_transition_to(SessionState.RUNNING):
            self._machine.transition(SessionState.RUNNING)

        session.current_step_type = None
        if not transition_to_adapting:
            session.steps_since_break += 1
            session.steps_since_adaptation += 1
        else:
            session.steps_since_adaptation = 0

    @property
    def step_started_at(self) -> Optional[datetime]:
        return self._step_started_at
