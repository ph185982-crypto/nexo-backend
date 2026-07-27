"""Reviews router — spaced repetition cards, flashcards."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from uuid import UUID

from prf.models.study import (
    ReviewCardOut, ReviewSubmission, ReviewResult,
    ReviewDueSummary, FlashcardOut, FlashcardCreate,
)
from prf.routers.deps import get_repo, get_current_user_id, get_study_service
from prf.database.repository import PRFRepository
from prf.services.study_service import StudyService

router = APIRouter()


@router.get("/due", response_model=list[ReviewCardOut])
async def get_due_reviews(
    limit: int = Query(default=20, ge=1, le=50),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Get review cards that are due."""
    cards = await repo.get_due_review_cards(user_id, limit=limit)
    return [
        ReviewCardOut(
            id=c["id"],
            question_id=c.get("question_id"),
            flashcard_id=c.get("flashcard_id"),
            article_id=c.get("article_id"),
            next_review=c["next_review"],
            interval_days=c["interval_days"],
            repetitions=c["repetitions"],
            ease_factor=c["ease_factor"],
            streak=c["streak"],
            content_preview=c.get("question_text") or c.get("flashcard_front"),
            subject_name=c.get("subject_name"),
        )
        for c in cards
    ]


@router.get("/summary", response_model=ReviewDueSummary)
async def review_summary(
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Get a summary of pending reviews."""
    cards = await repo.get_due_review_cards(user_id, limit=100)
    from prf.engines.spaced_review import cards_due_count
    counts = cards_due_count([{"next_review": c["next_review"]} for c in cards])

    by_subject: dict[str, int] = {}
    for c in cards:
        subj = c.get("subject_name", "Outros")
        by_subject[subj] = by_subject.get(subj, 0) + 1

    return ReviewDueSummary(
        total_due=counts["total_due"],
        overdue=counts["overdue"],
        due_today=counts["due_today"],
        due_tomorrow=counts["due_tomorrow"],
        by_subject=by_subject,
    )


@router.post("/submit", response_model=ReviewResult)
async def submit_review(
    body: ReviewSubmission,
    user_id: UUID = Depends(get_current_user_id),
    study: StudyService = Depends(get_study_service),
):
    """Submit a review quality rating for a card."""
    result = await study.process_review(
        user_id=user_id,
        card_id=body.card_id,
        quality_str=body.quality.value,
    )
    return ReviewResult(
        card_id=result["card_id"],
        new_interval_days=result["new_interval_days"],
        new_ease_factor=result["new_ease_factor"],
        next_review=result["next_review"],
        xp_earned=result["xp_earned"],
    )


@router.post("/flashcards", response_model=FlashcardOut)
async def create_flashcard(
    body: FlashcardCreate,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Create a custom flashcard."""
    card = await repo._fetchrow(
        """INSERT INTO flashcards (user_id, subject_id, topic_id, question_id,
           article_id, front, back, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'user')
           RETURNING *""",
        user_id, body.subject_id, body.topic_id, body.question_id,
        body.article_id, body.front, body.back,
    )
    return FlashcardOut(
        id=card["id"],
        front=card["front"],
        back=card["back"],
        source="user",
    )
