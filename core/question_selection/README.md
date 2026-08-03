# Question Selection

Single authority for choosing the next question in a study session.

No other module may decide which question to present. This domain only
**selects** — it never evaluates answers, calculates mastery, updates
statistics, or touches a database.

---

## Purpose

Given a snapshot of available questions and the current session context
(fatigue, mastery, knowledge gaps, remaining time, active objective…),
return the single best question for the student to answer next, together
with a scored explanation of why.

The selection is deterministic and pure: the same context always produces
the same result. All I/O is the caller's responsibility.

---

## Public API

```python
from core.question_selection import (
    QuestionSelectionEngine,
    QuestionSnapshot,
    QuestionSelectionContext,
    DifficultyLevel,
    SelectionMode,
)

engine = QuestionSelectionEngine()

result = engine.select(
    QuestionSelectionContext(
        user_id=user_id,
        available_questions=snapshots,       # tuple[QuestionSnapshot, ...]
        knowledge_gaps=gaps,                 # from Knowledge Gap Engine
        subject_mastery=mastery,             # from Learning Engine, str(UUID) → float
        fatigue_level="FRESH",               # from Study Runtime
        difficulty_target=DifficultyLevel.MEDIUM,
        remaining_time_secs=1800,
    )
)

# result.question_id → fetch content from DB
# result.selection_reason → why this question
# result.score_breakdown → per-scorer raw scores
```

`result` is `None` only when the available pool is entirely empty —
this should not happen in practice (the caller ensures at least one
question is available).

---

## Selection Pipeline

```
caller provides QuestionSelectionContext
         │
         ▼
┌─────────────────────┐
│  CandidatePoolBuilder│  QuestionSnapshot → QuestionCandidate (mutable)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   CandidateFilter   │  four hard-exit passes (each with a fallback)
│  ① session dedup    │  remove already-answered this session
│  ② 24 h dedup       │  remove recent repeats when mastery ≥ 0.70
│  ③ article diversity│  limit over-represented articles (pool ≥ 10)
│  ④ time budget      │  remove questions exceeding remaining time
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   CandidateRanker   │  10 scorers × weights → composite_score
│   score all         │  Σ (weight × score) per candidate
│   sort DESC         │  primary_reason = highest weighted contribution
└──────────┬──────────┘
           │
           ▼
   QuestionSelectionResult
   (best candidate + top-3 alternatives)
```

### Filter fallback principle

Each filter pass checks whether the filtered list is empty. If it would
be, the filter is skipped and the unfiltered list is passed through.
This ensures the engine always returns *something* rather than `None`.

---

## Scoring Model

Ten independent scorers each return a value in `[0, 1]`. The composite
is a weighted sum that sums to 1.00:

| Scorer | Weight | Signal |
|---|---|---|
| `KnowledgeGapScorer` | 0.20 | Gap in declared knowledge areas (tag overlap) |
| `ExamWeightScorer` | 0.15 | How often this question appears in real exams |
| `RecurrenceScorer` | 0.15 | Historical error rate + reinforcement alignment |
| `RetentionScorer` | 0.15 | Ebbinghaus forgetting curve (τ = 7 days) |
| `DifficultyScorer` | 0.10 | Distance from `difficulty_target` |
| `LearningGainScorer` | 0.10 | Expected mastery lift (ROI) |
| `ObjectiveScorer` | 0.08 | Alignment with active session objective |
| `CoverageScorer` | 0.04 | Article diversity (recency penalty) |
| `RecentExposureScorer` | 0.02 | Freshness relative to session/recent history |
| `TimeCostScorer` | 0.01 | Time efficiency against remaining budget |

### Score semantics

- **1.0** — perfect match for this signal  
- **0.5** — neutral / no data  
- **0.0** — worst case (or question filtered pre-scoring)

Scorer failures are silently clamped to 0.0 so a broken scorer
degrades gracefully without crashing the session.

### Mode overrides

| Mode | Override |
|---|---|
| `REINFORCEMENT` | `RecurrenceScorer` returns 1.0 for concept/article match |
| `REVIEW` | `KnowledgeGapScorer` returns 1.0 for backlog questions |
| `EXAM_SIMULATION` | `ExamWeightScorer` multiplies by 1.5 (capped at 1.0) |
| `OBJECTIVE` | `ObjectiveScorer` multiplies by 1.2 (capped at 1.0) |

---

## Folder Structure

```
core/question_selection/
├── engine.py                  # QuestionSelectionEngine (public entry point)
├── interfaces/
│   ├── context.py             # QuestionSnapshot, QuestionSelectionContext
│   ├── output.py              # QuestionSelectionResult
│   └── port.py                # QuestionSelectionPort (documentation-as-contract)
├── models/
│   ├── enums.py               # DifficultyLevel, SelectionMode, SelectionReason
│   └── candidate.py           # QuestionCandidate (mutable, internal)
├── pipeline/
│   ├── builder.py             # CandidatePoolBuilder
│   ├── filter.py              # CandidateFilter (4 passes)
│   └── ranker.py              # CandidateRanker (weighted scoring)
├── scorers/
│   ├── base.py                # Scorer protocol
│   ├── knowledge_gap.py
│   ├── exam_weight.py
│   ├── recurrence.py
│   ├── retention.py
│   ├── difficulty.py
│   ├── learning_gain.py
│   ├── coverage.py
│   ├── objective.py
│   ├── recent_exposure.py
│   ├── time_cost.py
│   └── __init__.py            # default_scorers()
└── smoke_test.py              # 9 scenario tests (no DB, no external deps)
```

---

## Integration with Study Runtime

Study Runtime is the **only** legitimate caller of `QuestionSelectionEngine`.

```
Study Runtime
  │  provides: fatigue_level, difficulty_target (already adjusted for fatigue),
  │            session_questions, recent_questions, subject_mastery
  │
  ▼
QuestionSelectionEngine.select(context)
  │
  ▼
result.question_id → Study Runtime fetches question content from DB
```

Study Runtime adjusts `difficulty_target` for fatigue **before** passing
it to the engine. The engine never reads raw fatigue — it only sees the
already-adjusted target. This maintains clean separation of concerns:
Study Runtime handles cognitive state; Question Selection handles question
scoring.

---

## Extension Points

### Custom scoring weights (A/B testing)

```python
from core.question_selection import (
    QuestionSelectionEngine,
    KnowledgeGapScorer, ExamWeightScorer,
)

engine = QuestionSelectionEngine(
    scorers_with_weights=[
        (KnowledgeGapScorer(),  0.40),
        (ExamWeightScorer(),    0.60),
    ]
)
```

### New scorer

Implement the `Scorer` protocol from `core.question_selection.scorers.base`:

```python
class MyScorer:
    name = "my_scorer"

    def score(
        self,
        candidate: QuestionCandidate,
        context: QuestionSelectionContext,
    ) -> float:
        ...  # return value in [0, 1]
```

Pass it via `scorers_with_weights` to `QuestionSelectionEngine`.

---

## Smoke Tests

Run without any external dependencies:

```
python -m core.question_selection.smoke_test
```

| # | Scenario | Key assertion |
|---|---|---|
| 1 | `new_student` | Non-empty pool → valid result |
| 2 | `advanced_student` | Hard unseen wins over easy seen at mastery=0.90 |
| 3 | `high_fatigue` | EASY question wins when `difficulty_target=EASY` |
| 4 | `reinforcement_mode` | Concept-matching question wins |
| 5 | `review_mode` | Backlog question wins |
| 6 | `objective_mode` | Subject+topic+article match wins |
| 7 | `low_remaining_time` | Questions exceeding budget are hard-filtered out |
| 8 | `high_mastery` | Recently answered questions filtered; unseen selected |
| 9 | `exam_simulation` | Highest `exam_frequency` wins; `exam_weight ≥ 0.90` |
