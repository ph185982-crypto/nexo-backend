"""Questions router — question bank, answering, error notebook."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from uuid import UUID

from prf.models.question import (
    QuestionOut, AlternativeOut, AnswerSubmission, AnswerResult,
    QuestionFilter, ErrorNotebookEntry,
)
from prf.routers.deps import get_repo, get_current_user_id, get_study_service
from prf.database.repository import PRFRepository
from prf.services.study_service import StudyService

router = APIRouter()


@router.get("/list")
async def list_questions(
    subject_id: Optional[UUID] = None,
    topic_id: Optional[UUID] = None,
    difficulty: Optional[str] = None,
    question_type: Optional[str] = None,
    limit: int = Query(default=10, ge=1, le=100),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Get questions from the bank with optional filters."""
    questions = await repo.get_questions(
        subject_id=subject_id,
        topic_id=topic_id,
        difficulty=difficulty,
        question_type=question_type,
        limit=limit,
    )

    results = []
    for q in questions:
        alts_raw = await repo._fetch(
            "SELECT id, letter, text, display_order FROM question_alternatives WHERE question_id = $1 ORDER BY display_order",
            q["id"],
        )
        results.append({
            "id": q["id"],
            "subject_id": q["subject_id"],
            "subject_name": q.get("subject_name"),
            "topic_id": q.get("topic_id"),
            "question_type": q.get("question_type", "certo_errado"),
            "context_text": q.get("context_text"),
            "text": q["text"],
            "difficulty": q["difficulty"],
            "source": q.get("source"),
            "year": q.get("year"),
            "examiner": q.get("examiner"),
            "tags": q.get("tags", []),
            "alternatives": [
                {"id": a["id"], "letter": a["letter"], "text": a["text"], "display_order": a["display_order"]}
                for a in alts_raw
            ],
        })

    return {"questions": results, "total": len(results)}


@router.get("/{question_id}")
async def get_question(
    question_id: UUID,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Get a single question with alternatives (no correct answer revealed)."""
    q = await repo.get_question_with_alternatives(question_id)
    if not q:
        raise HTTPException(404, "Question not found")

    return {
        "id": q["id"],
        "question_type": q.get("question_type", "certo_errado"),
        "context_text": q.get("context_text"),
        "text": q["text"],
        "difficulty": q["difficulty"],
        "subject_name": q.get("subject_name"),
        "alternatives": [
            {"id": a["id"], "letter": a["letter"], "text": a["text"]}
            for a in q["alternatives"]
        ],
    }


@router.post("/answer", response_model=AnswerResult)
async def answer_question(
    body: AnswerSubmission,
    user_id: UUID = Depends(get_current_user_id),
    study: StudyService = Depends(get_study_service),
):
    """Submit an answer and get detailed feedback."""
    result = await study.process_answer(
        user_id=user_id,
        question_id=body.question_id,
        selected_alt_id=body.selected_alternative_id,
        time_spent=body.time_spent_secs,
        confidence=body.confidence,
    )

    correct = result["correct_alternative"]
    selected = result["selected_alternative"]

    return AnswerResult(
        is_correct=result["is_correct"],
        correct_alternative=AlternativeOut(
            id=correct["id"], letter=correct["letter"],
            text=correct["text"], display_order=correct.get("display_order", 0),
        ),
        selected_alternative=AlternativeOut(
            id=selected["id"], letter=selected["letter"],
            text=selected["text"], display_order=selected.get("display_order", 0),
        ),
        explanation=result.get("explanation"),
        legal_basis=result.get("legal_basis"),
        alternative_explanations=result.get("alternative_explanations", {}),
        review_scheduled=result["review_scheduled"],
        xp_earned=result["xp_earned"],
        error_recorded=result["error_recorded"],
    )


@router.get("/errors/notebook")
async def error_notebook(
    subject_id: Optional[UUID] = None,
    limit: int = Query(default=50, ge=1, le=200),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Get the user's error notebook."""
    errors = await repo.get_error_notebook(user_id, limit=limit, subject_id=subject_id)
    return {
        "errors": [
            ErrorNotebookEntry(
                id=e["id"],
                question_id=e["question_id"],
                question_text=e.get("question_text", ""),
                subject_name=e.get("subject_name", ""),
                error_summary=e.get("error_summary"),
                error_type=e.get("error_type"),
                times_repeated=e.get("times_repeated", 1),
                resolved=e.get("resolved", False),
                created_at=e["created_at"],
                last_error_at=e.get("last_error_at", e["created_at"]),
            )
            for e in errors
        ],
        "total": len(errors),
    }
