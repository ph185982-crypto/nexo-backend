"""
Study Runtime — the session orchestrator for the PRF adaptive study platform.

Coordinates every minute of a study session: what step to execute next, when
to adapt, how much fatigue is accumulating, whether objectives are being met.

Everything built so far (Decision Engine, KGE, Learning Engine, Approval Engine,
Error Intelligence, Law Learning) becomes an input feed — the runtime consumes
their outputs through StepResult and decides what happens next.

Public API::

    from core.study_runtime import StudyRuntime
    from core.study_runtime import (
        StudySession, SessionObjective, StepResult, StepRecommendation,
        StudySessionReport, SessionEvent,
    )
    from core.study_runtime import (
        SessionState, StepType, ObjectiveType, FatigueLevel,
        AdaptationTrigger, AdaptationAction, SessionEventType,
    )

Usage::

    runtime = StudyRuntime()
    session = runtime.createSession(
        user_id=user_id,
        objectives=[SessionObjective.create(ObjectiveType.REACH_MASTERY, "80%", 0.80)],
        planned_duration_mins=60,
    )
    events = runtime.startSession(session.session_id)

    while runtime.canContinue(session.session_id):
        rec = runtime.nextStep(session.session_id)
        runtime.beginStep(session.session_id, rec.step_type)
        # ... caller executes step ...
        events = runtime.recordResult(session.session_id, StepResult(...))

    report = runtime.completeSession(session.session_id)
"""
from .engine import StudyRuntime

from .models.enums import (
    SessionState, StepType, ObjectiveType, AdaptationTrigger,
    AdaptationAction, FatigueLevel, SessionEventType, STEP_TYPE_TO_STATE,
)
from .models.session import (
    StudySession, SessionObjective, StepRecord, AdaptationRecord, ObjectiveProgress,
)

from .interfaces.context import (
    StepResult, StepRecommendation, FatigueEstimate, StudySessionReport,
)
from .interfaces.events import (
    SessionEvent, SessionStartedEvent, SessionPausedEvent, SessionResumedEvent,
    SessionCompletedEvent, SessionInterruptedEvent, StepStartedEvent,
    StepCompletedEvent, ObjectiveReachedEvent, AdaptationTriggeredEvent,
    FatigueWarningEvent, BreakStartedEvent, MissionCompletedEvent,
)
from .interfaces.port import StudyRuntimePort

__all__ = [
    "StudyRuntime",
    # Enums
    "SessionState", "StepType", "ObjectiveType", "AdaptationTrigger",
    "AdaptationAction", "FatigueLevel", "SessionEventType", "STEP_TYPE_TO_STATE",
    # Domain models
    "StudySession", "SessionObjective", "StepRecord", "AdaptationRecord", "ObjectiveProgress",
    # I/O types
    "StepResult", "StepRecommendation", "FatigueEstimate", "StudySessionReport",
    # Events
    "SessionEvent", "SessionStartedEvent", "SessionPausedEvent", "SessionResumedEvent",
    "SessionCompletedEvent", "SessionInterruptedEvent", "StepStartedEvent",
    "StepCompletedEvent", "ObjectiveReachedEvent", "AdaptationTriggeredEvent",
    "FatigueWarningEvent", "BreakStartedEvent", "MissionCompletedEvent",
    # Port
    "StudyRuntimePort",
]
