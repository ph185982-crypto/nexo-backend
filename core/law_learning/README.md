# Law Learning Engine

Article-level study intelligence for the PRF adaptive study platform.

Every legal article becomes an intelligent study object.

## Purpose

The Law Learning Engine (LLE) transforms a raw legal article into an `ArticleLearningObject` — a fully enriched study object that tells the user what the article means, how hard it is, how important it is for the exam, what they've gotten wrong before, and exactly what to do next.

It does NOT:
- Create flashcards
- Schedule reviews
- Modify missions
- Modify the Approval Engine estimate
- Generate AI explanations (provider is injected and swappable)
- Access any database

Other engines (Decision Engine, Mission Builder) consume LLE output to build study plans.

## Architecture

```
core/law_learning/
├── engine.py                         # LawLearningEngine (public entry point)
├── interfaces/
│   ├── context.py                    # ArticleContext + 5 input snapshot types
│   ├── output.py                     # ArticleLearningObject + component types
│   └── port.py                       # LawLearningRepositoryPort (guides callers, not used by engine)
├── models/
│   └── enums.py                      # DifficultyLevel, ImportanceLevel, StudyStatus, NextActionType
├── providers/
│   ├── base.py                       # ExplanationProvider Protocol (pluggable)
│   └── static.py                     # StaticExplanationProvider (uses DB's simple_text)
├── estimators/
│   ├── difficulty.py                 # 5-factor difficulty scorer → VERY_EASY/EASY/MEDIUM/HARD/VERY_HARD
│   └── importance.py                 # 5-factor importance scorer → LOW/MEDIUM/HIGH/CRITICAL
└── analyzers/
    ├── relationship.py               # Classifies KGE-sourced related content
    └── study.py                      # Study status + next action + learning gain
```

## Analysis Pipeline

```
ArticleContext
     │
     ├─► ExplanationProvider.explain()      → ArticleExplanation
     ├─► estimate_difficulty()              → ArticleDifficulty
     ├─► estimate_importance()              → ArticleImportance
     ├─► find_related()                     → list[RelatedArticleRef]
     ├─► determine_status()                 → StudyStatus
     ├─► recommend_action()                 → StudyRecommendation
     └─► compute_learning_gain()            → float (approval prob delta)
               │
               ▼
       ArticleLearningObject
```

## Explanation Provider (Pluggable)

The `ExplanationProvider` Protocol separates the explanation generation strategy from the rest of the engine. Swap providers without touching any other file:

| Provider | Description | Status |
|---|---|---|
| `StaticExplanationProvider` | Uses `legal_articles.simple_text` from DB | ✅ Implemented |
| AI provider | GPT-4o, Claude, etc. | 🔜 Future — implement `ExplanationProvider` Protocol |

```python
# Default (static):
engine = LawLearningEngine()

# Future AI provider:
engine = LawLearningEngine(provider=GPTExplanationProvider(api_key=...))
```

## Difficulty Scoring

Five factors, weighted sum → threshold mapping:

| Factor | Weight | Source |
|---|---|---|
| Text complexity | 0.25 | word_count + avg word length |
| Exception density | 0.20 | count of "exceto/salvo/ressalvado" words |
| Legal reference depth | 0.20 | cross-references in text |
| Personal error rate | 0.20 | PersonalProgressSnapshot.accuracy |
| KGE error pressure | 0.15 | NodeMetrics.error_pressure |

| Score | Level |
|---|---|
| ≥ 0.75 | VERY_HARD |
| ≥ 0.55 | HARD |
| ≥ 0.35 | MEDIUM |
| ≥ 0.18 | EASY |
| < 0.18 | VERY_EASY |

## Importance Scoring

Five factors, weighted sum → threshold mapping:

| Factor | Weight | Source |
|---|---|---|
| Exam frequency | 0.35 | legal_articles.frequency_score |
| Subject weight | 0.25 | ApprovalContextSnapshot.subject_weight |
| KGE impact score | 0.20 | NodeMetrics.impact_score |
| Error recurrence | 0.10 | PersonalProgressSnapshot.mistake_count |
| Cross-references | 0.10 | RelatedContentSnapshot.related_article_ids |

| Score | Level |
|---|---|
| ≥ 0.72 | CRITICAL |
| ≥ 0.50 | HIGH |
| ≥ 0.28 | MEDIUM |
| < 0.28 | LOW |

## Study Status & Next Action

### Status determination

| Condition | Status |
|---|---|
| No attempts yet | NOT_STARTED |
| mastery ≥ 0.80 and accuracy ≥ 0.80 | MASTERED |
| is_overdue = True | NEEDS_REVIEW |
| Otherwise | IN_PROGRESS |

### Recommended next action

| Status | Condition | Action |
|---|---|---|
| NOT_STARTED | — | READ_ARTICLE |
| NEEDS_REVIEW | mistake_count > 3 | REVISIT_MISTAKES |
| NEEDS_REVIEW | mistake_count ≤ 3 | REVIEW_ARTICLE |
| MASTERED | related content available | ADVANCE_TO_RELATED |
| MASTERED | no related content | SOLVE_QUESTIONS |
| IN_PROGRESS | mistake_count > 2 | REVISIT_MISTAKES |
| IN_PROGRESS | difficulty HARD+ | COMPARE_ARTICLES |
| IN_PROGRESS | otherwise | SOLVE_QUESTIONS |

### Supported actions

| Action | Estimated Time | Primary Use |
|---|---|---|
| READ_ARTICLE | 15 min | NOT_STARTED |
| REVIEW_ARTICLE | 10 min | NEEDS_REVIEW (few mistakes) |
| SOLVE_QUESTIONS | 20 min | IN_PROGRESS, MASTERED |
| COMPARE_ARTICLES | 12 min | IN_PROGRESS + HARD article |
| CREATE_FLASHCARD | 5 min | Exception-heavy content |
| REVISIT_MISTAKES | 15 min | Recurring errors |
| ADVANCE_TO_RELATED | 10 min | MASTERED + related content |

## Relationship Finder

Classifies pre-loaded KGE data into typed relationships:

| Relationship | Source | Strength |
|---|---|---|
| same_chapter | sibling_article_ids (same chapter/section) | 0.85 |
| cross_referenced | related_article_ids (KGE edges) | 0.40–0.70 (rank-decayed) |

Callers pre-populate `RelatedContentSnapshot` from KGE before calling `analyze()`.

## Learning Gain Estimate

```
gain = importance.score × (subject_weight / 5.0) × 0.10
     + min(mistake_count × 0.005, 0.03)   ← recurrence bonus
```

Capped at 0.12 per article — realistic single-article approval probability ceiling.

## Integration

### With Knowledge Graph Engine

Callers run KGE queries and pass results in via `RelatedContentSnapshot` and optionally a duck-typed `kge_node`:

```python
kge_node = kge.get_node(article_id)
related_content = RelatedContentSnapshot(
    related_article_ids=[r.id for r in kge.find_related(article_id)],
    related_article_labels=[r.label for r in ...],
    related_question_ids=[q.id for q in kge.get_questions(article_id)],
    ...
)
context = ArticleContext(..., related_content=related_content, kge_node=kge_node)
```

### With Learning Engine

`LearningContextSnapshot` maps from `LearningProfile.as_roi_context()`:
- `forgetting_velocity_article` → per-subject forgetting velocity
- `confidence_for_subject` → confidence calibration for the subject
- `retention_category`, `review_efficiency` → direct mapping

### With Approval Engine

`ApprovalContextSnapshot` provides:
- `subject_weight` → used in importance scoring and learning gain estimate
- `approval_probability` / `risk_level` → context for priority decisions

### With Error Intelligence Engine

`recent_error_analyses` can be passed as duck-typed `ErrorAnalysis` objects.
The LLE duck-types `.classification`, `.severity`, `.estimated_gain`.

## Usage

```python
from core.law_learning import LawLearningEngine, ArticleContext, ...

engine = LawLearningEngine()  # or LawLearningEngine(provider=MyAIProvider())

context = ArticleContext(
    user_id=user_id,
    article=ArticleSnapshot(
        article_id=article_id,
        document_id=document_id,
        article_number="29",
        official_text="...",
        simple_text="...",     # from legal_articles.simple_text
        frequency_score=0.75,
        document_abbreviation="CTB",
        ...
    ),
    progress=PersonalProgressSnapshot(
        mastery_level=0.55,
        total_attempts=20,
        accuracy=0.65,
        mistake_count=3,
        review_count=2,
        last_studied=datetime.now(timezone.utc) - timedelta(days=5),
        is_overdue=False,
    ),
    related_content=RelatedContentSnapshot(...),  # pre-loaded from KGE
    learning=LearningContextSnapshot(...),         # from LearningProfile
    approval=ApprovalContextSnapshot(...),         # from ApprovalEstimate
)

obj = engine.analyze(context)

# Key outputs:
print(obj.study_status)                           # e.g. StudyStatus.IN_PROGRESS
print(obj.difficulty.level)                       # e.g. DifficultyLevel.HARD
print(obj.importance.level)                       # e.g. ImportanceLevel.CRITICAL
print(obj.recommended_next_action.action)         # e.g. NextActionType.REVISIT_MISTAKES
print(obj.estimated_learning_gain)                # e.g. 0.0412
print(obj.explanation.summary)                    # plain-language explanation
print(obj.as_dict())                              # serializable dict for API/UI
```

## Extension Points

**Adding a new explanation provider (AI):**
1. Implement the `ExplanationProvider` Protocol in `providers/`
2. Pass an instance to `LawLearningEngine(provider=MyProvider())`

**Adding a new difficulty/importance factor:**
1. Add the signal scorer to the respective estimator function
2. Add its weight to `_WEIGHTS` (adjust other weights to keep sum = 1.0)

**Adding a new next action:**
1. Add enum value to `NextActionType` in `models/enums.py`
2. Add estimated time to `_TIME_ESTIMATES` in `analyzers/study.py`
3. Add selection logic to `recommend_action()`

## Tests

```bash
python -m core.law_learning.smoke_test
```

## Engineering Notes

**Projection pattern.** The LLE owns its own input types (`ArticleSnapshot`, `PersonalProgressSnapshot`, etc.) — it never imports from Learning Engine or Approval Engine. Callers map data in. This eliminates circular dependencies and allows independent versioning.

**Pluggable provider without IoC container.** `ExplanationProvider` is a structural Protocol — any class with a `provider_name` property and an `explain(context)` method satisfies it. The engine constructor accepts any provider; the default is `StaticExplanationProvider`. Future AI providers are injected at the call site.

**Duck-typed KGE node.** `kge_node: Optional[Any]` — the engine accesses `.metrics.impact_score` and `.metrics.error_pressure` only when present. If the KGE node structure changes, only `estimators/difficulty.py` and `estimators/importance.py` need updating.

**No I/O, no state.** Every call is pure — same context always produces the same output. Callers cache `ArticleLearningObject` results themselves if needed.
