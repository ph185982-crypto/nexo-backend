from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from .interfaces.observations import AttemptRecord, SessionRecord
from .interfaces.port import LearningRepositoryPort
from .interfaces.profile import LearningProfile
from .services.profile_builder import LearningProfileBuilder


class LearningEngine:
    """
    Main entry point for all cognitive learning queries.

    Responsibilities:
    - Fetch raw data from the repository port.
    - Orchestrate LearningProfileBuilder to compute a LearningProfile.
    - Cache profiles in memory (per user, per exam; stale after 24h by default).
    - Expose `observe_*` methods so other layers can signal new data without
      directly triggering a full recomputation.

    Restrictions:
    - Never modifies any other engine's data.
    - Never generates missions, flashcards, reviews, or summaries.
    - Never calculates approval probability.
    - Read-only from the infrastructure; write-only via observation signals.
    """

    def __init__(
        self,
        repo: LearningRepositoryPort,
        profile_max_age_hours: int = 24,
    ) -> None:
        self._repo = repo
        self._builder = LearningProfileBuilder()
        self._max_age_hours = profile_max_age_hours
        # Cache: (user_id, target_exam) → LearningProfile
        self._cache: dict[tuple[UUID, str], LearningProfile] = {}

    # ── Public interface ──────────────────────────────────────────────

    async def get_profile(
        self,
        user_id: UUID,
        target_exam: str,
        force_refresh: bool = False,
    ) -> LearningProfile:
        """
        Return a LearningProfile for this user/exam combination.

        The profile is recomputed when:
        - It doesn't exist yet (new user).
        - It is older than max_age_hours (default 24h).
        - force_refresh=True is passed.

        All other calls return the cached profile at zero cost.
        """
        cache_key = (user_id, target_exam.upper())

        if not force_refresh:
            cached = self._cache.get(cache_key)
            if cached and cached.is_fresh(self._max_age_hours):
                return cached

        profile = await self._build_profile(user_id, target_exam)
        self._cache[cache_key] = profile
        return profile

    async def observe_attempt(
        self,
        user_id: UUID,
        target_exam: str,
        attempt: AttemptRecord,
    ) -> None:
        """
        Signal that a new question attempt was recorded.
        Invalidates the cached profile so the next get_profile() recomputes.
        This is a lightweight signal — no computation happens here.
        """
        cache_key = (user_id, target_exam.upper())
        self._cache.pop(cache_key, None)

    async def observe_session(
        self,
        user_id: UUID,
        target_exam: str,
        session: SessionRecord,
    ) -> None:
        """
        Signal that a study session completed.
        Invalidates cached profile — session data drives fatigue, format, sequence analysis.
        """
        cache_key = (user_id, target_exam.upper())
        self._cache.pop(cache_key, None)

    def evict(self, user_id: UUID, target_exam: str) -> None:
        """Manually invalidate a cached profile."""
        self._cache.pop((user_id, target_exam.upper()), None)

    def evict_all(self) -> None:
        """Clear all cached profiles (e.g. on application shutdown)."""
        self._cache.clear()

    # ── Private ───────────────────────────────────────────────────────

    async def _build_profile(self, user_id: UUID, target_exam: str) -> LearningProfile:
        """Fetch all required data concurrently and build the profile."""
        (
            attempts,
            sessions,
            cards,
            errors,
            mastery,
            behavior,
        ) = await asyncio.gather(
            self._repo.get_attempt_history(user_id),
            self._repo.get_session_history(user_id),
            self._repo.get_review_cards(user_id),
            self._repo.get_error_history(user_id),
            self._repo.get_mastery_records(user_id),
            self._repo.get_behavior_metrics(user_id),
        )

        return self._builder.build(
            user_id=user_id,
            target_exam=target_exam,
            attempts=attempts,
            sessions=sessions,
            cards=cards,
            errors=errors,
            mastery=mastery,
            behavior=behavior,
        )
