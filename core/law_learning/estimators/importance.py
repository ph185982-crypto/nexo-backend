"""
ArticleImportanceEstimator — signals-based scoring for exam relevance.

Five factors, weighted sum → threshold mapping.

| Factor               | Weight | Signal source                              |
|----------------------|--------|--------------------------------------------|
| Exam frequency       | 0.35   | article.frequency_score (from DB)          |
| Subject weight       | 0.25   | ApprovalContextSnapshot.subject_weight     |
| KGE impact score     | 0.20   | NodeMetrics.impact_score                   |
| Error recurrence     | 0.10   | PersonalProgressSnapshot.mistake_count     |
| Cross-reference count| 0.10   | RelatedContentSnapshot.related_article_ids |

Thresholds:
  ≥ 0.72 → CRITICAL
  ≥ 0.50 → HIGH
  ≥ 0.28 → MEDIUM
  <  0.28 → LOW
"""
from __future__ import annotations

from ..interfaces.context import ArticleContext
from ..interfaces.output import ArticleImportance
from ..models.enums import ImportanceLevel

_WEIGHTS = {
    "exam_frequency":     0.35,
    "subject_weight":     0.25,
    "kge_impact":         0.20,
    "error_recurrence":   0.10,
    "cross_references":   0.10,
}

_THRESHOLDS = [
    (0.72, ImportanceLevel.CRITICAL),
    (0.50, ImportanceLevel.HIGH),
    (0.28, ImportanceLevel.MEDIUM),
    (0.00, ImportanceLevel.LOW),
]

_REASONING_MAP = {
    ImportanceLevel.CRITICAL: "Artigo altamente cobrado, com peso elevado na matéria e alto impacto na probabilidade de aprovação.",
    ImportanceLevel.HIGH:     "Artigo importante: aparece com frequência nas provas e afeta diretamente a pontuação.",
    ImportanceLevel.MEDIUM:   "Artigo de relevância moderada: vale estudar, mas não é o principal gargalo.",
    ImportanceLevel.LOW:      "Artigo raramente cobrado ou de baixo impacto — priorize outros conteúdos primeiro.",
}

_MAX_SUBJECT_WEIGHT = 5.0   # scale used by Approval Engine
_MAX_MISTAKES = 10.0        # normalizer for mistake_count


def estimate(context: ArticleContext) -> ArticleImportance:
    article = context.article
    factors: dict[str, float] = {}

    # 1. Exam frequency (already 0-1 in DB)
    factors["exam_frequency"] = float(article.frequency_score)

    # 2. Subject weight (0-5 scale → normalize to 0-1)
    raw_weight = context.approval.subject_weight if context.approval else 2.5
    factors["subject_weight"] = min(raw_weight / _MAX_SUBJECT_WEIGHT, 1.0)

    # 3. KGE impact score
    factors["kge_impact"] = context.kge_impact_score  # already 0-1 via property

    # 4. Error recurrence (more mistakes = more important to fix)
    if context.progress:
        factors["error_recurrence"] = min(context.progress.mistake_count / _MAX_MISTAKES, 1.0)
    else:
        factors["error_recurrence"] = 0.0

    # 5. Cross-references (how connected is this article)
    if context.related_content:
        n_related = len(context.related_content.related_article_ids)
        factors["cross_references"] = min(n_related / 10, 1.0)
    else:
        factors["cross_references"] = 0.0

    composite = sum(_WEIGHTS[k] * factors[k] for k in _WEIGHTS)

    level = ImportanceLevel.LOW
    for threshold, lvl in _THRESHOLDS:
        if composite >= threshold:
            level = lvl
            break

    return ArticleImportance(
        level=level,
        score=round(composite, 4),
        factors={k: round(v, 4) for k, v in factors.items()},
        reasoning=_REASONING_MAP[level],
    )
