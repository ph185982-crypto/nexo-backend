"""
RuntimeCoordinator — per-session orchestrator.

One instance per active session. Holds all runtime components and wires them
together into the observation → adaptation → objective-tracking pipeline.

Instantiated by StudyRuntime for each new session. Never constructed directly
by callers.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4
from typing import Optional

from ..adaptation.engine import AdaptationEngine
from ..adaptation.rules import AdaptationDecision
from ..controllers.session_controller import SessionController
from ..executors.step_executor import StepExecutor
from ..fatigue.monitor import FatigueMonitor
from ..interfaces.context import FatigueEstimate, StepRecommendation, StepResult, StudySessionReport
from ..interfaces.events import (
    AdaptationTriggeredEvent,
    FatigueWarningEvent,
    SessionCompletedEvent,
    SessionEvent,
    SessionInterruptedEvent,
    StepCompletedEvent,
)
from ..models.enums import (
    AdaptationAction,
    FatigueLevel,
    SessionState,
    StepType,
)
from ..models.session import AdaptationRecord, StudySession
from ..objective_tracking.tracker import ObjectiveTracker
from ..observers.step_observer import StepObserver
from ..reports.report_builder import ReportBuilder
from ..state_machine.machine import SessionStateMachine
from ..time_management.manager import TimeManager


class RuntimeCoordinator:
    """
    Orchestrates the complete observation → adaptation cycle for one session.

    Pipeline per recorded step result:
      1. StepObserver.process()         → StepRecord
      2. ObjectiveTracker.update()      → ObjectiveReachedEvent*
      3. FatigueMonitor.estimate()      → FatigueEstimate
      4. AdaptationEngine.evaluate()    → AdaptationDecision?
      5. StepExecutor.end()             → state transition
      6. Emit events

    Pipeline per nextStep() call:
      1. Check time expiry → ASSESSMENT if expired
      2. Check mandatory break (FatigueMonitor)
      3. Apply pending adaptation
      4. Return default step type
    """

    def __init__(self, session: StudySession) -> None:
        self.session = session

        self._machine    = SessionStateMachine(session)
        self._controller = SessionController(self._machine)
        self._executor   = StepExecutor(self._machine)
        self._observer   = StepObserver()
        self._tracker    = ObjectiveTracker()
        self._fatigue    = FatigueMonitor()
        self._adaptation = AdaptationEngine()
        self._time       = TimeManager()
        self._reporter   = ReportBuilder()

        self._last_fatigue: FatigueEstimate = FatigueEstimate(
            level=FatigueLevel.FRESH, score=0.0,
            attention_drop=0.0, performance_drop=0.0,
            session_quality=1.0, learning_efficiency=1.0,
        )

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self) -> list[SessionEvent]:
        self._controller.prepare(self.session)
        events = self._controller.start(self.session)
        return events

    def pause(self) -> list[SessionEvent]:
        return self._controller.pause(self.session)

    def resume(self) -> list[SessionEvent]:
        return self._controller.resume(self.session)

    def complete(self) -> StudySessionReport:
        self._controller.complete(self.session)
        return self._reporter.build(self.session)

    def interrupt(self, reason: str = "") -> StudySessionReport:
        self._controller.interrupt(self.session)
        return self._reporter.build(self.session)

    # ── Step loop ─────────────────────────────────────────────────────────────

    def nextStep(self) -> Optional[StepRecommendation]:
        """
        Return the next step recommendation for the caller.

        Priority:
          1. Mandatory break (fatigue/time)
          2. Pending adaptation from last step
          3. Default step type (initial_step_type)
        """
        if self.session.is_terminal:
            return None

        if self._time.is_time_expired(self.session):
            return self._make_recommendation(
                step_type=StepType.ASSESSMENT,
                reason="Tempo de sessão esgotado — avaliação final.",
                triggered=False,
            )

        if self._fatigue.should_force_break(self.session):
            return self._make_recommendation(
                step_type=StepType.BREAK,
                reason="Limite de 90 minutos atingido — pausa obrigatória.",
                triggered=False,
            )

        if self.session.pending_adaptation:
            decision = self.session.pending_adaptation
            self.session.pending_adaptation = None
            step = decision.to_step_type or self.session.initial_step_type
            return self._make_recommendation(
                step_type=step,
                reason=decision.reason,
                triggered=True,
                trigger=decision.trigger,
                action=decision.action,
                difficulty_delta=decision.difficulty_delta,
            )

        # Default
        step = self.session.current_step_type or self.session.initial_step_type
        if step is None:
            step = StepType.QUESTIONS

        return self._make_recommendation(
            step_type=step,
            reason="Continuação normal da sessão.",
            triggered=False,
        )

    def beginStep(self, step_type: StepType) -> list[SessionEvent]:
        """Signal that the caller is about to execute a step of this type."""
        return self._executor.begin(self.session, step_type)

    def recordResult(self, result: StepResult) -> list[SessionEvent]:
        """
        Process a completed step result through the full observation pipeline.
        Returns all events emitted during processing.
        """
        events: list[SessionEvent] = []
        now = datetime.now(timezone.utc)
        started_at = self._executor.step_started_at or now
        was_adapted = self.session.pending_adaptation is not None

        # 1. Observe
        record = self._observer.process(result, started_at, now, was_adapted)
        self.session.step_history.append(record)

        # 2. Update mistake counters
        if result.accuracy is not None and result.accuracy < 0.50 and result.mistakes > 0:
            self.session.consecutive_mistakes += 1
        else:
            self.session.consecutive_mistakes = 0

        # 3. Track objectives
        obj_events = self._tracker.update(self.session, result)
        events.extend(obj_events)

        # 4. Estimate fatigue
        self._last_fatigue = self._fatigue.estimate(self.session)
        self.session.fatigue_level = self._last_fatigue.level

        # Emit fatigue warning at HIGH level
        if self._last_fatigue.level in (FatigueLevel.HIGH, FatigueLevel.EXHAUSTED):
            events.append(
                FatigueWarningEvent.create(
                    session_id=self.session.session_id,
                    fatigue_level=self._last_fatigue.level,
                    recommendation="Considere uma pausa para recuperação.",
                )
            )

        # 5. Emit step completed
        events.append(
            StepCompletedEvent.create(
                session_id=self.session.session_id,
                step_type=result.step_type,
                accuracy=result.accuracy,
                mistakes=result.mistakes,
                duration_secs=result.duration_secs,
            )
        )

        # 6. Evaluate adaptation rules
        decision = self._adaptation.evaluate(self.session, self._last_fatigue)
        has_adaptation = decision is not None

        if decision:
            rec = AdaptationRecord(
                adaptation_id=uuid4(),
                triggered_at=now,
                trigger=decision.trigger,
                action=decision.action,
                reason=decision.reason,
                from_step_type=result.step_type,
                to_step_type=decision.to_step_type,
                difficulty_delta=decision.difficulty_delta,
            )
            self.session.adaptation_history.append(rec)
            self.session.pending_adaptation = rec

            # Apply difficulty delta
            if decision.difficulty_delta != 0.0:
                self.session.current_difficulty = min(
                    max(self.session.current_difficulty + decision.difficulty_delta, 0.0),
                    1.0,
                )

            events.append(
                AdaptationTriggeredEvent.create(
                    session_id=self.session.session_id,
                    trigger=decision.trigger,
                    action=decision.action,
                    reason=decision.reason,
                    to_step_type=decision.to_step_type,
                )
            )

        # 7. Transition FSM back
        self._executor.end(self.session, transition_to_adapting=has_adaptation)

        # 8. Auto-complete if all objectives achieved
        if self.session.all_objectives_achieved and not self.session.is_terminal:
            self._controller.complete(self.session)
            events.append(
                SessionCompletedEvent.create(
                    session_id=self.session.session_id,
                    objectives_achieved=self.session.objectives_achieved,
                    objectives_total=len(self.session.objectives),
                    total_steps=self.session.total_steps,
                )
            )

        return events

    def canContinue(self) -> bool:
        return self.session.can_continue

    def isTerminated(self) -> bool:
        return self.session.is_terminal

    # ── Private helpers ───────────────────────────────────────────────────────

    def _make_recommendation(
        self,
        step_type: StepType,
        reason: str,
        triggered: bool,
        trigger=None,
        action=None,
        difficulty_delta: float = 0.0,
    ) -> StepRecommendation:
        from ..time_management.manager import _STEP_DURATIONS
        estimated_dur = self._time.recommended_step_duration(self.session, step_type)

        priority = 5
        if triggered:
            priority = 8

        return StepRecommendation(
            step_type=step_type,
            reason=reason,
            priority=priority,
            difficulty=round(self.session.current_difficulty, 3),
            estimated_duration_mins=estimated_dur,
            triggered_by_adaptation=triggered,
            adaptation_trigger=trigger,
            adaptation_action=action,
        )
