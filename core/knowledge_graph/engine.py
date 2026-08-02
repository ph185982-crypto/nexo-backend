from __future__ import annotations
import asyncio
from typing import Optional
from uuid import UUID

from .graph.builder import GraphBuilder
from .graph.graph import KnowledgeGraph
from .graph.node import NodeType
from .ports.repository import KnowledgeGraphRepositoryPort
from .queries.gap_query import GapAnalysis, GapQuery
from .queries.origin_query import OriginQuery, OriginResult
from .queries.related_query import RelatedContent, RelatedQuery
from .scoring.scorer import NodeScorer, ScoredNode


class KnowledgeGraphEngine:
    """
    Main entry point for all knowledge-graph queries.

    Lifecycle:
    - One engine per application.
    - Call `warm_up()` once at startup to pre-build the static structural graph.
    - Each per-user call fetches fresh user metrics, overlays them, and runs queries.
    - The static graph is never mutated after warm-up.
    """

    def __init__(self, repo: KnowledgeGraphRepositoryPort) -> None:
        self._repo = repo
        self._builder = GraphBuilder()
        self._gap_query = GapQuery()
        self._origin_query = OriginQuery()
        self._related_query = RelatedQuery()
        self._scorer = NodeScorer()
        self._static_graph: Optional[KnowledgeGraph] = None

    # ── Lifecycle ─────────────────────────────────────────────────────

    async def warm_up(self) -> None:
        """
        Pre-load the static structural graph from the DB.
        Call once at application startup (lifespan / startup event).
        """
        self._static_graph = await self._build_static_graph()

    async def _build_static_graph(self) -> KnowledgeGraph:
        subjects, topics, questions, articles, flashcards = await asyncio.gather(
            self._repo.get_subjects(),
            self._repo.get_topics(),
            self._repo.get_questions_index(),
            self._repo.get_articles_index(),
            self._repo.get_flashcards_index(),
        )
        return self._builder.build_static(subjects, topics, questions, articles, flashcards)

    async def _get_user_graph(self, user_id: UUID, target_exam: str) -> KnowledgeGraph:
        """Build a user-specific overlay on top of the static graph."""
        static = self._static_graph
        if static is None:
            # Fallback: build on first use if warm_up wasn't called
            static = await self._build_static_graph()
            self._static_graph = static

        mastery_rows, error_rows, review_rows = await asyncio.gather(
            self._repo.get_user_mastery(user_id),
            self._repo.get_user_errors(user_id, resolved=False),
            self._repo.get_user_review_cards(user_id),
        )

        # Apply exam-specific weight to subject nodes
        static = self._apply_exam_weight(static, target_exam)

        metrics_map = self._builder.build_metrics(
            static, target_exam, mastery_rows, error_rows, review_rows
        )
        return static.overlay_metrics(metrics_map)

    @staticmethod
    def _apply_exam_weight(graph: KnowledgeGraph, target_exam: str) -> KnowledgeGraph:
        """
        Stamp the correct exam weight into each subject node's 'weight' metadata key.
        Returns the same graph (metadata mutation is safe since we own the static graph
        at this point — the overlay will copy nodes).
        """
        weight_field = "weight_prf" if target_exam.upper() != "PMGO" else "weight_pm"
        for node in graph.nodes_of_type(NodeType.SUBJECT):
            node.metadata["weight"] = node.metadata.get(weight_field, 1.0)
        return graph

    # ── Public queries ────────────────────────────────────────────────

    async def get_gap_analysis(
        self,
        user_id: UUID,
        target_exam: str,
        limit: int = 10,
    ) -> GapAnalysis:
        """
        Primary query for the Decision Engine.
        Returns ranked knowledge gaps at subject and topic level.
        """
        graph = await self._get_user_graph(user_id, target_exam)
        return self._gap_query.execute(graph, limit=limit)

    async def find_error_origins(
        self,
        user_id: UUID,
        target_exam: str,
        question_ids: list[UUID],
    ) -> list[OriginResult]:
        """
        'Which article is at the origin of these errors?'
        Traces each question back to its legal article, topic, and related content.
        """
        graph = await self._get_user_graph(user_id, target_exam)
        return self._origin_query.find_origins_for_errors(graph, question_ids)

    async def find_related_content(
        self,
        user_id: UUID,
        target_exam: str,
        node_id: str,
        limit: int = 10,
    ) -> list[RelatedContent]:
        """
        'Which related content should be reviewed now?'
        Traverses the graph from node_id and ranks neighbors by relevance.
        """
        graph = await self._get_user_graph(user_id, target_exam)
        return self._related_query.find_related(graph, node_id, limit=limit)

    async def score_nodes(
        self,
        user_id: UUID,
        target_exam: str,
        node_types: Optional[list[NodeType]] = None,
    ) -> list[ScoredNode]:
        """Raw scoring — useful for custom analytics or the ROI Engine."""
        graph = await self._get_user_graph(user_id, target_exam)
        return self._scorer.score_all(graph, node_types)
