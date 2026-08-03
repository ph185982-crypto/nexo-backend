# Approval Engine

Single source of truth for exam approval probability estimation.

## Responsibility

The Approval Engine answers one question: **"What is the probability this student passes the exam?"**

It does NOT:
- Make study decisions
- Create missions or recommendations
- Access the database
- Cache data

## Architecture

```
core/approval_engine/
├── engine.py                   # ApprovalEngine — entry point
├── interfaces/
│   ├── context.py              # ApprovalContext + input types
│   └── estimate.py             # ApprovalEstimate + output types
├── models/
│   └── estimator.py            # BaseEstimator + EstimatorResult
├── estimators/                 # 6 pluggable estimators
│   ├── coverage.py             # weight=0.30 — breadth across topics
│   ├── retention.py            # weight=0.25 — SM-2 stability + backlog
│   ├── exam_weight.py          # weight=0.20 — mastery in high-weight subjects
│   ├── consistency.py          # weight=0.15 — study regularity
│   ├── growth.py               # weight=0.07 — learning velocity + momentum
│   └── confidence.py           # weight=0.03 — calibration + stability
└── services/
    ├── approval_estimator.py   # composite aggregation + sigmoid mapping
    ├── trend_analyzer.py       # direction + acceleration vs previous estimate
    └── projection_calculator.py # 7/30/60/90-day forward projections
```

## Usage

```python
from core.approval_engine import ApprovalEngine, ApprovalContext, ...

engine = ApprovalEngine()   # stateless — instantiate once

context = ApprovalContext(
    user_id=user_id,
    target_exam="PRF",
    days_until_exam=45,
    subjects=[...],
    ...
)

estimate = engine.estimate(context)
print(estimate.approval_pct)          # e.g. 67.3
print(estimate.risk_level)            # "low" | "medium" | "high"
summary = estimate.as_summary_dict()  # lightweight dict for API
```

## Composite Formula

```
composite = Σ(estimator_score × weight) / Σ(weight)
probability = sigmoid(composite) = 1 / (1 + e^(−10 × (composite − 0.55)))
```

The sigmoid midpoint (0.55) means a student needs a composite above 55%
to have better-than-even odds of approval.

## Adding an Estimator

1. Subclass `BaseEstimator` in `estimators/your_estimator.py`
2. Set `name` and `weight` properties
3. Implement `estimate(context) -> EstimatorResult`
4. Register in `estimators/__init__.py`
5. Add to `_ESTIMATORS` list in `services/approval_estimator.py`
6. Adjust sibling weights so they sum to 1.0

## Inputs

`ApprovalContext` is assembled by callers from:
- Subject mastery snapshots (DE or subject_mastery table)
- Knowledge gaps (KGE or knowledge_gap_summaries table)
- Mission history (DE or missions table)
- Review backlog (review_cards table)
- Study consistency metrics (behavior_metrics table)
- Exam configuration (hardcoded per exam_id)
- `LearningProfile.as_roi_context()` dict (Learning Engine)
- Previous estimate for trend comparison (approval_estimates table or cache)

## Tests

```bash
python -m core.approval_engine.smoke_test
```
