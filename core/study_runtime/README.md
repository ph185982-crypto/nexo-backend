# Study Runtime

Session orchestrator for the PRF adaptive study platform. Manages the full
lifecycle of a study session — from creation to completion — by coordinating
all existing domain engines through a unified observation → adaptation pipeline.

---

## Purpose

The Study Runtime answers one question every second of a session:
**"What should the student do next, and why?"**

It does not execute steps (that's the caller's job), does not call engines
directly (the caller assembles `StepResult` from engine outputs), and has no
database access. It is a pure in-memory orchestrator.

---

## Architecture

```
StudyRuntime  (multi-session manager)
└── RuntimeCoordinator  (per-session orchestrator)
    ├── SessionStateMachine   → enforces valid FSM transitions
    ├── SessionController     → lifecycle transitions (start/pause/complete)
    ├── StepExecutor          → begin/end step, counters
    ├── StepObserver          → enriches StepResult → StepRecord
    ├── ObjectiveTracker      → monitors objective progress
    ├── FatigueMonitor        → 3-factor fatigue scoring
    ├── AdaptationEngine      → evaluates adaptation rules
    ├── TimeManager           → time budget & pace
    └── ReportBuilder         → assembles StudySessionReport
```

The `StudyRuntime` class is a thin registry: it holds `dict[UUID, RuntimeCoordinator]`
and delegates every call to the coordinator for that session. One `StudyRuntime`
instance is sufficient for the entire application.

---

## Folder Structure

```
core/study_runtime/
├── __init__.py                   Public API re-exports
├── engine.py                     StudyRuntime — multi-session manager
├── smoke_test.py                 10 self-contained smoke test scenarios
│
├── models/
│   ├── enums.py                  SessionState, StepType, ObjectiveType, …
│   └── session.py                StudySession, StepRecord, AdaptationRecord, …
│
├── interfaces/
│   ├── context.py                StepResult, StepRecommendation, FatigueEstimate, StudySessionReport
│   ├── events.py                 SessionEvent + 12 typed event subclasses
│   └── port.py                   StudyRuntimePort (documentation-only Protocol)
│
├── state_machine/
│   ├── transitions.py            VALID_TRANSITIONS table
│   └── machine.py                SessionStateMachine
│
├── models/
│   └── session.py                StudySession (mutable), value objects (frozen)
│
├── controllers/
│   └── session_controller.py     Lifecycle transitions
│
├── executors/
│   └── step_executor.py          begin/end per step
│
├── observers/
│   └── step_observer.py          StepResult → StepRecord enrichment
│
├── objective_tracking/
│   └── tracker.py                ObjectiveTracker — 8 objective types
│
├── fatigue/
│   └── monitor.py                FatigueMonitor — 3-factor scoring
│
├── adaptation/
│   ├── rules.py                  Pure rule functions + AdaptationDecision
│   └── engine.py                 AdaptationEngine — safety + standard evaluation
│
├── time_management/
│   └── manager.py                TimeManager — budget, pace, recommended duration
│
├── reports/
│   └── report_builder.py         ReportBuilder → StudySessionReport
│
└── runtime/
    └── coordinator.py            RuntimeCoordinator — per-session orchestrator
```

---

## State Machine

16 states, validated transition table:

```
CREATED ──prepare──► READY ──start──► STARTING ──► RUNNING
                                                      │
        ┌─────────── ADAPTING ◄──has_adaptation───────┤
        │                                             │
        └──► RUNNING ◄──────────────────────────────►─┤
                │                                     │
          ┌─────▼──────┐                              │
          │ Step states │◄────────────────────────────┘
          │  LAW        │
          │  QUESTIONS  │
          │  REVIEW     │
          │  SUMMARY    │
          │  AUDIO      │
          │  BREAK      │
          │  ASSESSING  │
          └─────────────┘
                │
    ┌───────────┼───────────┐
    ▼           ▼           ▼
PAUSED    COMPLETED   INTERRUPTED
                           │
                        FAILED
```

Transitions are validated on every `machine.transition(target)` call.
Invalid transitions raise `ValueError`.

---

## Observation Flow

Every `recordResult()` call runs this pipeline in order:

```
StepResult (from caller)
    │
    ▼
1. StepObserver.process()
   → StepRecord (study_speed, fatigue_contribution computed)
   → appended to session.step_history
    │
    ▼
2. Mistake counters updated
   (session.consecutive_mistakes incremented or reset)
    │
    ▼
3. ObjectiveTracker.update()
   → ObjectiveProgress updated per objective
   → ObjectiveReachedEvent emitted if newly achieved
    │
    ▼
4. FatigueMonitor.estimate()
   → FatigueEstimate (3 factors: duration, accuracy_drop, reaction_rise)
   → FatigueWarningEvent if HIGH or EXHAUSTED
    │
    ▼
5. StepCompletedEvent emitted
    │
    ▼
6. AdaptationEngine.evaluate()
   → AdaptationDecision (or None)
   → AdaptationRecord stored in session.adaptation_history
   → session.pending_adaptation set
   → difficulty adjusted on session.current_difficulty
   → AdaptationTriggeredEvent emitted
    │
    ▼
7. StepExecutor.end()
   → FSM transitions RUNNING or ADAPTING
   → steps_since_break / steps_since_adaptation counters updated
    │
    ▼
8. Auto-complete check
   → if all_objectives_achieved → SessionCompletedEvent
```

---

## Adaptation Flow

The `AdaptationEngine` evaluates rules in two passes after each step:

**Safety rules** — bypass cooldown, always evaluated:
| Priority | Rule | Trigger | Action |
|----------|------|---------|--------|
| 1 | 3+ consecutive poor-accuracy steps | `CONSECUTIVE_MISTAKES` | `SWITCH_TO_LAW` |
| 1 | Session > 90 min without break | `SESSION_TOO_LONG` | `INSERT_BREAK` |
| 2 | Fatigue HIGH or EXHAUSTED | `FATIGUE_DETECTED` | `INSERT_BREAK` |

**Standard rules** — respect 2-step cooldown between adaptations:
| Priority | Rule | Trigger | Action |
|----------|------|---------|--------|
| 3 | 2+ bad-accuracy steps in last 10 | `CONCEPT_CONFUSION` | `REQUEST_ERROR_TREATMENT` |
| 3 | Net mastery loss across last 5 steps | `LOW_RETENTION` | `SWITCH_TO_REVIEW` |
| 4 | Avg confidence < 2.5/5 | `LOW_CONFIDENCE` | `SWITCH_TO_REVIEW` |
| 5 | Avg accuracy > 85% + confidence > 3.5 | `HIGH_PERFORMANCE` | `INCREASE_DIFFICULTY` |
| 5 | Avg reaction time < 8s | `FAST_ANSWERING` | `INCREASE_DIFFICULTY` |

When multiple rules fire, the lowest priority number wins.

Pending adaptations are carried on `session.pending_adaptation` and consumed
on the next `nextStep()` call.

---

## Runtime Lifecycle

### Minimal caller loop

```python
from core.study_runtime import StudyRuntime, StudySession, SessionObjective, StepResult
from core.study_runtime import ObjectiveType, StepType

runtime = StudyRuntime()

# 1. Create
session = runtime.createSession(
    user_id=user_id,
    objectives=[SessionObjective.create(ObjectiveType.REACH_MASTERY, "80% mastery", 0.80)],
    planned_duration_mins=60,
)

# 2. Start
events = runtime.startSession(session.session_id)

# 3. Step loop
while runtime.canContinue(session.session_id):
    rec = runtime.nextStep(session.session_id)  # StepRecommendation
    # → caller fetches content (questions / articles) matching rec.step_type

    runtime.beginStep(session.session_id, rec.step_type)
    # → caller executes the step (Mission Executor, etc.)

    result = StepResult(
        step_type=rec.step_type,
        duration_secs=120.0,
        accuracy=0.75,
        confidence=3.5,
        mistakes=2,
        reaction_time_secs=18.0,
        mastery_delta=0.03,
        retention_delta=0.02,
        knowledge_gain=0.04,
        completed_successfully=True,
    )
    events = runtime.recordResult(session.session_id, result)

# 4. Finish
report = runtime.completeSession(session.session_id)
# → StudySessionReport (pass to Approval Engine, Learning Engine, UI)
```

### nextStep() priority

1. **Mandatory ASSESSMENT** — time budget exhausted
2. **Mandatory BREAK** — session > 90 min without rest (FatigueMonitor)
3. **Pending adaptation** — carry forward the AdaptationRecord from last step
4. **Default** — `session.current_step_type` or `session.initial_step_type`

---

## Integration Diagram

```
Mission Executor / caller
    │
    │ StepResult (accuracy, mastery_delta, etc.)
    ▼
StudyRuntime.recordResult()
    │
    ├──► StepObserver      (uses StepResult fields directly)
    ├──► ObjectiveTracker  (uses StepResult + session.step_history)
    ├──► FatigueMonitor    (uses session.step_history, timestamps)
    ├──► AdaptationEngine  (uses session.step_history, FatigueEstimate)
    └──► ReportBuilder     (uses full session snapshot)
         │
         └──► StudySessionReport
                  │
                  ├──► Approval Engine (approval_probability update)
                  ├──► Learning Engine (LearningProfile update)
                  ├──► Decision Engine (next session planning)
                  └──► UI (progress display)
```

No engine is imported by the runtime. Integration is through `StepResult`
fields: the caller reads outputs from KGE, Learning Engine, etc., and maps
them into the flat `StepResult` structure.

---

## Extension Guide

### Add a new adaptation rule

1. Write a pure function in `adaptation/rules.py`:
   ```python
   def check_my_rule(session: StudySession) -> Optional[AdaptationDecision]:
       if <condition>:
           return AdaptationDecision(
               trigger=AdaptationTrigger.SOME_TRIGGER,
               action=AdaptationAction.SOME_ACTION,
               reason="...",
               to_step_type=StepType.REVIEW,
               priority=4,
           )
       return None
   ```
2. Add to `ALL_RULES` list in the same file.
3. If it is a safety rule (should bypass cooldown), also add it to
   `AdaptationEngine._check_safety()`.

### Add a new objective type

1. Add value to `ObjectiveType` enum in `models/enums.py`.
2. Add a branch in `ObjectiveTracker._compute_new_value()` in
   `objective_tracking/tracker.py`.
3. No other files need changes.

### Add a new session state

1. Add value to `SessionState` enum in `models/enums.py`.
2. Add valid transitions in `state_machine/transitions.py`.
3. If the state corresponds to a step type, add to `STEP_TYPE_TO_STATE`.

### Add a new StepType

1. Add value to `StepType` enum in `models/enums.py`.
2. Map it to a `SessionState` in `STEP_TYPE_TO_STATE`.
3. Add its default duration in `time_management/manager.py` (`_STEP_DURATIONS`).

---

## Smoke Tests

Run with: `python -m core.study_runtime.smoke_test`

| Scenario | What it tests |
|----------|---------------|
| A | Full session lifecycle — 5 steps, report |
| B | Objective met early → auto-complete |
| C | 3 consecutive mistakes → `CONSECUTIVE_MISTAKES` safety rule fires |
| D | Concept confusion → `SWITCH_TO_LAW` adaptation |
| E | Net mastery loss → `LOW_RETENTION` → `SWITCH_TO_REVIEW` |
| F | Session > 90 min → `SESSION_TOO_LONG` break |
| G | Time budget exhausted → nextStep returns `ASSESSMENT` |
| H | Pause / resume preserves session state |
| I | Interrupted session → partial `StudySessionReport` |
| J | All objectives achieved → auto-complete, full report structure |

All 10 pass with zero external dependencies (no DB, no AI, no network).
