from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from typing import Optional, Protocol, TYPE_CHECKING
from uuid import UUID

from ..interfaces.inputs import (
    DecisionInput, KnowledgeGapSummary, SubjectMasterySnapshot,
    ReviewQueueItem, RecentError, MissionHistoryEntry,
)
from ..interfaces.outputs import MissionPlan
from ..engine import DecisionEngine

if TYPE_CHECKING:
    from ...knowledge_graph.engine import KnowledgeGraphEngine


class DecisionEngineRepositoryPort(Protocol):
    """
    Port the MissionBuilder depends on.
    Concrete adapter in the infrastructure layer talks to asyncpg/Supabase.
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
    ) -> Optional[int]: ...


class MissionBuilder:
    """
    Assembles DecisionInput from the repository + KGE, runs the engine,
    returns a MissionPlan.

    The KnowledgeGraphEngine is optional: if not injected, the Decision Engine
    runs without KGE-enriched gaps (it still uses its own strategies).
    """

    def __init__(
        self,
        repo: DecisionEngineRepositoryPort,
        engine: Optional[DecisionEngine] = None,
        kge: Optional["KnowledgeGraphEngine"] = None,
    ) -> None:
        self._repo = repo
        self._engine = engine or DecisionEngine()
        self._kge = kge

    async def build_mission(
        self,
        user_id: UUID,
        target_exam: str,
        available_minutes: int = 30,
        current_hour: Optional[int] = None,
        kge_limit: int = 5,
    ) -> MissionPlan:
        if current_hour is None:
            current_hour = datetime.now(timezone.utc).hour

        # Run repo queries and optionally KGE gap analysis in parallel
        coros = [
            self._repo.get_mastery_snapshots(user_id, target_exam),
            self._repo.get_review_queue(user_id),
            self._repo.get_recent_errors(user_id),
            self._repo.get_mission_history(user_id),
            self._repo.get_approval_estimate(user_id, target_exam),
            self._repo.get_streak(user_id),
            self._repo.get_days_until_exam(user_id, target_exam),
        ]
        if self._kge is not None:
            coros.append(self._kge.get_gap_analysis(user_id, target_exam, limit=kge_limit))

        results = await asyncio.gather(*coros)

        (
            mastery_snapshots,
            review_queue,
            recent_errors,
            mission_history,
            approval_estimate,
            streak,
            days_until_exam,
        ) = results[:7]

        knowledge_gaps: list[KnowledgeGapSummary] = []
        if self._kge is not None:
            gap_analysis = results[7]
            knowledge_gaps = _gap_analysis_to_summaries(gap_analysis)

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
            knowledge_gaps=knowledge_gaps,
        )

        return self._engine.decide(inp)


def _gap_analysis_to_summaries(gap_analysis) -> list[KnowledgeGapSummary]:
    """Convert GapAnalysis.top_gaps into KnowledgeGapSummary for DecisionInput."""
    summaries = []
    for gap_result in gap_analysis.top_gaps:
        sn = gap_result.scored_node
        summaries.append(
            KnowledgeGapSummary(
                node_id=sn.node.node_id,
                node_type=sn.node.node_type.value,
                label=sn.node.label,
                subject_id=sn.subject_id,
                topic_id=sn.topic_id,
                gap_score=sn.gap_score,
                importance=sn.importance,
                impact_score=sn.impact_score,
                recommended_step=gap_result.recommended_step,
                explanation=gap_result.explanation,
            )
        )
    return summaries
