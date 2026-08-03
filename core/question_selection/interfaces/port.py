"""
QuestionSelectionPort — documentation-only persistence contract.

This port is NOT imported by the engine. It guides callers on how to
load QuestionSnapshot objects from a database and assemble the context.

Pattern: Port-as-documentation (see architecture decision in README).
"""
from __future__ import annotations

from typing import Optional, Protocol, runtime_checkable
from uuid import UUID


@runtime_checkable
class QuestionSelectionPort(Protocol):
    """
    Implemented by infrastructure adapters (Supabase, SQLite, etc.).

    The engine never calls these methods directly. The caller calls them
    before constructing QuestionSelectionContext.
    """

    def get_question_snapshots(
        self,
        user_id: UUID,
        subject_ids: Optional[list[UUID]] = None,
        limit: int = 200,
    ) -> list:
        """
        Fetch QuestionSnapshot objects for the selection pool.

        Should return questions ordered by exam_frequency DESC.
        Include user-specific history (times_answered, last_answered_at).
        """
        ...

    def get_review_backlog(self, user_id: UUID) -> list:
        """
        Return question UUIDs whose next_review_at <= now (spaced repetition).

        Maps to: SELECT question_id FROM user_question_progress
                 WHERE user_id = %s AND next_review_at <= NOW()
        """
        ...

    def get_recent_error_ids(self, user_id: UUID, limit: int = 50) -> list:
        """
        Return recent incorrect question UUIDs (from Error Intelligence).

        Maps to: SELECT question_id FROM user_errors
                 WHERE user_id = %s ORDER BY created_at DESC LIMIT %s
        """
        ...

    def get_session_question_ids(self, session_id: UUID) -> list:
        """
        Return question UUIDs already presented in the current session.
        Used to build session_questions in context.
        """
        ...
