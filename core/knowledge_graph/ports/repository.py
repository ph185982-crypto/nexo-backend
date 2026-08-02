from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Protocol
from uuid import UUID


# ── Raw data from DB (no domain logic) ───────────────────────────────

@dataclass
class SubjectData:
    id: UUID
    slug: str
    name: str
    weight_prf: float
    weight_pm: float
    is_active: bool


@dataclass
class TopicData:
    id: UUID
    subject_id: UUID
    name: str
    slug: str
    weight: float
    parent_topic_id: Optional[UUID]
    is_active: bool


@dataclass
class QuestionData:
    """Lightweight — only structural fields, no question text."""
    id: UUID
    subject_id: UUID
    topic_id: Optional[UUID]
    legal_article_id: Optional[UUID]
    question_type: str
    difficulty: str
    is_active: bool


@dataclass
class ArticleData:
    """Lightweight — only structural fields, no article text."""
    id: UUID
    document_id: UUID
    subject_id: Optional[UUID]
    topic_id: Optional[UUID]
    article_number: str
    title: Optional[str]
    frequency_score: float          # how often this article is tested


@dataclass
class FlashcardData:
    id: UUID
    subject_id: Optional[UUID]
    topic_id: Optional[UUID]
    question_id: Optional[UUID]
    article_id: Optional[UUID]


@dataclass
class UserMasteryData:
    subject_id: UUID
    topic_id: Optional[UUID]        # None = subject-level mastery
    mastery_level: float            # 0-1 from DB (mastery_level column)
    total_attempts: int
    total_correct: int
    accuracy: float
    last_studied: Optional[datetime]
    error_count: int                # from subject_mastery.error_count


@dataclass
class UserErrorData:
    question_id: UUID
    subject_id: Optional[UUID]
    topic_id: Optional[UUID]
    times_repeated: int
    resolved: bool
    last_error_at: datetime


@dataclass
class UserReviewCardData:
    question_id: Optional[UUID]
    article_id: Optional[UUID]
    flashcard_id: Optional[UUID]
    next_review: datetime
    ease_factor: float
    total_reviews: int
    total_correct: int
    is_overdue: bool                # computed by caller (next_review < now)


# ── Port (Protocol) ──────────────────────────────────────────────────

class KnowledgeGraphRepositoryPort(Protocol):
    """
    Read-only structural and user-specific data for graph construction.
    Implementations live in the infrastructure layer and talk to asyncpg/Supabase.
    All methods return lightweight data objects — no rendering logic.
    """

    async def get_subjects(self) -> list[SubjectData]: ...

    async def get_topics(self) -> list[TopicData]: ...

    async def get_questions_index(self) -> list[QuestionData]: ...

    async def get_articles_index(self) -> list[ArticleData]: ...

    async def get_flashcards_index(self) -> list[FlashcardData]: ...

    async def get_user_mastery(self, user_id: UUID) -> list[UserMasteryData]: ...

    async def get_user_errors(
        self, user_id: UUID, resolved: bool = False
    ) -> list[UserErrorData]: ...

    async def get_user_review_cards(
        self, user_id: UUID
    ) -> list[UserReviewCardData]: ...
