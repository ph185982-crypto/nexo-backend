"""AI Tutor router — Socratic tutoring conversations."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from uuid import UUID

logger = logging.getLogger(__name__)

from prf.routers.deps import get_repo, get_current_user_id
from prf.database.repository import PRFRepository
from prf.services.ai_tutor_service import start_tutor_session, continue_tutor_session

router = APIRouter()


class TutorStartRequest(BaseModel):
    question_id: UUID
    student_answer: str


class TutorMessageRequest(BaseModel):
    conversation_id: UUID
    message: str


class TutorResponse(BaseModel):
    conversation_id: UUID
    tutor_message: str
    resolved: bool = False
    error_type: Optional[str] = None


@router.post("/start", response_model=TutorResponse)
async def start_tutoring(
    body: TutorStartRequest,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Start a tutoring session after an incorrect answer."""
    question = await repo.get_question_with_alternatives(body.question_id)
    if not question:
        raise HTTPException(404, "Question not found")

    correct_alt = next(
        (a for a in question["alternatives"] if a["is_correct"]),
        None,
    )
    if not correct_alt:
        raise HTTPException(500, "No correct alternative found")

    result = await start_tutor_session(
        question_text=question["text"],
        correct_answer=f"{correct_alt['letter']}) {correct_alt['text']}",
        student_answer=body.student_answer,
        explanation=question.get("explanation"),
        legal_basis=question.get("legal_basis"),
    )

    try:
        conv = await repo.create_tutor_conversation(user_id, {
            "question_id": body.question_id,
            "context": result["context"],
        })
        await repo.update_tutor_conversation(conv["id"], result["messages"])
    except Exception as e:
        logger.exception("Failed to open tutor conversation")
        raise HTTPException(503, f"Não foi possível iniciar o tutor: {e}")

    return TutorResponse(
        conversation_id=conv["id"],
        tutor_message=result["tutor_message"],
    )


@router.post("/message", response_model=TutorResponse)
async def send_message(
    body: TutorMessageRequest,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Continue a tutoring conversation."""
    conv = await repo._fetchrow(
        "SELECT * FROM tutor_conversations WHERE id = $1 AND user_id = $2",
        body.conversation_id, user_id,
    )
    if not conv:
        raise HTTPException(404, "Conversation not found")

    messages = conv.get("messages", [])
    if isinstance(messages, str):
        import json
        messages = json.loads(messages)

    result = await continue_tutor_session(messages, body.message)

    outcome = "understood" if result.get("resolved") else None
    await repo.update_tutor_conversation(
        body.conversation_id, result["messages"], outcome
    )

    if result.get("error_type") and conv.get("question_id"):
        await repo._execute(
            """UPDATE error_notebook SET error_type = $1
               WHERE user_id = $2 AND question_id = $3 AND error_type IS NULL""",
            result["error_type"], user_id, conv["question_id"],
        )

    return TutorResponse(
        conversation_id=body.conversation_id,
        tutor_message=result["tutor_message"],
        resolved=result.get("resolved", False),
        error_type=result.get("error_type"),
    )
