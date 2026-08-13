"""Essays router — discursive exam practice with CEBRASPE scoring."""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from typing import Optional
from uuid import UUID

from prf.routers.deps import get_repo, get_current_user_id
from prf.database.repository import PRFRepository
from prf.services.essay_service import correct_essay, ocr_image

router = APIRouter()


@router.get("/themes")
async def list_themes(
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """List essay themes matching the user's exam (PRF, PMGO, or ALL)."""
    profile = await repo.get_profile(user_id)
    is_pm = (profile or {}).get("target_exam", "PMGO").upper().startswith("PM")
    exam_tag = "PMGO" if is_pm else "PRF"
    themes = await repo._fetch(
        "SELECT id, title, description, context_text, subject_area, source, year, exam_tag "
        "FROM essay_themes WHERE is_active = TRUE AND exam_tag IN ($1, 'ALL') "
        "ORDER BY created_at DESC",
        exam_tag,
    )
    return {"themes": [dict(t) for t in themes], "total": len(themes)}


@router.post("/submit")
async def submit_essay(
    theme_title: str = Form(...),
    text: Optional[str] = Form(None),
    image: Optional[UploadFile] = File(None),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Submit an essay for correction. Accepts text or image (OCR)."""
    if not text and not image:
        raise HTTPException(400, "Envie o texto da redação ou uma foto")

    input_type = "text"
    image_path = None

    if image and not text:
        input_type = "image"
        content = await image.read()
        mime = image.content_type or "image/jpeg"
        text = await ocr_image(content, mime)

    theme_row = await repo._fetchrow(
        "SELECT id, title, context_text FROM essay_themes WHERE title = $1",
        theme_title,
    )
    theme_id = theme_row["id"] if theme_row else None
    context = theme_row["context_text"] if theme_row else theme_title

    profile = await repo.get_profile(user_id)
    is_pm = (profile or {}).get("target_exam", "PMGO").upper().startswith("PM")
    banca = "AOCP" if is_pm else "CEBRASPE"

    total_lines = len([l for l in text.strip().split("\n") if l.strip()])
    result = await correct_essay(text, context, total_lines, banca=banca)

    row = await repo._fetchrow(
        """INSERT INTO essays
           (user_id, theme_id, theme_title, input_type, original_text,
            image_path, total_lines, nc_score, ne_count, penalty,
            final_score, diagnosis, feedback_text, banca, max_score)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING id, created_at""",
        user_id, theme_id, theme_title, input_type, text,
        image_path, result["total_lines"], result["nc_score"],
        result["ne_count"], result["penalty"], result["final_score"],
        result["diagnosis"], result["feedback_text"], result["banca"], result["max_score"],
    )

    return {
        "id": row["id"],
        "banca": result["banca"],
        "max_score": result["max_score"],
        "final_score": result["final_score"],
        "nc_score": result["nc_score"],
        "ne_count": result["ne_count"],
        "penalty": result["penalty"],
        "total_lines": result["total_lines"],
        "diagnosis": result["diagnosis"],
        "feedback_text": result["feedback_text"],
        "created_at": row["created_at"],
    }


@router.get("/history")
async def essay_history(
    limit: int = Query(default=20, ge=1, le=100),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Get user's essay history with scores."""
    essays = await repo._fetch(
        """SELECT id, theme_title, input_type, total_lines,
                  nc_score, ne_count, penalty, final_score, banca, max_score, created_at
           FROM essays WHERE user_id = $1
           ORDER BY created_at DESC LIMIT $2""",
        user_id, limit,
    )
    return {"essays": [dict(e) for e in essays], "total": len(essays)}


@router.get("/{essay_id}")
async def get_essay(
    essay_id: UUID,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Get full essay details with diagnosis."""
    essay = await repo._fetchrow(
        """SELECT id, theme_title, input_type, original_text, total_lines,
                  nc_score, ne_count, penalty, final_score, diagnosis,
                  feedback_text, banca, max_score, created_at
           FROM essays WHERE id = $1 AND user_id = $2""",
        essay_id, user_id,
    )
    if not essay:
        raise HTTPException(404, "Redação não encontrada")

    return dict(essay)
