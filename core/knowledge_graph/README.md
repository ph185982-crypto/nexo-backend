# Knowledge Graph Engine

Independent domain that models the relationships between every knowledge entity
in the platform and answers three key questions:

1. **"What are the biggest knowledge gaps?"** → `get_gap_analysis()`
2. **"Which article is at the origin of this error?"** → `find_error_origins()`
3. **"Which related content should be reviewed now?"** → `find_related_content()`

The Decision Engine queries this engine for enriched priorities.
It sees only typed `KnowledgeGapSummary` objects — never graph internals.

## Directory layout

```
core/knowledge_graph/
├── engine.py               # KnowledgeGraphEngine — public entry point
├── graph/
│   ├── node.py             # NodeType, KnowledgeNode, NodeMetrics
│   ├── edge.py             # EdgeType, KnowledgeEdge
│   ├── graph.py            # KnowledgeGraph (adjacency list, BFS, overlay)
│   └── builder.py          # GraphBuilder — assembles graph from raw DB rows
├── scoring/
│   └── scorer.py           # NodeScorer, ScoredNode — gap_score / impact_score
├── queries/
│   ├── gap_query.py        # GapQuery → GapAnalysis (top gaps, critical, quick_wins)
│   ├── origin_query.py     # OriginQuery → OriginResult (article → siblings → path)
│   └── related_query.py    # RelatedQuery → RelatedContent (BFS + scoring)
└── ports/
    └── repository.py       # KnowledgeGraphRepositoryPort (Protocol) + raw data types
```

## Graph structure

### Node types

| Type      | DB table         | Key fields                              |
|-----------|------------------|-----------------------------------------|
| SUBJECT   | subjects         | weight_prf, weight_pm, slug             |
| TOPIC     | topics           | weight, parent_topic_id                 |
| QUESTION  | questions        | subject_id, topic_id, legal_article_id  |
| ARTICLE   | legal_articles   | subject_id, topic_id, frequency_score   |
| FLASHCARD | flashcards       | question_id, article_id                 |

### Edge types (all from FK relationships — no new tables needed)

```
Subject ──SUBJECT_CONTAINS_TOPIC──▶ Topic
Topic   ──TOPIC_HAS_SUBTOPIC──────▶ Topic          (parent_topic_id)
Topic   ──TOPIC_CONTAINS_QUESTION─▶ Question
Subject ──SUBJECT_CONTAINS_QUESTION▶ Question       (when topic_id is NULL)
Question──QUESTION_GROUNDED_IN────▶ Article         (legal_article_id)
Article ──ARTICLE_BELONGS_TO_SUBJ─▶ Subject
Article ──ARTICLE_BELONGS_TO_TOPIC▶ Topic
Flashcard──FLASHCARD_DERIVED_FROM─▶ Question
Flashcard──FLASHCARD_BASED_ON────▶ Article
```

### User overlay (no new tables)

User-specific data is read from existing tables and overlaid as `NodeMetrics`:

| Signal            | DB source                                 |
|-------------------|-------------------------------------------|
| mastery_score     | subject_mastery.mastery_level             |
| error_count       | error_notebook (unresolved, per subject)  |
| review_count      | review_cards (count per question/article) |
| overdue_reviews   | review_cards WHERE next_review < NOW()    |
| correct_rate      | subject_mastery.accuracy                  |

## Scoring formula

```
gap_score    = importance × (1 - mastery/100)
error_pressure  = min(error_count × 0.05, 0.3)
review_pressure = min(overdue_reviews × 0.05, 0.3)
impact_score = min(gap_score + error_pressure + review_pressure, 1.0)
```

`importance` = exam weight normalised to 0-1 (max weight 5.0 in PRF seeds).

## Lifecycle

```python
# Startup
engine = KnowledgeGraphEngine(repo=MyRepoAdapter())
await engine.warm_up()  # loads static graph once

# Per-request
analysis = await engine.get_gap_analysis(user_id, "PRF", limit=5)
# → GapAnalysis.top_gaps: list[GapResult] sorted by impact_score

origins = await engine.find_error_origins(user_id, "PRF", [question_uuid_1, question_uuid_2])
# → list[OriginResult] with article, siblings, study_path

related = await engine.find_related_content(user_id, "PRF", "topic:some-uuid", limit=8)
# → list[RelatedContent] sorted by relevance_score
```

## Integration with Decision Engine

```
MissionBuilder.build_mission()
    │
    ├── repo.get_mastery_snapshots()  ─┐
    ├── repo.get_review_queue()        │  parallel
    ├── ...                            │
    └── kge.get_gap_analysis()        ─┘
           │
           ▼  _gap_analysis_to_summaries()
    list[KnowledgeGapSummary]
           │
           ▼  DecisionInput.knowledge_gaps
    KnowledgeGapStrategy.recommend()
           │
           ▼
    MissionStep(reason=HIGH_PRIORITY_TOPIC, payload={node_id, gap_score, ...})
```

The Decision Engine only sees `KnowledgeGapSummary` — a flat struct with no graph types.

## Adding a new edge type

1. Add variant to `EdgeType` in `graph/edge.py`
2. Add `add_edge()` call in `GraphBuilder.build_static()`
3. Use in query handlers as needed — no schema changes required

## Testing

```python
from core.knowledge_graph import KnowledgeGraphEngine
from core.knowledge_graph.graph.builder import GraphBuilder
from core.knowledge_graph.graph.graph import KnowledgeGraph

# Build graph from in-memory fixtures (no DB needed)
builder = GraphBuilder()
graph = builder.build_static(subjects, topics, questions, articles, flashcards)
metrics = builder.build_metrics(graph, "PRF", mastery_rows, error_rows, review_rows)
enriched = graph.overlay_metrics(metrics)

from core.knowledge_graph.queries.gap_query import GapQuery
analysis = GapQuery().execute(enriched, limit=5)
assert len(analysis.top_gaps) <= 5
assert all(g.impact_score >= 0 for g in analysis.top_gaps)
```
