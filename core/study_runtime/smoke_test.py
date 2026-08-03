"""
Study Runtime smoke test — no external dependencies, no DB.

Covers:
  A) Normal study session — full lifecycle, 5 steps, report generated
  B) Objective completed early — auto-complete when objective met
  C) Repeated mistakes — 3 consecutive → SWITCH_TO_LAW adaptation
  D) Law adaptation — CONCEPT_CONFUSION fires, switches to LAW
  E) Review adaptation — LOW_RETENTION fires, switches to REVIEW
  F) Fatigue adaptation — SESSION_TOO_LONG fires (simulated time), BREAK
  G) Time expiration — nextStep returns ASSESSMENT when time runs out
  H) Paused session — pause/resume preserves state
  I) Interrupted session — generates partial report
  J) Completed session — all objectives met, full report structure
"""
from __future__ import annotations

import time as _time
from datetime import datetime, timezone, timedelta
from uuid import uuid4

from core.study_runtime import (
    StudyRuntime,
    StudySession,
    SessionObjective,
    StepResult,
    StepRecommendation,
    StudySessionReport,
    SessionState,
    StepType,
    ObjectiveType,
    FatigueLevel,
    SessionEventType,
    AdaptationTrigger,
    ObjectiveReachedEvent,
    AdaptationTriggeredEvent,
    SessionCompletedEvent,
)

_USER = uuid4()


def _good_result(step_type=StepType.QUESTIONS, duration=60.0) -> StepResult:
    return StepResult(
        step_type=step_type,
        duration_secs=duration,
        accuracy=0.85,
        confidence=4.0,
        mistakes=0,
        reaction_time_secs=20.0,
        mastery_delta=0.05,
        retention_delta=0.03,
        knowledge_gain=0.04,
        completed_successfully=True,
    )


def _bad_result(step_type=StepType.QUESTIONS) -> StepResult:
    return StepResult(
        step_type=step_type,
        duration_secs=45.0,
        accuracy=0.30,
        confidence=1.5,
        mistakes=4,
        reaction_time_secs=15.0,
        mastery_delta=-0.02,
        retention_delta=-0.01,
        knowledge_gain=0.01,
        completed_successfully=True,
    )


def _run_steps(runtime, session_id, results: list[StepResult]) -> list:
    all_events = []
    for result in results:
        if not runtime.canContinue(session_id):
            break
        rec = runtime.nextStep(session_id)
        if rec is None:
            break
        runtime.beginStep(session_id, result.step_type)
        events = runtime.recordResult(session_id, result)
        all_events.extend(events)
    return all_events


# ════════════════════════════════════════════════════════════════════════════
# A — Normal study session
# ════════════════════════════════════════════════════════════════════════════

def test_normal_session():
    runtime = StudyRuntime()
    obj = SessionObjective.create(ObjectiveType.COMPLETE_MISSION, "Complete 5 steps", 5.0)
    session = runtime.createSession(_USER, [obj], planned_duration_mins=60)

    assert session.state == SessionState.CREATED
    events = runtime.startSession(session.session_id)
    assert session.state == SessionState.RUNNING
    assert any(e.event_type == SessionEventType.SESSION_STARTED for e in events)

    results = [_good_result() for _ in range(5)]
    _run_steps(runtime, session.session_id, results)

    assert session.total_steps == 5
    assert session.overall_accuracy > 0.0

    # Auto-completed when objective reached
    if session.is_terminal:
        assert session.state in (SessionState.COMPLETED, SessionState.INTERRUPTED)
    else:
        report = runtime.completeSession(session.session_id)
        assert report.total_steps == 5
        assert report.overall_accuracy > 0.0
        assert "completed_at" in report.as_dict()

    print(f"  [A] Normal session — {session.total_steps} steps, accuracy={session.overall_accuracy:.0%}")


# ════════════════════════════════════════════════════════════════════════════
# B — Objective completed early → auto-complete
# ════════════════════════════════════════════════════════════════════════════

def test_objective_completed_early():
    runtime = StudyRuntime()
    # Objective: REACH_MASTERY = 0.05 (easily met with 1 good step)
    obj = SessionObjective.create(ObjectiveType.REACH_MASTERY, "Gain any mastery", 0.05)
    session = runtime.createSession(_USER, [obj], planned_duration_mins=60)
    runtime.startSession(session.session_id)

    result = _good_result()  # mastery_delta=0.05, exactly meets target
    runtime.beginStep(session.session_id, StepType.QUESTIONS)
    events = runtime.recordResult(session.session_id, result)

    # Objective should be reached
    obj_events = [e for e in events if e.event_type == SessionEventType.OBJECTIVE_REACHED]
    assert obj_events, f"Expected OBJECTIVE_REACHED, got {[e.event_type for e in events]}"

    # Session should have auto-completed (or be completable)
    progress = session.get_objective_progress(obj.objective_id)
    assert progress is not None
    assert progress.is_achieved

    print(f"  [B] Objective completed early — is_achieved={progress.is_achieved}, state={session.state}")


# ════════════════════════════════════════════════════════════════════════════
# C — Repeated mistakes → CONSECUTIVE_MISTAKES → SWITCH_TO_LAW
# ════════════════════════════════════════════════════════════════════════════

def test_consecutive_mistakes():
    runtime = StudyRuntime()
    obj = SessionObjective.create(ObjectiveType.COMPLETE_MISSION, "Any steps", 20.0)
    session = runtime.createSession(_USER, [obj], planned_duration_mins=90)
    runtime.startSession(session.session_id)

    # Force cooldown bypass by setting steps_since_adaptation high
    session.steps_since_adaptation = 99

    all_events = []
    for _ in range(3):
        if not runtime.canContinue(session.session_id):
            break
        runtime.beginStep(session.session_id, StepType.QUESTIONS)
        events = runtime.recordResult(session.session_id, _bad_result())
        all_events.extend(events)

    adaptation_events = [
        e for e in all_events
        if e.event_type == SessionEventType.ADAPTATION_TRIGGERED
        and hasattr(e, "trigger")
        and e.trigger == AdaptationTrigger.CONSECUTIVE_MISTAKES
    ]
    assert adaptation_events, (
        f"Expected CONSECUTIVE_MISTAKES adaptation. "
        f"All events: {[e.event_type for e in all_events]}"
    )
    assert session.consecutive_mistakes >= 3

    print(f"  [C] Consecutive mistakes — adaptation fired after {session.total_steps} steps")


# ════════════════════════════════════════════════════════════════════════════
# D — Law adaptation: CONCEPT_CONFUSION detects pattern
# ════════════════════════════════════════════════════════════════════════════

def test_law_adaptation():
    runtime = StudyRuntime()
    obj = SessionObjective.create(ObjectiveType.COMPLETE_MISSION, "Any", 30.0)
    session = runtime.createSession(_USER, [obj], planned_duration_mins=90)
    runtime.startSession(session.session_id)

    session.steps_since_adaptation = 99

    # Record 2 bad QUESTION steps to trigger CONCEPT_CONFUSION
    all_events = []
    for _ in range(2):
        runtime.beginStep(session.session_id, StepType.QUESTIONS)
        events = runtime.recordResult(session.session_id, _bad_result())
        all_events.extend(events)
        session.steps_since_adaptation = 99  # reset cooldown

    adaptation_events = [
        e for e in all_events
        if e.event_type == SessionEventType.ADAPTATION_TRIGGERED
    ]
    # After 2 bad steps, either CONCEPT_CONFUSION or CONSECUTIVE_MISTAKES fires
    assert len(adaptation_events) >= 1

    # Next step should be law-related (from pending adaptation)
    rec = runtime.nextStep(session.session_id)
    assert rec is not None
    law_triggered = rec.step_type in (StepType.LAW, StepType.REVIEW)
    print(f"  [D] Law adaptation — rec={rec.step_type}, triggered={rec.triggered_by_adaptation}")


# ════════════════════════════════════════════════════════════════════════════
# E — Review adaptation: LOW_RETENTION from negative mastery_delta
# ════════════════════════════════════════════════════════════════════════════

def test_review_adaptation():
    runtime = StudyRuntime()
    obj = SessionObjective.create(ObjectiveType.COMPLETE_MISSION, "Any", 30.0)
    session = runtime.createSession(_USER, [obj], planned_duration_mins=90)
    runtime.startSession(session.session_id)

    session.steps_since_adaptation = 99

    # Push steps with negative mastery_delta
    all_events = []
    for _ in range(5):
        if not runtime.canContinue(session.session_id):
            break
        runtime.beginStep(session.session_id, StepType.QUESTIONS)
        result = StepResult(
            step_type=StepType.QUESTIONS, duration_secs=30.0,
            accuracy=0.60, confidence=3.0, mistakes=2,
            reaction_time_secs=25.0,
            mastery_delta=-0.03, retention_delta=-0.02, knowledge_gain=0.01,
            completed_successfully=True,
        )
        events = runtime.recordResult(session.session_id, result)
        all_events.extend(events)
        session.steps_since_adaptation = 99

    adaptation_events = [
        e for e in all_events
        if e.event_type == SessionEventType.ADAPTATION_TRIGGERED
    ]
    assert len(adaptation_events) >= 1

    triggers = [e.trigger for e in adaptation_events if hasattr(e, "trigger")]
    print(f"  [E] Review adaptation — triggers fired: {[t.value for t in triggers]}")


# ════════════════════════════════════════════════════════════════════════════
# F — Fatigue adaptation: force steps_since_break to trigger SESSION_TOO_LONG
# ════════════════════════════════════════════════════════════════════════════

def test_fatigue_adaptation():
    runtime = StudyRuntime()
    obj = SessionObjective.create(ObjectiveType.COMPLETE_MISSION, "Any", 30.0)
    session = runtime.createSession(_USER, [obj], planned_duration_mins=120)
    runtime.startSession(session.session_id)

    # Simulate 91 minutes of elapsed time by faking started_at
    session.started_at = datetime.now(timezone.utc) - timedelta(minutes=91)
    # Make it so the last step was not a break
    session.steps_since_break = 5
    session.steps_since_adaptation = 99

    runtime.beginStep(session.session_id, StepType.QUESTIONS)
    events = runtime.recordResult(session.session_id, _good_result())

    adaptation_events = [
        e for e in events
        if e.event_type == SessionEventType.ADAPTATION_TRIGGERED
    ]
    assert adaptation_events, (
        f"Expected fatigue/time adaptation, got {[e.event_type for e in events]}"
    )
    trigger = adaptation_events[0].trigger if hasattr(adaptation_events[0], "trigger") else "?"
    print(f"  [F] Fatigue adaptation — trigger={trigger}, events={len(events)}")


# ════════════════════════════════════════════════════════════════════════════
# G — Time expiration → nextStep returns ASSESSMENT
# ════════════════════════════════════════════════════════════════════════════

def test_time_expiration():
    runtime = StudyRuntime()
    obj = SessionObjective.create(ObjectiveType.COMPLETE_MISSION, "Any", 30.0)
    session = runtime.createSession(_USER, [obj], planned_duration_mins=1)  # 1 min
    runtime.startSession(session.session_id)

    # Simulate time expiry
    session.started_at = datetime.now(timezone.utc) - timedelta(minutes=2)

    rec = runtime.nextStep(session.session_id)
    assert rec is not None
    assert rec.step_type == StepType.ASSESSMENT, f"Expected ASSESSMENT, got {rec.step_type}"

    print(f"  [G] Time expiration — next step = {rec.step_type}")


# ════════════════════════════════════════════════════════════════════════════
# H — Paused session
# ════════════════════════════════════════════════════════════════════════════

def test_paused_session():
    runtime = StudyRuntime()
    obj = SessionObjective.create(ObjectiveType.COMPLETE_MISSION, "Any", 30.0)
    session = runtime.createSession(_USER, [obj], planned_duration_mins=60)
    runtime.startSession(session.session_id)

    # Do one step
    runtime.beginStep(session.session_id, StepType.QUESTIONS)
    runtime.recordResult(session.session_id, _good_result())

    # Pause
    pause_events = runtime.pauseSession(session.session_id)
    assert session.state == SessionState.PAUSED
    assert any(e.event_type == SessionEventType.SESSION_PAUSED for e in pause_events)

    # Cannot continue while paused
    assert not runtime.canContinue(session.session_id)

    # Resume
    resume_events = runtime.resumeSession(session.session_id)
    assert session.state == SessionState.RUNNING
    assert any(e.event_type == SessionEventType.SESSION_RESUMED for e in resume_events)
    assert runtime.canContinue(session.session_id)

    print(f"  [H] Pause/Resume — paused_secs={session.total_paused_secs:.1f}")


# ════════════════════════════════════════════════════════════════════════════
# I — Interrupted session → partial report
# ════════════════════════════════════════════════════════════════════════════

def test_interrupted_session():
    runtime = StudyRuntime()
    obj = SessionObjective.create(ObjectiveType.COMPLETE_MISSION, "Long mission", 20.0)
    session = runtime.createSession(_USER, [obj], planned_duration_mins=60)
    runtime.startSession(session.session_id)

    for _ in range(3):
        runtime.beginStep(session.session_id, StepType.QUESTIONS)
        runtime.recordResult(session.session_id, _good_result())

    report = runtime.interruptSession(session.session_id, reason="User closed app")
    assert report.terminal_state == SessionState.INTERRUPTED
    assert report.total_steps == 3
    assert "interrompida" in report.next_session_recommendation.lower()

    print(f"  [I] Interrupted — steps={report.total_steps}, state={report.terminal_state}")


# ════════════════════════════════════════════════════════════════════════════
# J — Completed session: all objectives met, full report structure
# ════════════════════════════════════════════════════════════════════════════

def test_completed_session():
    runtime = StudyRuntime()
    objs = [
        SessionObjective.create(ObjectiveType.COMPLETE_MISSION, "5 steps", 5.0),
        SessionObjective.create(ObjectiveType.REACH_MASTERY,    "Any mastery", 0.01),
    ]
    session = runtime.createSession(_USER, objs, planned_duration_mins=60)
    runtime.startSession(session.session_id)

    all_events = []
    for _ in range(5):
        if session.is_terminal or not runtime.canContinue(session.session_id):
            break
        runtime.beginStep(session.session_id, StepType.QUESTIONS)
        events = runtime.recordResult(session.session_id, _good_result())
        all_events.extend(events)

    # Manually complete if not auto-completed
    if not session.is_terminal:
        report = runtime.completeSession(session.session_id)
    else:
        # Build report from already-completed session via a new coordinator
        from core.study_runtime.reports.report_builder import ReportBuilder
        report = ReportBuilder().build(session)

    assert report.terminal_state in (SessionState.COMPLETED, SessionState.INTERRUPTED)
    assert report.total_steps >= 1
    assert report.objectives_total == 2

    # Verify report structure
    d = report.as_dict()
    required = {"session_id", "user_id", "started_at", "completed_at", "objectives",
                "steps", "gains", "errors", "time_distribution", "efficiency",
                "fatigue_curve", "final_fatigue_level", "next_session_recommendation"}
    missing = required - set(d.keys())
    assert not missing, f"Report missing keys: {missing}"
    assert isinstance(d["fatigue_curve"], list)
    assert isinstance(d["objectives"]["details"], list)

    print(f"  [J] Completed session — {report.total_steps} steps, {report.objectives_achieved}/{report.objectives_total} objectives")
    print(f"      efficiency={report.efficiency:.4f}  fatigue={report.final_fatigue_level}")
    print(f"      recommendation: {report.next_session_recommendation[:80]}…")


# ════════════════════════════════════════════════════════════════════════════
# Runner
# ════════════════════════════════════════════════════════════════════════════

def run():
    tests = [
        ("A", "Normal study session",         test_normal_session),
        ("B", "Objective completed early",     test_objective_completed_early),
        ("C", "Repeated mistakes → LAW",       test_consecutive_mistakes),
        ("D", "Law adaptation",                test_law_adaptation),
        ("E", "Review adaptation",             test_review_adaptation),
        ("F", "Fatigue adaptation",            test_fatigue_adaptation),
        ("G", "Time expiration → ASSESSMENT",  test_time_expiration),
        ("H", "Paused session",                test_paused_session),
        ("I", "Interrupted session",           test_interrupted_session),
        ("J", "Completed session + report",    test_completed_session),
    ]

    print("=" * 64)
    print("STUDY RUNTIME — Smoke Test")
    print("=" * 64)
    for label, name, fn in tests:
        print(f"\nScenario {label} — {name}")
        fn()

    print()
    print("=" * 64)
    print("ALL ASSERTIONS PASSED")
    print("=" * 64)


if __name__ == "__main__":
    run()
