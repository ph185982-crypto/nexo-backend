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
    """Get questions from the bank with optional filters.

    Prioriza questões que o usuário ainda não respondeu — sem isso a mesma
    questão reaparece na missão do dia seguinte mesmo já tendo sido
    respondida. Só reusa respondidas quando o recorte (matéria/tópico) não
    tem estoque suficiente de inéditas, pra não deixar o bloco vazio."""
    answered_ids = await repo.get_answered_question_ids(user_id)
    questions = await repo.get_questions(
        subject_id=subject_id,
        topic_id=topic_id,
        difficulty=difficulty,
        question_type=question_type,
        limit=limit,
        exclude_ids=answered_ids or None,
    )
    if len(questions) < limit:
        seen = {q["id"] for q in questions}
        extra = await repo.get_questions(
            subject_id=subject_id,
            topic_id=topic_id,
            difficulty=difficulty,
            question_type=question_type,
            limit=limit - len(questions),
        )
        questions += [q for q in extra if q["id"] not in seen]

    # Batch-fetch all alternatives in one query (avoids N+1)
    q_ids = [q["id"] for q in questions]
    alts_map = await repo.get_alternatives_batch(q_ids)

    results = [
        {
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
                for a in alts_map.get(q["id"], [])
            ],
        }
        for q in questions
    ]

    return {"questions": results, "total": len(results)}


@router.get("/history")
async def get_history(
    limit: int = Query(default=50, ge=1, le=200),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Return the user's recent question attempts with question text and result."""
    rows = await repo._fetch(
        """SELECT qa.id, qa.question_id, qa.is_correct, qa.time_spent_secs,
                  qa.created_at, q.text, q.context_text, q.question_type,
                  s.name AS subject_name,
                  ca.letter AS selected_letter, ca.text AS selected_text,
                  cr.letter AS correct_letter, cr.text AS correct_text
           FROM question_attempts qa
           JOIN questions q ON q.id = qa.question_id
           LEFT JOIN subjects s ON s.id = q.subject_id
           LEFT JOIN question_alternatives ca ON ca.id = qa.selected_alt_id
           LEFT JOIN question_alternatives cr ON cr.question_id = q.id AND cr.is_correct = TRUE
           WHERE qa.user_id = $1
           ORDER BY qa.created_at DESC LIMIT $2""",
        user_id, limit,
    )
    return {"history": [dict(r) for r in rows], "total": len(rows)}


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


@router.get("/smart")
async def smart_next_question(
    exam: str = Query(default="PRF", description="PRF ou PMGO"),
    subject_id: Optional[UUID] = None,
    exclude: Optional[str] = Query(default=None, description="Comma-separated question UUIDs to exclude"),
    question_type: Optional[str] = None,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """
    Smart question selection biased toward subjects with low coverage.

    With 70% probability selects from the weakest covered subject for the exam;
    with 30% picks any subject. Falls back to random if coverage data unavailable.
    """
    import random
    from prf.seeds.seed_data import SUBJECTS
    from core.coverage_audit import CoverageAuditor
    from core.coverage_audit.models import CoverageFlag

    exclude_ids: set[UUID] = set()
    if exclude:
        for raw in exclude.split(","):
            raw = raw.strip()
            if raw:
                try:
                    exclude_ids.add(UUID(raw))
                except ValueError:
                    pass

    # If caller pinned a subject, use it directly
    if subject_id:
        return await _fetch_question(repo, subject_id, question_type, exclude_ids)

    # Load coverage to find weak subjects
    target_subject_id: Optional[UUID] = None
    try:
        all_questions = await repo.get_questions_for_coverage()
        auditor = CoverageAuditor(exam=exam.upper())
        report = auditor.audit(questions=all_questions, subjects=SUBJECTS)

        weight_key = "weight_pm" if exam.upper() == "PMGO" else "weight_prf"
        # Subjects with CRITICAL or LOW flag, weighted by priority_score
        weak = [sc for sc in report.subject_coverage
                if sc.flag in (CoverageFlag.CRITICAL, CoverageFlag.LOW, CoverageFlag.EMPTY)]
        if weak and random.random() < 0.70:
            # Pick a weak subject weighted by priority_score
            total_priority = sum(sc.priority_score for sc in weak) or 1
            r = random.uniform(0, total_priority)
            cumulative = 0.0
            for sc in weak:
                cumulative += sc.priority_score
                if r <= cumulative:
                    # Resolve slug → subject UUID
                    row = await repo._fetchrow(
                        "SELECT id FROM subjects WHERE slug = $1", sc.subject_slug
                    )
                    if row:
                        target_subject_id = row["id"]
                    break
    except Exception:
        pass  # fall back to random

    return await _fetch_question(repo, target_subject_id, question_type, exclude_ids)


async def _fetch_question(
    repo: PRFRepository,
    subject_id: Optional[UUID],
    question_type: Optional[str],
    exclude_ids: set,
) -> dict:
    """Fetch one question, excluding already-seen ids."""
    questions = await repo.get_questions(
        subject_id=subject_id,
        question_type=question_type,
        limit=30,
    )
    available = [q for q in questions if q["id"] not in exclude_ids]
    if not available:
        # Try without subject filter
        questions = await repo.get_questions(question_type=question_type, limit=30)
        available = [q for q in questions if q["id"] not in exclude_ids]
    if not available:
        from fastapi import HTTPException
        raise HTTPException(404, "No questions available")

    import random
    q = random.choice(available)
    alts_raw = await repo._fetch(
        "SELECT id, letter, text, display_order FROM question_alternatives WHERE question_id = $1 ORDER BY display_order",
        q["id"],
    )
    return {
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
    }


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
