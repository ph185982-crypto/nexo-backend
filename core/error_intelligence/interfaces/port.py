"""
ErrorRepositoryPort — read-only data contract for infrastructure adapters.

The Error Intelligence Engine itself does NOT use this port directly.
It is provided so that callers know exactly what data to fetch before
assembling an ErrorContext.

An adapter that implements this protocol can be used in service layer
code to build ErrorContext objects from the database.
"""
from __future__ import annotations

from typing import Optional, Protocol, runtime_checkable
from uuid import UUID

from .context import (
    PreviousAttemptSnapshot,
    ErrorEntrySnapshot,
    ReviewCardSnapshot,
    MasterySnapshot,
    SessionSnapshot,
)


@runtime_checkable
class ErrorRepositoryPort(Protocol):
    """
    Read-only port for fetching the data needed to build ErrorContext.

    Infrastructure adapters implement this against the existing tables:
    - question_attempts
    - error_notebook
    - review_cards
    - subject_mastery
    - study_sessions
    """

    async def get_question_attempts(
        self,
        user_id: UUID,
        question_id: UUID,
        limit: int = 20,
    ) -> list[PreviousAttemptSnapshot]:
        """
        Returns the user's previous attempts on this specific question,
        ordered by answered_at descending (most recent first).
        Maps from: question_attempts WHERE user_id=X AND question_id=Y
        """
        ...

    async def get_error_entry(
        self,
        user_id: UUID,
        question_id: UUID,
    ) -> Optional[ErrorEntrySnapshot]:
        """
        Returns the error_notebook entry for this user × question, if it exists.
        Maps from: error_notebook WHERE user_id=X AND question_id=Y
        """
        ...

    async def get_review_card(
        self,
        user_id: UUID,
        question_id: UUID,
    ) -> Optional[ReviewCardSnapshot]:
        """
        Returns the SM-2 review card for this user × question, if it exists.
        Maps from: review_cards WHERE user_id=X AND question_id=Y
        """
        ...

    async def get_mastery(
        self,
        user_id: UUID,
        subject_id: UUID,
        topic_id: Optional[UUID] = None,
    ) -> Optional[MasterySnapshot]:
        """
        Returns mastery record for user × subject (and optionally topic).
        Maps from: subject_mastery WHERE user_id=X AND subject_id=Y [AND topic_id=Z]
        """
        ...

    async def get_session(
        self,
        session_id: UUID,
        position_in_session: int,
    ) -> Optional[SessionSnapshot]:
        """
        Returns session context enriched with question position.
        Maps from: study_sessions joined with question_attempts count.
        """
        ...

    async def get_recent_error_entries(
        self,
        user_id: UUID,
        limit: int = 100,
    ) -> list[ErrorEntrySnapshot]:
        """
        Returns recent unresolved error entries for pattern detection.
        Maps from: error_notebook WHERE user_id=X AND resolved=FALSE ORDER BY last_error_at DESC
        """
        ...

    async def get_recent_attempts(
        self,
        user_id: UUID,
        days: int = 30,
        limit: int = 500,
    ) -> list[PreviousAttemptSnapshot]:
        """
        Returns recent attempt history for pattern detection.
        Maps from: question_attempts WHERE user_id=X AND created_at > NOW()-interval
        """
        ...
