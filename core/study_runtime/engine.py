"""
StudyRuntime — public entry point for the Study Runtime domain.

This class manages the lifecycle of all active study sessions. One instance
is sufficient for the entire application (instantiate as a singleton).

Public API::

    runtime = StudyRuntime()

    # Create & start
    session = runtime.createSession(user_id, objectives, duration_mins=60)
    events  = runtime.startSession(session.session_id)

    # Step loop (caller drives)
    while runtime.canContinue(session.session_id):
        recommendation = runtime.nextStep(session.session_id)
        # Caller executes the step using Mission Executor / engines...
        result = StepResult(step_type=recommendation.step_type, ...)
        begin_events = runtime.beginStep(session.session_id, recommendation.step_type)
        events = runtime.recordResult(session.session_id, result)

    # Finish
    report = runtime.completeSession(session.session_id)

Does NOT:
  - Execute steps (caller responsibility)
  - Call external engines directly (caller assembles StepResult from engine outputs)
  - Access any database
  - Modify any other engine's state
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from .interfaces.context import StepRecommendation, StepResult, StudySessionReport
from .interfaces.events import SessionEvent
from .models.enums import StepType
from .models.session import SessionObjective, StudySession
from .runtime.coordinator import RuntimeCoordinator


class StudyRuntime:
    """
    Stateful runtime manager. Holds in-memory session registry.

    Thread safety: not guaranteed — external locking required for concurrent use.
    Persistence: callers must persist session snapshots via StudyRuntimePort.
    """

    def __init__(self) -> None:
        self._sessions: dict[UUID, RuntimeCoordinator] = {}

    # ── Session creation ──────────────────────────────────────────────────────

    def createSession(
        self,
        user_id: UUID,
        objectives: list[SessionObjective],
        planned_duration_mins: int,
        initial_step_type: StepType = StepType.QUESTIONS,
    ) -> StudySession:
        """
        Create a new study session and register it.

        Returns the StudySession (CREATED state). Call startSession() to begin.
        """
        session = StudySession(
            user_id=user_id,
            objectives=objectives,
            planned_duration_mins=planned_duration_mins,
            initial_step_type=initial_step_type,
        )
        coordinator = RuntimeCoordinator(session)
        self._sessions[session.session_id] = coordinator
        return session

    def loadSession(self, session: StudySession) -> None:
        """
        Re-register a session that was persisted and restored by the caller.
        Allows resumption after a process restart.
        """
        coordinator = RuntimeCoordinator(session)
        self._sessions[session.session_id] = coordinator

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def startSession(self, session_id: UUID) -> list[SessionEvent]:
        """CREATED → READY → STARTING → RUNNING. Returns SessionStartedEvent."""
        return self._get(session_id).start()

    def pauseSession(self, session_id: UUID) -> list[SessionEvent]:
        """RUNNING → PAUSED."""
        return self._get(session_id).pause()

    def resumeSession(self, session_id: UUID) -> list[SessionEvent]:
        """PAUSED → RUNNING."""
        return self._get(session_id).resume()

    def completeSession(self, session_id: UUID) -> StudySessionReport:
        """→ COMPLETED. Builds and returns the final StudySessionReport."""
        report = self._get(session_id).complete()
        self._sessions.pop(session_id, None)
        return report

    def interruptSession(self, session_id: UUID, reason: str = "") -> StudySessionReport:
        """→ INTERRUPTED. Builds and returns a partial StudySessionReport."""
        report = self._get(session_id).interrupt(reason)
        self._sessions.pop(session_id, None)
        return report

    # ── Step loop ─────────────────────────────────────────────────────────────

    def nextStep(self, session_id: UUID) -> Optional[StepRecommendation]:
        """
        Return the next step recommendation.

        Evaluates: pending adaptations, fatigue threshold, time remaining.
        Returns None if the session has terminated.
        """
        return self._get(session_id).nextStep()

    def beginStep(self, session_id: UUID, step_type: StepType) -> list[SessionEvent]:
        """
        Signal that the caller is about to execute a step.

        Transitions the FSM into the active step state. Call before fetching
        step content from Mission Executor.
        """
        return self._get(session_id).beginStep(step_type)

    def recordResult(self, session_id: UUID, result: StepResult) -> list[SessionEvent]:
        """
        Process a completed step result through the observation → adaptation pipeline.

        Returns all events emitted (StepCompletedEvent, ObjectiveReachedEvent,
        AdaptationTriggeredEvent, FatigueWarningEvent, SessionCompletedEvent if auto-completed).
        """
        return self._get(session_id).recordResult(result)

    # ── Queries ───────────────────────────────────────────────────────────────

    def getSession(self, session_id: UUID) -> StudySession:
        """Return the live session object (read-only by convention)."""
        return self._get(session_id).session

    def canContinue(self, session_id: UUID) -> bool:
        """True when the session can accept another step."""
        if session_id not in self._sessions:
            return False
        return self._get(session_id).canContinue()

    def isTerminated(self, session_id: UUID) -> bool:
        """True when the session has reached a terminal state."""
        if session_id not in self._sessions:
            return True
        return self._get(session_id).isTerminated()

    def activeSessions(self) -> list[UUID]:
        """Return IDs of all currently registered sessions."""
        return list(self._sessions.keys())

    # ── Private ───────────────────────────────────────────────────────────────

    def _get(self, session_id: UUID) -> RuntimeCoordinator:
        coordinator = self._sessions.get(session_id)
        if coordinator is None:
            raise KeyError(f"No active session: {session_id}")
        return coordinator
