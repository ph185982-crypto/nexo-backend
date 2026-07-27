"""Legal library router — browse laws, articles, bookmarks."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from uuid import UUID

from prf.models.legal import (
    LegalDocumentOut, LegalArticleOut, LegalArticleDetail,
    BookmarkRequest, LegalSearchResult,
)
from prf.routers.deps import get_repo, get_current_user_id
from prf.database.repository import PRFRepository

router = APIRouter()


@router.get("/documents", response_model=list[LegalDocumentOut])
async def list_documents(repo: PRFRepository = Depends(get_repo)):
    """List all legal documents (CF, CP, CPP, CTB, etc.)."""
    docs = await repo.get_legal_documents()
    return [
        LegalDocumentOut(
            id=d["id"],
            name=d["name"],
            slug=d["slug"],
            abbreviation=d.get("abbreviation"),
            description=d.get("description"),
            article_count=d.get("article_count", 0),
        )
        for d in docs
    ]


@router.get("/articles", response_model=list[LegalArticleOut])
async def list_articles(
    document_id: Optional[UUID] = None,
    subject_id: Optional[UUID] = None,
    search: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """List legal articles with optional filtering."""
    articles = await repo.get_legal_articles(
        document_id=document_id,
        subject_id=subject_id,
        search=search,
        limit=limit,
    )

    bookmarks = await repo._fetch(
        "SELECT article_id FROM user_legal_bookmarks WHERE user_id = $1",
        user_id,
    )
    bookmark_ids = {b["article_id"] for b in bookmarks}

    return [
        LegalArticleOut(
            id=a["id"],
            document_id=a["document_id"],
            document_name=a.get("document_name"),
            article_number=a["article_number"],
            title=a.get("title"),
            official_text=a["official_text"],
            simple_text=a.get("simple_text"),
            highlights=a.get("highlights", []),
            frequency_score=a.get("frequency_score", 0),
            chapter=a.get("chapter"),
            section=a.get("section"),
            is_bookmarked=a["id"] in bookmark_ids,
        )
        for a in articles
    ]


@router.get("/articles/{article_id}", response_model=LegalArticleDetail)
async def get_article(
    article_id: UUID,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Get a single legal article with related content."""
    article = await repo.get_legal_article(article_id)
    if not article:
        raise HTTPException(404, "Article not found")

    bookmark = await repo._fetchrow(
        "SELECT id FROM user_legal_bookmarks WHERE user_id = $1 AND article_id = $2",
        user_id, article_id,
    )

    related_q = await repo._fetch(
        "SELECT id FROM questions WHERE legal_article_id = $1 LIMIT 10",
        article_id,
    )
    related_f = await repo._fetch(
        "SELECT id FROM flashcards WHERE article_id = $1 LIMIT 10",
        article_id,
    )

    return LegalArticleDetail(
        id=article["id"],
        document_id=article["document_id"],
        document_name=article.get("document_name"),
        article_number=article["article_number"],
        title=article.get("title"),
        official_text=article["official_text"],
        simple_text=article.get("simple_text"),
        highlights=article.get("highlights", []),
        frequency_score=article.get("frequency_score", 0),
        chapter=article.get("chapter"),
        section=article.get("section"),
        is_bookmarked=bookmark is not None,
        related_questions=[r["id"] for r in related_q],
        related_flashcards=[r["id"] for r in related_f],
    )


@router.post("/bookmarks")
async def toggle_bookmark(
    body: BookmarkRequest,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Toggle a bookmark on a legal article."""
    is_bookmarked = await repo.toggle_bookmark(user_id, body.article_id, body.note)
    return {"bookmarked": is_bookmarked, "article_id": body.article_id}


@router.get("/bookmarks")
async def list_bookmarks(
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Get all bookmarked articles."""
    bookmarks = await repo._fetch(
        """SELECT ulb.*, la.article_number, la.official_text, la.simple_text,
                  ld.name as document_name
           FROM user_legal_bookmarks ulb
           JOIN legal_articles la ON la.id = ulb.article_id
           JOIN legal_documents ld ON ld.id = la.document_id
           WHERE ulb.user_id = $1
           ORDER BY ulb.created_at DESC""",
        user_id,
    )
    return {"bookmarks": bookmarks}


@router.get("/search", response_model=LegalSearchResult)
async def search_articles(
    q: str = Query(min_length=2),
    limit: int = Query(default=20, ge=1, le=100),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Full-text search across legal articles."""
    articles = await repo.get_legal_articles(search=q, limit=limit)

    bookmarks = await repo._fetch(
        "SELECT article_id FROM user_legal_bookmarks WHERE user_id = $1", user_id
    )
    bookmark_ids = {b["article_id"] for b in bookmarks}

    return LegalSearchResult(
        articles=[
            LegalArticleOut(
                id=a["id"],
                document_id=a["document_id"],
                document_name=a.get("document_name"),
                article_number=a["article_number"],
                title=a.get("title"),
                official_text=a["official_text"],
                simple_text=a.get("simple_text"),
                highlights=a.get("highlights", []),
                frequency_score=a.get("frequency_score", 0),
                is_bookmarked=a["id"] in bookmark_ids,
            )
            for a in articles
        ],
        total=len(articles),
        query=q,
    )
