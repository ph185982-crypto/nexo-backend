# Learning Engine

## Purpose

The Learning Engine continuously observes study behaviour and transforms raw history into **cognitive intelligence**.

It answers one question: **How does this user learn?**

It never makes decisions, never generates content, and never updates any persistent state directly. Its only output is a `LearningProfile` — a structured cognitive model that other engines consume as read-only context.

---

## Architecture

```
core/learning_engine/
├── engine.py                   ← Public entry point (LearningEngine)
├── interfaces/
│   ├── observations.py         ← Raw port input types (AttemptRecord, SessionRecord, …)
│   ├── profile.py              ← LearningProfile + all value objects
│   └── port.py                 ← LearningRepositoryPort (Protocol)
├── analyzers/
│   ├── base.py                 ← BaseAnalyzer contract
│   ├── learning_speed.py       ← LearningSpeedAnalyzer
│   ├── retention.py            ← RetentionAnalyzer
│   ├── confidence.py           ← ConfidenceAnalyzer
│   ├── fatigue.py              ← FatigueAnalyzer
│   ├── confusion.py            ← ConfusionAnalyzer
│   ├── stability.py            ← KnowledgeStabilityAnalyzer
│   ├── format_preference.py    ← PreferredFormatAnalyzer
│   ├── sequence_preference.py  ← PreferredSequenceAnalyzer
│   └── review_efficiency.py    ← ReviewEfficiencyAnalyzer
├── estimators/
│   ├── retention.py            ← RetentionEstimator
│   ├── forgetting.py           ← ForgettingEstimator
│   ├── confidence.py           ← ConfidenceEstimator
│   └── mastery.py              ← MasteryEstimator
└── services/
    └── profile_builder.py      ← LearningProfileBuilder (orchestrator)
```

**Dependency direction:** `engine` → `services` → `analyzers/estimators` → `interfaces`. No layer imports from a layer above it. No imports from other engines (DE, KGE, ROI).

---

## Data Flow

```
Infrastructure (asyncpg)
        │
        ▼ LearningRepositoryPort
   LearningEngine
        │
        ├── asyncio.gather() → 6 parallel queries
        │       ├── get_attempt_history()
        │       ├── get_session_history()
        │       ├── get_review_cards()
        │       ├── get_error_history()
        │       ├── get_mastery_records()
        │       └── get_behavior_metrics()
        │
        ▼ LearningProfileBuilder.build()
        │
        ├── Phase 1: Analyzers (pure, parallel-safe)
        │       ├── LearningSpeedAnalyzer
        │       ├── RetentionAnalyzer
        │       ├── ConfidenceAnalyzer
        │       ├── FatigueAnalyzer
        │       ├── ConfusionAnalyzer
        │       ├── KnowledgeStabilityAnalyzer
        │       ├── PreferredFormatAnalyzer
        │       ├── PreferredSequenceAnalyzer
        │       └── ReviewEfficiencyAnalyzer
        │
        ├── Phase 2: Estimators
        │       ├── ForgettingEstimator   → forgetting_velocity per subject
        │       ├── RetentionEstimator    → drop dates per subject
        │       ├── ConfidenceEstimator   → projected accuracy per subject
        │       └── MasteryEstimator      → days-to-target per subject
        │
        └── LearningProfile (cached 24h in memory)
                │
                ▼
       ROI Engine / Decision Engine / Mission Builder
       (read-only, via as_roi_context() / as_decision_context())
```

---

## Responsibilities

| Component | Responsibility |
|-----------|---------------|
| `LearningEngine` | Lifecycle, caching, concurrent data fetch |
| `LearningProfileBuilder` | Orchestration of all analyzers and estimators |
| `LearningSpeedAnalyzer` | Response time, throughput, accuracy trend velocity |
| `RetentionAnalyzer` | SM-2 ease factor, interval, review accuracy, lapse rate |
| `ConfidenceAnalyzer` | Per-subject accuracy + self-rating calibration |
| `FatigueAnalyzer` | Session-level accuracy early vs late; threshold detection |
| `ConfusionAnalyzer` | Topic co-occurrence errors; confused pairs |
| `KnowledgeStabilityAnalyzer` | Variance of accuracy across time windows per subject |
| `PreferredFormatAnalyzer` | Session mode → accuracy correlation |
| `PreferredSequenceAnalyzer` | Hour-of-day accuracy; optimal session length |
| `ReviewEfficiencyAnalyzer` | Reviews-per-mastery-point; lapse rate; streak |
| `RetentionEstimator` | Ebbinghaus projection: when retention drops below 70% |
| `ForgettingEstimator` | Forgetting velocity: 1/stability per subject per day |
| `ConfidenceEstimator` | Linear trend projection of accuracy at next session |
| `MasteryEstimator` | Days to 70% mastery given current velocity |

---

## LearningProfile

```python
LearningProfile
├── learning_speed: LearningSpeed
│       ├── avg_time_per_question_secs
│       ├── questions_per_session
│       ├── learning_velocity          # 0-1 accuracy improvement rate
│       └── category                   # "fast" | "medium" | "slow"
│
├── retention_strength: RetentionStrength
│       ├── avg_ease_factor            # SM-2 EF (1.3-3.5+)
│       ├── avg_interval_days
│       ├── review_retention_rate      # correct/total reviews
│       ├── stability_score            # 0-1 composite
│       └── category                   # "strong" | "medium" | "weak"
│
├── confidence: ConfidenceIndex
│       ├── overall                    # 0-1
│       ├── by_subject                 # subject_id → 0-1
│       └── calibration_score          # self-rating vs actual alignment
│
├── knowledge_stability: KnowledgeStability
│       ├── stability_score            # 0-1
│       ├── volatile_subjects          # subject_ids with high variance
│       └── stable_subjects
│
├── preferred_format: FormatPreference
│       ├── primary                    # "questions" | "review" | "simulation" | …
│       ├── secondary
│       └── performance_by_format      # format → accuracy
│
├── preferred_sequence: SequencePreference
│       ├── best_hour                  # 0-23
│       ├── best_session_length_mins
│       └── energy_pattern             # "morning_peak" | "evening_peak" | "consistent"
│
├── review_efficiency: ReviewEfficiency
│       ├── reviews_per_mastery_point
│       ├── lapse_rate
│       ├── streak_avg
│       └── efficiency_score           # 0-1
│
├── fatigue_threshold: FatigueThreshold
│       ├── threshold_minutes
│       ├── accuracy_at_start
│       ├── accuracy_at_end
│       └── drop_rate                  # accuracy loss per 30 min
│
├── confusion_matrix: ConceptConfusionMatrix
│       ├── confused_pairs             # (topic_a, topic_b, score)
│       └── most_confused              # topic_ids
│
├── topic_mastery_confidence           # topic_id → projected accuracy
├── forgetting_velocity                # subject_id → rate/day
├── mastery_projections                # subject_id → days to 70%
└── cognitive_summary                  # one-line description
```

---

## Integration

Other engines receive cognitive context via two lightweight dict methods:

```python
# For ROI Engine
ctx_dict = profile.as_roi_context()
# Keys: learning_speed_category, preferred_format, fatigue_threshold_minutes,
#       best_study_hour, retention_category, review_efficiency_score,
#       confidence_overall, confidence_by_subject, forgetting_velocity

# For Decision Engine / Mission Builder
ctx_dict = profile.as_decision_context()
# Keys: fatigue_threshold_minutes, preferred_session_length_mins, best_study_hour,
#       energy_pattern, retention_strength, learning_velocity,
#       review_efficiency, confused_topics
```

**Rule:** Other engines receive dict projections, never the `LearningProfile` object directly. This prevents coupling to the profile's internal structure and lets the profile evolve independently.

---

## Data Sources (no new tables required)

| Table | Data used |
|-------|-----------|
| `question_attempts` | is_correct, time_spent_secs, confidence, created_at |
| `study_sessions` | mode, energy_at_start/end, duration_mins, questions_correct |
| `review_cards` | ease_factor, interval_days, lapsed, streak, total_reviews/correct |
| `error_notebook` | times_repeated, topic_id, error_type |
| `subject_mastery` | mastery_level, accuracy, total_attempts |
| `user_behavior_metrics` | best_study_hour, avg_session_minutes, fatigue_threshold_mins |

All data read from existing tables. No migrations required.

---

## Caching

- Profile cached in-memory per `(user_id, target_exam)`.
- Default TTL: 24 hours.
- Invalidated automatically on `observe_attempt()` and `observe_session()`.
- Call `engine.evict(user_id, exam)` to force recomputation.
- All 6 data fetches run concurrently via `asyncio.gather()`.

---

## Adding a New Analyzer

1. Create `core/learning_engine/analyzers/my_analyzer.py`.
2. Implement `analyze(*args) -> MyValueObject`.
3. Add `MyValueObject` to `interfaces/profile.py` and `LearningProfile`.
4. Add analyzer call to `services/profile_builder.py` Phase 1.
5. Export from `analyzers/__init__.py`.
6. No changes needed in `engine.py`.

---

## Engineering Report

### Architecture

- **Clean Architecture**: dependency direction is strictly inward. No layer imports from a layer above.
- **SOLID**: Each analyzer has a single responsibility. `LearningEngine` depends on abstractions (port Protocol), not concrete implementations.
- **No circular dependencies**: LE imports nothing from DE, KGE, or ROI Engine.
- **Zero new tables**: all signals derived from existing data.

### Coupling

- Coupling to infrastructure is limited to `LearningRepositoryPort` (Protocol). Swapping DB implementation requires only a new port implementation.
- Coupling between analyzers: none. Each receives raw data types only.

### Cohesion

- `LearningProfileBuilder` is the only place that knows the full list of analyzers. Adding an analyzer touches only the builder and the profile.
- Value objects are frozen dataclasses — immutable after construction, thread-safe.

### Identified Future Improvements

1. **Async analyzer pipeline**: run analyzers concurrently (they're CPU-bound but pure, safe for thread pools).
2. **Incremental update**: instead of full recomputation on every observation, maintain a sliding window for real-time updates without full DB reads.
3. **Concept confusion via embeddings**: replace co-occurrence heuristic with semantic similarity between error explanations (requires LLM/embedding infra).
4. **A/B format testing**: track whether recommending `preferred_format` actually improves velocity vs random format; feed back into the preference model.
5. **Mastery trajectory smoothing**: replace linear velocity with exponential smoothing to reduce noise from single bad sessions.
6. **Persistence**: optionally persist `LearningProfile` to DB so profile survives server restarts and doesn't require recomputation on cold start.
