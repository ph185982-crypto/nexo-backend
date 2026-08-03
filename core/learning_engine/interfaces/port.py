"""
LearningRepositoryPort — the only boundary between Learning Engine and infrastructure.
Implementations live in the infrastructure layer (asyncpg/Supabase).
"""
from __future__ import annotations
from typing import Optional, Protocol
from uuid import UUID

from .observations import (
    AttemptRecord,
    BehaviorMetricsRecord,
    ErrorRecord,
    MasteryRecord,
    ReviewCardRecord,
    SessionRecord,
)


class LearningRepositoryPort(Protocol):
    """
    Read-only access to raw study data.
    All methods return plain data objects — no rendering, no domain logic.
    The engine calls these; infrastructure implements them.
    """

    async def get_attempt_history(
        self,
        user_id: UUID,
        limit: int = 300,
    ) -> list[AttemptRecord]:
        """
        Recent question attempts, newest first.
        Joins with questions table to supply subject_id / topic_id.
        """
        ...

    async def get_session_history(
        self,
        user_id: UUID,
        limit: int = 60,
    ) -> list[SessionRecord]:
        """
        Completed study sessions, newest first.
        """
        ...

    async def get_review_cards(
        self,
        user_id: UUID,
    ) -> list[ReviewCardRecord]:
        """
        All SM-2 review cards for the user.
        Joins questions to supply subject_id / topic_id.
        """
        ...

    async def get_error_history(
        self,
        user_id: UUID,
    ) -> list[ErrorRecord]:
        """
        All error notebook entries (resolved and unresolved).
        """
        ...

    async def get_mastery_records(
        self,
        user_id: UUID,
    ) -> list[MasteryRecord]:
        """
        Subject-level and topic-level mastery snapshots.
        """
        ...

    async def get_behavior_metrics(
        self,
        user_id: UUID,
    ) -> Optional[BehaviorMetricsRecord]:
        """
        Pre-aggregated behavioral stats from user_behavior_metrics table.
        Returns None if the user has no history yet.
        """
        ...
