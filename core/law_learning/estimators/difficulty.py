"""
ArticleDifficultyEstimator — signals-based scoring for article difficulty.

Five factors, weighted sum → threshold mapping.

| Factor                | Weight | Signal source                          |
|-----------------------|--------|----------------------------------------|
| Text complexity       | 0.25   | word_count, avg word length            |
| Exception density     | 0.20   | count of "exceto/salvo/excecao" words  |
| Legal reference depth | 0.20   | number of cross-references in text     |
| Historical error rate | 0.20   | PersonalProgressSnapshot.accuracy      |
| Global error rate     | 0.15   | KGE error_count / total_attempts       |

Thresholds:
  ≥ 0.75 → VERY_HARD
  ≥ 0.55 → HARD
  ≥ 0.35 → MEDIUM
  ≥ 0.18 → EASY
  <  0.18 → VERY_EASY
"""
from __future__ import annotations

import re

from ..interfaces.context import ArticleContext
from ..interfaces.output import ArticleDifficulty
from ..models.enums import DifficultyLevel

_EXCEPTION_PATTERN = re.compile(
    r"\b(exceto|salvo|ressalvado|excepcionalmente|somente|apenas|unicamente)\b",
    re.IGNORECASE,
)
_LEGAL_REF_PATTERN = re.compile(
    r"\b(art\.?\s*\d+|§\s*\d+|inciso\s+[IVXLCDM]+|alínea\s+[a-z])\b",
    re.IGNORECASE,
)

_WEIGHTS = {
    "text_complexity":      0.25,
    "exception_density":    0.20,
    "legal_ref_depth":      0.20,
    "personal_error_rate":  0.20,
    "kge_error_pressure":   0.15,
}

_THRESHOLDS = [
    (0.75, DifficultyLevel.VERY_HARD),
    (0.55, DifficultyLevel.HARD),
    (0.35, DifficultyLevel.MEDIUM),
    (0.18, DifficultyLevel.EASY),
    (0.00, DifficultyLevel.VERY_EASY),
]

_REASONING_MAP = {
    DifficultyLevel.VERY_HARD: "Artigo muito complexo: texto denso, muitas exceções e alto índice de erro histórico.",
    DifficultyLevel.HARD:      "Artigo difícil: linguagem técnica ou exceções relevantes elevam o risco de erro.",
    DifficultyLevel.MEDIUM:    "Artigo de dificuldade moderada: requer atenção aos detalhes mas sem excessos.",
    DifficultyLevel.EASY:      "Artigo acessível: linguagem direta e poucas armadilhas.",
    DifficultyLevel.VERY_EASY: "Artigo simples: curto, sem exceções relevantes e alta taxa de acerto histórica.",
}


def estimate(context: ArticleContext) -> ArticleDifficulty:
    article = context.article
    text = article.official_text

    factors: dict[str, float] = {}

    # 1. Text complexity (word count + avg word length)
    words = text.split()
    avg_len = sum(len(w) for w in words) / max(len(words), 1)
    wc_score = min(len(words) / 300, 1.0)
    len_score = min((avg_len - 4) / 4, 1.0)
    factors["text_complexity"] = max(0.0, (wc_score * 0.60 + len_score * 0.40))

    # 2. Exception density
    exceptions = len(_EXCEPTION_PATTERN.findall(text))
    factors["exception_density"] = min(exceptions / 4, 1.0)

    # 3. Legal reference depth
    refs = len(_LEGAL_REF_PATTERN.findall(text))
    factors["legal_ref_depth"] = min(refs / 8, 1.0)

    # 4. Personal error rate (inverse of accuracy)
    if context.progress and context.progress.total_attempts > 0:
        factors["personal_error_rate"] = 1.0 - context.progress.accuracy
    else:
        factors["personal_error_rate"] = 0.50  # neutral when no history

    # 5. KGE error pressure
    if context.kge_node and hasattr(context.kge_node, "metrics") and context.kge_node.metrics:
        factors["kge_error_pressure"] = float(context.kge_node.metrics.error_pressure)
    else:
        factors["kge_error_pressure"] = 0.30  # neutral

    composite = sum(_WEIGHTS[k] * factors[k] for k in _WEIGHTS)

    level = DifficultyLevel.VERY_EASY
    for threshold, lvl in _THRESHOLDS:
        if composite >= threshold:
            level = lvl
            break

    return ArticleDifficulty(
        level=level,
        score=round(composite, 4),
        factors={k: round(v, 4) for k, v in factors.items()},
        reasoning=_REASONING_MAP[level],
    )
