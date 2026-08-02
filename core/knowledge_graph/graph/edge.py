from __future__ import annotations
from dataclasses import dataclass
from enum import Enum


class EdgeType(str, Enum):
    # Structural (static, from FK relationships in DB)
    SUBJECT_CONTAINS_TOPIC = "subject_contains_topic"
    TOPIC_HAS_SUBTOPIC = "topic_has_subtopic"
    TOPIC_CONTAINS_QUESTION = "topic_contains_question"
    SUBJECT_CONTAINS_QUESTION = "subject_contains_question"   # when topic_id is NULL
    QUESTION_GROUNDED_IN = "question_grounded_in"             # → article (legal_article_id)
    ARTICLE_BELONGS_TO_SUBJECT = "article_belongs_to_subject"
    ARTICLE_BELONGS_TO_TOPIC = "article_belongs_to_topic"
    FLASHCARD_DERIVED_FROM = "flashcard_derived_from"         # → question
    FLASHCARD_BASED_ON = "flashcard_based_on"                 # → article


@dataclass(frozen=True)
class KnowledgeEdge:
    source_id: str
    target_id: str
    edge_type: EdgeType
    weight: float = 1.0
