"""Legal library models."""
from __future__ import annotations
from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field


class LegalDocumentOut(BaseModel):
    id: UUID
    name: str
    slug: str
    abbreviation: Optional[str] = None
    description: Optional[str] = None
    article_count: int = 0


class LegalArticleOut(BaseModel):
    id: UUID
    document_id: UUID
    document_name: Optional[str] = None
    article_number: str
    title: Optional[str] = None
    official_text: str
    simple_text: Optional[str] = None
    highlights: list[str] = Field(default_factory=list)
    frequency_score: float = 0
    chapter: Optional[str] = None
    section: Optional[str] = None
    is_bookmarked: bool = False
    subject_name: Optional[str] = None
    topic_name: Optional[str] = None


class LegalArticleDetail(LegalArticleOut):
    related_questions: list[UUID] = Field(default_factory=list)
    related_flashcards: list[UUID] = Field(default_factory=list)


class BookmarkRequest(BaseModel):
    article_id: UUID
    note: Optional[str] = None
    review_later: bool = False


class LegalSearchResult(BaseModel):
    articles: list[LegalArticleOut]
    total: int
    query: str
