"""Legal library router — browse laws, articles, bookmarks."""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from uuid import UUID

from prf.models.legal import (
    LegalDocumentOut, LegalArticleOut, LegalArticleDetail,
    BookmarkRequest, LegalSearchResult,
)
from prf.routers.deps import get_repo, get_current_user_id
from prf.database.repository import PRFRepository
from prf.services import llm_service

logger = logging.getLogger(__name__)

router = APIRouter()

EXPLAIN_SYSTEM = (
    "Você é professor de cursinho para concursos policiais. Explica a lei seca "
    "em linguagem direta, sem juridiquês, do jeito que faz o aluno lembrar na "
    "hora da prova. Responde exclusivamente em JSON válido."
)


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


@router.post("/articles/{article_id}/explain")
async def explain_article(
    article_id: UUID,
    refresh: bool = Query(False, description="Regenera mesmo se já houver explicação"),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Explica um artigo em linguagem simples, gerando na primeira leitura.

    São mais de 3.500 artigos na biblioteca. Escrever a explicação de todos de
    antemão custaria caro e a maior parte nunca seria aberta, então a explicação
    nasce quando o artigo é lido pela primeira vez e fica gravada — da segunda
    leitura em diante a resposta é imediata e não custa nada.
    """
    article = await repo._fetchrow(
        """SELECT la.id, la.article_number, la.official_text, la.simple_text,
                  la.highlights, ld.name AS document_name
             FROM legal_articles la
             JOIN legal_documents ld ON ld.id = la.document_id
            WHERE la.id = $1""",
        article_id,
    )
    if not article:
        raise HTTPException(404, "Artigo não encontrado")

    if article["simple_text"] and not refresh:
        return {
            "article_id": str(article_id),
            "simple_text": article["simple_text"],
            "highlights": article["highlights"] or [],
            "cached": True,
        }

    prompt = f"""Explique este dispositivo legal para um candidato de concurso policial.

DOCUMENTO: {article['document_name']}
{article['article_number']}
TEXTO OFICIAL:
{article['official_text'][:4000]}

Responda em JSON:
{{"simple_text": "explicação de 3 a 6 linhas, em linguagem direta, dizendo o que o dispositivo determina na prática e qual a pegadinha que a banca costuma fazer com ele",
  "highlights": ["3 a 6 expressões-chave copiadas literalmente do texto oficial, as que a banca troca para tornar o item errado"]}}"""

    try:
        data = await llm_service.chat_json(
            [
                {"role": "system", "content": EXPLAIN_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=900,
        )
    except llm_service.LLMUnavailable as e:
        raise HTTPException(503, f"IA indisponível: {e}")

    simple = (data.get("simple_text") or "").strip()
    if not simple:
        raise HTTPException(502, "A IA não devolveu explicação utilizável")

    highlights = [h for h in (data.get("highlights") or []) if isinstance(h, str) and h.strip()]

    await repo._execute(
        "UPDATE legal_articles SET simple_text = $1, highlights = $2 WHERE id = $3",
        simple, highlights[:6], article_id,
    )

    return {
        "article_id": str(article_id),
        "simple_text": simple,
        "highlights": highlights[:6],
        "cached": False,
    }


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
