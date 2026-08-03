"""
LawLearningRepositoryPort — guides infrastructure adapters.

This Protocol is NOT consumed by LawLearningEngine. It documents what data
callers must fetch before assembling ArticleContext. Infrastructure adapters
(e.g., Supabase repositories) should implement this interface.
"""
from __future__ import annotations

from typing import Optional, Protocol, runtime_checkable
from uuid import UUID

from .context import (
    ArticleSnapshot,
    PersonalProgressSnapshot,
    RelatedContentSnapshot,
)


@runtime_checkable
class LawLearningRepositoryPort(Protocol):
    """
    Data access contract for the Law Learning infrastructure layer.

    Callers assemble ArticleContext by calling these methods and mapping
    results to the snapshot types. The engine never calls these directly.
    """

    async def get_article(self, article_id: UUID) -> Optional[ArticleSnapshot]:
        """Fetch a single article by ID from legal_articles + legal_documents."""
        ...

    async def get_articles_by_document(
        self,
        document_id: UUID,
        limit: int = 50,
        offset: int = 0,
    ) -> list[ArticleSnapshot]:
        """Fetch all articles for a legal document, ordered by article_number."""
        ...

    async def get_personal_progress(
        self,
        user_id: UUID,
        article_id: UUID,
    ) -> Optional[PersonalProgressSnapshot]:
        """
        Aggregate user's history with this article's questions.
        Reads: question_attempts, error_notebook, review_cards.
        """
        ...

    async def get_related_content(
        self,
        article_id: UUID,
        user_id: UUID,
    ) -> RelatedContentSnapshot:
        """
        Fetch KGE-sourced related content for this article.
        Reads: knowledge_graph edges, question ↔ article mappings.
        """
        ...

    async def search_articles(
        self,
        query: str,
        subject_id: Optional[UUID] = None,
        limit: int = 20,
    ) -> list[ArticleSnapshot]:
        """Full-text search over official_text, simple_text, tags."""
        ...
