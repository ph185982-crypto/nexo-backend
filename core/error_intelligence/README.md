# Error Intelligence Engine

Learning diagnosis system for the PRF adaptive study platform.

Every wrong answer becomes an opportunity to improve approval probability.

## Purpose

The Error Intelligence Engine (EIE) classifies **WHY** a user failed a question and prescribes **what to do next**. It is the central diagnosis component — not an error log, not a notebook, not a recommendation engine.

It does NOT:
- Create flashcards
- Schedule reviews
- Update missions
- Modify approval estimates
- Access any database

Other engines (Decision Engine, Mission Builder) consume EIE output to take action.

## Architecture

```
core/error_intelligence/
├── engine.py                         # ErrorIntelligenceEngine (public entry point)
├── interfaces/
│   ├── context.py                    # ErrorContext + 8 input snapshot types
│   ├── analysis.py                   # ErrorAnalysis + 5 output types
│   └── port.py                       # ErrorRepositoryPort (guides callers, not used by engine)
├── models/
│   └── enums.py                      # ErrorClassification, ErrorSeverity, TreatmentActionType,
│                                     # PatternType, EvolutionDirection
├── classifiers/
│   └── error_classifier.py           # Signal-based scorer for all 12 classification types
├── analyzers/
│   ├── root_cause.py                 # Plain-language WHY explanation
│   ├── severity.py                   # 6-factor severity scoring → LOW/MEDIUM/HIGH/CRITICAL
│   ├── evolution.py                  # Tracks improving/stable/worsening trend
│   └── pattern.py                    # Detects recurring behavioural patterns
└── services/
    ├── treatment_service.py          # Builds ordered TreatmentAction list
    ├── knowledge_service.py          # Assembles RelatedKnowledge from KGE OriginResult
    └── report_service.py             # Structured diagnostic report generator
```

## Classification Flow

```
ErrorContext ─► ErrorClassifier ─► (classification, scores dict)
                     │
                     ├─ 12 signal scorers run in parallel
                     ├─ Each scorer returns 0-1
                     └─ Highest score wins
```

### Supported Classifications

| Classification | Trigger signals |
|---|---|
| UNKNOWN_CONTENT | First attempt, no mastery, no review card |
| MEMORY_FAILURE | Previously correct, now wrong, review overdue |
| CONCEPT_CONFUSION | Topic in confusion matrix, recurring error |
| MISREAD_QUESTION | Very fast response, high confidence |
| DISTRACTION | Session beyond fatigue threshold, low energy |
| LAW_CONFUSION | Multiple legal refs, lei seca type, recurring |
| INTERPRETATION_ERROR | Interpretação question type |
| EXCEPTION_CONFUSION | Tags: "exceto", "salvo", "excecao" content type |
| OVERCONFIDENCE | Confidence 4-5 with wrong answer |
| LOW_CONFIDENCE | Confidence 1-2, slow response, low mastery |
| TIME_PRESSURE | Very fast response relative to personal average |
| GUESS | Ultra-fast, no confidence, first attempt, no mastery |

## Severity Scoring

Six factors, weighted sum → threshold mapping:

| Factor | Weight | Source |
|---|---|---|
| Exam weight | 0.25 | ApprovalContextSnapshot.subject_weight |
| Concept importance | 0.20 | KGE NodeMetrics.impact_score |
| Recurrence | 0.25 | error_notebook.times_repeated |
| Question difficulty | 0.10 | questions.difficulty |
| Historical accuracy | 0.10 | subject_mastery.accuracy |
| Forgetting velocity | 0.10 | LearningProfile forgetting_velocity |

| Score | Severity |
|---|---|
| ≥ 0.72 | CRITICAL |
| ≥ 0.50 | HIGH |
| ≥ 0.28 | MEDIUM |
| < 0.28 | LOW |

## Treatment Flow

```
(classification, severity, context)
        │
        ▼
TreatmentService
        │
        ├─ Look up action template for classification
        ├─ Boost priority for HIGH/CRITICAL severity
        ├─ Resolve target entity (article_id, topic_id)
        └─ Return ordered list[TreatmentAction]
```

### Supported Actions

| Action | Estimated Time | Primary Use |
|---|---|---|
| READ_LAW | 15 min | UNKNOWN_CONTENT, LAW_CONFUSION, GUESS |
| REVIEW_SPECIFIC_ARTICLE | 10 min | MEMORY_FAILURE, EXCEPTION_CONFUSION |
| SOLVE_SIMILAR_QUESTIONS | 20 min | Most classifications |
| REVIEW_RELATED_CONCEPTS | 15 min | CONCEPT_CONFUSION, LAW_CONFUSION |
| CREATE_FLASHCARD_CANDIDATE | 5 min | CONCEPT_CONFUSION, EXCEPTION_CONFUSION |
| INCREASE_REVIEW_PRIORITY | 3 min | MEMORY_FAILURE, CRITICAL severity |
| SCHEDULE_SHORT_REVIEW | 8 min | MEMORY_FAILURE, DISTRACTION |
| SCHEDULE_LONG_REVIEW | 12 min | LOW_CONFIDENCE, GUESS |
| REVISIT_PREVIOUS_MISTAKES | 15 min | DISTRACTION |

## Pattern Detection

Runs on aggregate error history (list of ErrorEntrySnapshot + list of PreviousAttemptSnapshot).

| Pattern | Detection Rule |
|---|---|
| FAST_ANSWERER | > 25% of attempts < 10 secs |
| EXCEPTION_MISSER | > 20% of errors are recurring conceptual errors |
| OVERCONFIDENT | > 25% of wrong answers had confidence 4-5 |
| FATIGUE_ERRORS | > 35% of errors in last third of daily session |
| LAW_CONFUSER | > 3 recurring conceptual errors on lei_seca type |
| TOPIC_BLIND_SPOT | ≥ 2 questions with 4+ repeated errors |

## Evolution Tracking

Given current attempt + previous history, classifies the trend:

| Direction | Condition |
|---|---|
| DISAPPEARED | error_notebook.resolved = True |
| IMPROVED | Recent half accuracy > older half by 15%+ |
| STABLE | delta < 15% |
| WORSENING | Recent half accuracy < older half by 15%+ |

## Usage

```python
from core.error_intelligence import ErrorIntelligenceEngine, ErrorContext, ...

engine = ErrorIntelligenceEngine()

# Assemble context from DB data + other engine outputs
context = ErrorContext(
    user_id=user_id,
    question=QuestionSnapshot(...),
    user_answer="C",
    correct_answer="E",
    response_time_secs=8,
    confidence=4,
    previous_attempts=[...],
    error_entry=...,       # from error_notebook
    review_card=...,       # from review_cards
    mastery=...,           # from subject_mastery
    session=...,           # from study_sessions
    learning=...,          # from LearningProfile.as_roi_context()
    approval=...,          # from ApprovalEstimate
    origin_result=kge.find_error_origins(...)[0],  # from KGE
)

analysis = engine.analyze(context)
report   = engine.generateReport(analysis)

# Aggregate pattern detection
patterns = engine.findPatterns(recent_errors, recent_attempts)
```

## Integration

### With Learning Engine

The `LearningContextSnapshot` is built from `LearningProfile.as_roi_context()`:
- `forgetting_velocity` → per-subject forgetting velocity
- `confidence_overall`, `confidence_by_subject` → `confidence_calibration`, `confidence_for_subject`
- `learning_speed_category` → `learning_speed`
- `fatigue_threshold_minutes` → `fatigue_threshold_mins`
- `confused_topics`, `confusion_pairs` → from `LearningProfile.confusion_matrix`
- `retention_category`, `review_efficiency_score` → direct mapping

### With Knowledge Graph Engine

The caller runs:
```python
origin_results = kge.find_error_origins(user_id, target_exam, [question_id])
context.origin_result = origin_results[0] if origin_results else None
```

The EIE duck-types `OriginResult` attributes: `.article`, `.topic`, `.subject`, `.sibling_questions`, `.related_articles`, `.study_path`.

### With Decision Engine

`ErrorAnalysis.related_knowledge.mission_step_hints` provides `StepType` hints ("LAW", "REVIEW", "QUESTIONS") that the Decision Engine can incorporate when building the next mission plan.

### With Approval Engine

`ApprovalContextSnapshot` provides:
- `subject_weight` → used in severity scoring
- `approval_probability` / `risk_level` → provides context for priority decisions

## Extension Points

**Adding a new classification:**
1. Add enum value to `ErrorClassification` in `models/enums.py`
2. Implement `_score_<name>()` in `classifiers/error_classifier.py`
3. Add to `scorers` dict in `classify()`
4. Add root-cause handler in `analyzers/root_cause.py`
5. Add treatment template in `services/treatment_service.py`

**Adding a new pattern:**
1. Add enum value to `PatternType` in `models/enums.py`
2. Implement `_detect_<name>()` in `analyzers/pattern.py`
3. Add to `detectors` list in `detect()`

## Engineering Report

### Architecture Decisions

**Projection pattern over direct coupling.** The EIE defines its own input types (`QuestionSnapshot`, `LearningContextSnapshot`, etc.) rather than importing from Learning Engine or KGE. This mirrors the Approval Engine pattern and eliminates circular dependencies. Callers pay a small mapping cost; the EIE gains full independence.

**KGE via duck-typing.** `origin_result: Optional[Any]` avoids a hard import from `core.knowledge_graph`. The attributes accessed (`.article`, `.topic`, `.sibling_questions`, `.study_path`) are stable KGE `OriginResult` fields — if they change, only `services/knowledge_service.py` needs updating.

**Signal scoring over rule trees.** Each classifier assigns continuous scores to all 12 classification types simultaneously. This makes ties explicit (both score 1.0) and composable — future classifiers can adjust weights without touching other classifiers.

**Stateless engine.** No cache, no state — every call is pure. Callers can cache `ErrorAnalysis` results themselves if needed. This makes the engine safe for concurrent use and easy to test.

**Port as documentation, not dependency.** `ErrorRepositoryPort` guides infrastructure adapters but is never imported by the engine itself. This enforces the clean architecture boundary: infra knows about the domain, not the reverse.

### Trade-offs

| Decision | Benefit | Cost |
|---|---|---|
| Own input types (projections) | Zero coupling, independent versioning | Callers must map data |
| Duck-typed OriginResult | No KGE import | No type safety for origin_result fields |
| Signal scoring | Transparent, extensible | Classification ties are possible (broken by dict order) |
| Stateless engine | Thread-safe, testable | No memoization — callers cache if needed |

### Future Improvements

1. **Confidence interval on classification.** When top-2 scores are within 0.05, report both as candidates instead of forcing a single winner.
2. **Temporal pattern detection.** Current pattern analyzer uses day-level bucketing. A session-level `position_in_session` field per attempt would enable more precise fatigue detection.
3. **Feedback loop.** Allow callers to mark an `ErrorAnalysis` as "treatment completed" so the EIE can track which treatments actually reduced error rates.
4. **CRITICAL cascade.** When a question is CRITICAL, automatically propagate to related questions in the same article (via KGE) and elevate their priority too.

## Tests

```bash
python -m core.error_intelligence.smoke_test
```
