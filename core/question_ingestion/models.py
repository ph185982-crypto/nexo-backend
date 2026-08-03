"""
Data model for ingested questions — exam-agnostic, normalized representation.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class SourceType(str, Enum):
    SEED = "seed"
    AUTHORIZED_IMPORT = "authorized_import"
    USER_PROVIDED = "user_provided"
    LICENSED = "licensed"
    UNKNOWN = "unknown"


class QuestionType(str, Enum):
    MULTIPLA_ESCOLHA = "multipla_escolha"
    CERTO_ERRADO = "certo_errado"


@dataclass
class Alternative:
    letter: str
    text: str
    is_correct: bool
    explanation: str = ""


@dataclass
class IngestedQuestion:
    """
    Normalized question ready for database insertion or coverage analysis.
    All fields are validated by the normalizer/validator before this object
    is created.
    """
    subject_slug: str
    topic_slug: str
    question_type: QuestionType
    text: str
    alternatives: list[Alternative]
    difficulty: str                      # easy | medium | hard
    source: str
    year: int
    examiner: str
    explanation: str
    legal_basis: str

    # optional
    context_text: str = ""
    source_type: SourceType = SourceType.UNKNOWN
    content_hash: str = ""              # SHA-256 of normalized text; set by pipeline
    tags: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.content_hash:
            self.content_hash = _hash(self.subject_slug, self.text)


def _hash(*parts: str) -> str:
    payload = "\n".join(p.strip().lower() for p in parts)
    return hashlib.sha256(payload.encode()).hexdigest()
