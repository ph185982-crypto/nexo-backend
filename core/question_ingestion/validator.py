"""
Validator: checks an IngestedQuestion for completeness and correctness.
Returns a list of validation errors (empty means valid).
"""
from __future__ import annotations

from .models import IngestedQuestion, QuestionType

_VALID_DIFFICULTIES = {"easy", "medium", "hard"}


def validate(q: IngestedQuestion) -> list[str]:
    errors: list[str] = []

    if not q.subject_slug:
        errors.append("missing subject_slug")
    if not q.topic_slug:
        errors.append("missing topic_slug")
    if not q.text or len(q.text) < 10:
        errors.append("question text too short or empty")
    if not q.alternatives:
        errors.append("no alternatives provided")
    else:
        correct_count = sum(1 for a in q.alternatives if a.is_correct)
        if correct_count == 0:
            errors.append("no correct alternative marked")
        if correct_count > 1:
            errors.append(f"multiple correct alternatives ({correct_count})")
        for alt in q.alternatives:
            if not alt.text:
                errors.append(f"alternative {alt.letter} has empty text")

        if q.question_type == QuestionType.MULTIPLA_ESCOLHA:
            if len(q.alternatives) < 3:
                errors.append(
                    f"multipla_escolha should have ≥3 alternatives, got {len(q.alternatives)}"
                )
        if q.question_type == QuestionType.CERTO_ERRADO:
            if len(q.alternatives) != 2:
                errors.append(
                    f"certo_errado must have exactly 2 alternatives, got {len(q.alternatives)}"
                )

    if q.difficulty not in _VALID_DIFFICULTIES:
        errors.append(f"invalid difficulty: {q.difficulty!r}")
    if not q.explanation:
        errors.append("missing explanation")

    return errors
