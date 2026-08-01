from __future__ import annotations
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Protocol
from uuid import UUID

from ..interfaces.inputs import (
    DecisionInput, SubjectMasterySnapshot, TopicSnapshot,
    ReviewQueueItem, RecentError, MissionHistoryEntry,
)
from ..interfaces.outputs import MissionPlan
from ..engine import DecisionEngine


class DecisionEngineRepositoryPort(Protocol):
    """
    Port (interface) the MissionBuilder depends on.
    The concrete adapter lives in the infrastructure layer and talks to the DB.
    Anything that implements these methods can be injected.
    """

    async def get_mastery_snapshots(
        self, user_id: UUID, target_exam: str
    ) -> list[SubjectMasterySnapshot]: ...

    async def get_review_queue(
        self, user_id: UUID, limit: int = 50
    ) -> list[ReviewQueueItem]: ...

    async def get_recent_errors(
        self, user_id: UUID, days: int = 7
    ) -> list[RecentError]: ...

    async def get_mission_history(
        self, user_id: UUID, limit: int = 14
    ) -> list[MissionHistoryEntry]: ...

    async def get_approval_estimate(self, user_id: UUID, target_exam: str) -> float: ...

    async def get_streak(self, user_id: UUID) -> int: ...

    async def get_days_until_exam(
        self, user_id: UUID, target_exam: str
    ) -> int | None: ...


class MissionBuilder:
    """
    Assembles a DecisionInput from the repository, runs the engine, returns a plan.
    This is the only class that bridges infrastructure (repo) and domain (engine).
    """

    def __init__(
        self,
        repo: DecisionEngineRepositoryPort,
        engine: DecisionEngine | None = None,
    ) -> None:
        self._repo = repo
        self._engine = engine or DecisionEngine()

    async def build_mission(
        self,
        user_id: UUID,
        target_exam: str,
        available_minutes: int = 30,
        current_hour: int | None = None,
    ) -> MissionPlan:
        if current_hour is None:
            current_hour = datetime.now(timezone.utc).hour

        (
            mastery_snapshots,
            review_queue,
            recent_errors,
            mission_history,
            approval_estimate,
            streak,
            days_until_exam,
        ) = await _gather(
            self._repo.get_mastery_snapshots(user_id, target_exam),
            self._repo.get_review_queue(user_id),
            self._repo.get_recent_errors(user_id),
            self._repo.get_mission_history(user_id),
            self._repo.get_approval_estimate(user_id, target_exam),
            self._repo.get_streak(user_id),
            self._repo.get_days_until_exam(user_id, target_exam),
        )

        inp = DecisionInput(
            user_id=user_id,
            target_exam=target_exam,
            available_minutes=available_minutes,
            current_hour=current_hour,
            mastery_snapshots=mastery_snapshots,
            review_queue=review_queue,
            recent_errors=recent_errors,
            mission_history=mission_history,
            days_until_exam=days_until_exam,
            streak_days=streak,
            approval_estimate=approval_estimate,
        )

        return self._engine.decide(inp)


async def _gather(*coros):
    """asyncio.gather but without importing asyncio at module level."""
    import asyncio
    return await asyncio.gather(*coros)
