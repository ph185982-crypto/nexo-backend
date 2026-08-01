# Decision Engine

Single orchestrator of all study decisions. Nothing else decides what the user studies.

## Directory layout

```
core/decision_engine/
├── engine.py               # DecisionEngine — public entry point
├── interfaces/
│   ├── enums.py            # StepType, DecisionReason, MissionPriority
│   ├── inputs.py           # DecisionInput + supporting snapshots
│   ├── outputs.py          # MissionPlan, MissionStep
│   ├── metrics.py          # MissionMetrics, StepMetrics, MissionResult
│   └── execution.py        # MissionExecution, StepExecution
├── models/
│   └── context.py          # MissionContext, ContextBuilder
├── strategies/
│   ├── base.py             # BaseStrategy, StepRecommendation
│   ├── spaced_review.py    # score 1000+ — overdue SM-2 cards
│   ├── recent_errors.py    # score 900  — questions answered wrong recently
│   ├── weak_subject.py     # score 700-900 — low mastery × high weight
│   ├── retention_drop.py   # score 700  — correct_rate < 65%
│   ├── low_coverage.py     # score 600  — < 30% topics attempted
│   ├── simulation_ready.py # score 300  — exam approaching + mastery ≥ 60%
│   └── short_time.py       # score 500  — < 15 min available → law text
├── builder/
│   └── builder.py          # MissionBuilder + DecisionEngineRepositoryPort
├── executor/
│   └── executor.py         # MissionExecutor (stateless, no I/O)
└── analyzer/
    └── analyzer.py         # MissionAnalyzer (pure computation)
```

## How it works

```
DecisionInput
    │
    ▼
ContextBuilder.build()          enriches raw input into MissionContext
    │
    ▼
Strategy.is_applicable()        each strategy votes
Strategy.recommend()            returns StepRecommendations with priority_score
    │
    ▼ (sorted by score, fitted to available_minutes)
MissionPlan (steps, trace, approval_gain)
```

### Strategy priority ladder

| Score range | Strategy             | Trigger                        |
|-------------|----------------------|--------------------------------|
| 1000+       | SpacedReview         | Any overdue SM-2 card          |
| 900+        | RecentErrors         | Wrong answers in last 7 days   |
| 700–900     | WeakSubject          | Mastery < 60% × exam weight    |
| 700+        | RetentionDrop        | correct_rate < 65% (≥10 tries) |
| 600+        | LowCoverage          | < 30% topics attempted         |
| 500         | ShortTime            | Available < 15 min             |
| 300+        | SimulationReady      | Exam ≤ 30 days + avg mastery ≥ 60 |

A BREAK step is automatically inserted when accumulated content exceeds 45 min.

## Adding a strategy

1. Create `strategies/my_strategy.py` implementing `BaseStrategy`
2. Add to `strategies/__init__.py`
3. Add instance to `_DEFAULT_STRATEGIES` in `engine.py` (or inject via constructor)

## Dependency injection

`DecisionEngine` has no DB dependency. Supply data through `DecisionInput`.

`MissionBuilder` depends on `DecisionEngineRepositoryPort` (a Protocol).
The concrete adapter (in the infrastructure layer) fetches from Supabase/asyncpg
and returns the typed dataclasses the engine expects. Swap adapters freely for
testing (in-memory), staging (read replica), or different exam systems.

## Testing

```python
from core.decision_engine import DecisionEngine, DecisionInput

engine = DecisionEngine()
plan = engine.decide(DecisionInput(...))
assert plan.steps[0].step_type == StepType.REVIEW  # overdue cards always first
```

No fixtures, no DB, no async required to unit-test the engine.
