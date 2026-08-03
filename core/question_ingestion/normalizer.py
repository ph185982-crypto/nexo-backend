"""
Normalizer: raw dict (from JSON seed or import) → IngestedQuestion.

Applies light cleanup only — it never fixes structurally broken records.
Broken records are flagged by the Validator.
"""
from __future__ import annotations

import re
from typing import Optional

from .models import Alternative, IngestedQuestion, QuestionType, SourceType

_VALID_DIFFICULTIES = {"easy", "medium", "hard"}
_DIFFICULTY_ALIASES = {
    "fácil": "easy", "facil": "easy",
    "médio": "medium", "medio": "medium", "média": "medium",
    "difícil": "hard", "dificil": "hard",
}


def normalize(raw: dict, source_type: SourceType = SourceType.UNKNOWN) -> Optional[IngestedQuestion]:
    """
    Convert a raw dict to IngestedQuestion.

    Returns None if the record is fundamentally unusable (missing question text
    or alternatives). The Validator provides richer diagnostics; this is
    a best-effort conversion.
    """
    try:
        text = _clean(raw.get("text", ""))
        if not text:
            return None

        alternatives_raw = raw.get("alternatives", [])
        if not alternatives_raw:
            return None

        alternatives = [
            Alternative(
                letter=str(a.get("letter", "")).strip().upper(),
                text=_clean(a.get("text", "")),
                is_correct=bool(a.get("is_correct", False)),
                explanation=_clean(a.get("explanation", "")),
            )
            for a in alternatives_raw
            if isinstance(a, dict)
        ]

        q_type_raw = raw.get("question_type", "")
        try:
            question_type = QuestionType(q_type_raw)
        except ValueError:
            question_type = (
                QuestionType.CERTO_ERRADO
                if len(alternatives) == 2
                else QuestionType.MULTIPLA_ESCOLHA
            )

        difficulty_raw = str(raw.get("difficulty", "medium")).lower()
        difficulty = _DIFFICULTY_ALIASES.get(difficulty_raw, difficulty_raw)
        if difficulty not in _VALID_DIFFICULTIES:
            difficulty = "medium"

        year_raw = raw.get("year", 0)
        try:
            year = int(year_raw)
        except (TypeError, ValueError):
            year = 0

        return IngestedQuestion(
            subject_slug=_slug(raw.get("subject_slug", "")),
            topic_slug=_slug(raw.get("topic_slug", "")),
            question_type=question_type,
            text=text,
            alternatives=alternatives,
            difficulty=difficulty,
            source=_clean(raw.get("source", "")),
            year=year,
            examiner=_clean(raw.get("examiner", "")),
            explanation=_clean(raw.get("explanation", "")),
            legal_basis=_clean(raw.get("legal_basis", "")),
            context_text=_clean(raw.get("context_text", "")),
            source_type=source_type,
            tags=_extract_tags(raw),
        )
    except Exception:
        return None


def _clean(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value).strip()


def _slug(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip().lower().replace(" ", "-")


def _extract_tags(raw: dict) -> list[str]:
    tags = raw.get("tags", [])
    if isinstance(tags, list):
        return [str(t).strip() for t in tags if t]
    return []
