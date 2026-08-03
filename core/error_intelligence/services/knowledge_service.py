"""
KnowledgeService — surfaces related content from the Knowledge Graph.

Takes the pre-computed KGE OriginResult (duck-typed) and assembles
the RelatedKnowledge output type.

No I/O — operates on data already fetched by the caller.
"""
from __future__ import annotations

from typing import Any, Optional

from ..interfaces.analysis import RelatedKnowledge
from ..models.enums import ErrorClassification


def build_related_knowledge(
    origin_result: Optional[Any],
    classification: ErrorClassification,
) -> RelatedKnowledge:
    """
    Assembles RelatedKnowledge from a KGE OriginResult (or None).

    The OriginResult is accepted as Any to avoid coupling to KGE internals.
    Attributes accessed via duck-typing:
      .article          → KnowledgeNode | None
      .topic            → KnowledgeNode | None
      .subject          → KnowledgeNode | None
      .sibling_questions → list[KnowledgeNode]
      .related_articles  → list[KnowledgeNode]
      .study_path        → list[KnowledgeNode]
    """
    if origin_result is None:
        return _empty()

    articles  = _safe_list(origin_result, "related_articles")
    if _safe_get(origin_result, "article"):
        articles = [origin_result.article] + [a for a in articles if a is not origin_result.article]

    topics    = [origin_result.topic] if _safe_get(origin_result, "topic") else []
    questions = _safe_list(origin_result, "sibling_questions")
    flashcards: list[Any] = []  # KGE OriginResult doesn't include flashcards; callers may add them
    study_path = _safe_list(origin_result, "study_path")

    mission_hints = _mission_step_hints(classification, origin_result)

    return RelatedKnowledge(
        articles=articles[:10],
        topics=topics[:5],
        questions=questions[:10],
        flashcards=flashcards,
        study_path=study_path[:8],
        mission_step_hints=mission_hints,
    )


def _empty() -> RelatedKnowledge:
    return RelatedKnowledge(
        articles=[],
        topics=[],
        questions=[],
        flashcards=[],
        study_path=[],
        mission_step_hints=[],
    )


def _safe_get(obj: Any, attr: str) -> Any:
    return getattr(obj, attr, None)


def _safe_list(obj: Any, attr: str) -> list:
    val = getattr(obj, attr, None)
    return list(val) if val else []


def _mission_step_hints(
    classification: ErrorClassification,
    origin_result: Any,
) -> list[str]:
    """
    Returns suggested StepType strings for the Decision Engine.
    This is a hint — the Decision Engine decides what to include.
    """
    hints: list[str] = []

    has_article = _safe_get(origin_result, "article") is not None

    if classification in (
        ErrorClassification.UNKNOWN_CONTENT,
        ErrorClassification.GUESS,
        ErrorClassification.LAW_CONFUSION,
    ):
        if has_article:
            hints.append("LAW")
        hints.append("REVIEW")

    elif classification in (
        ErrorClassification.MEMORY_FAILURE,
        ErrorClassification.EXCEPTION_CONFUSION,
    ):
        hints.append("REVIEW")
        hints.append("FLASHCARDS")

    elif classification in (
        ErrorClassification.CONCEPT_CONFUSION,
        ErrorClassification.INTERPRETATION_ERROR,
    ):
        hints.append("QUESTIONS")
        hints.append("REVIEW")

    elif classification in (
        ErrorClassification.MISREAD_QUESTION,
        ErrorClassification.TIME_PRESSURE,
        ErrorClassification.OVERCONFIDENCE,
    ):
        hints.append("QUESTIONS")

    else:
        hints.append("QUESTIONS")

    return hints
