from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from ..graph.graph import KnowledgeGraph
from ..graph.node import KnowledgeNode, NodeType


@dataclass
class ScoredNode:
    node: KnowledgeNode
    mastery_score: float        # 0-100
    importance: float           # 0-1
    gap_score: float            # importance × (1 - mastery/100)
    error_pressure: float       # unresolved errors contribution
    review_pressure: float      # overdue review cards contribution
    impact_score: float         # composite ranking score
    subject_id: Optional[UUID]
    topic_id: Optional[UUID]

    @property
    def recommended_step(self) -> str:
        """Heuristic: what kind of study step would most close this gap."""
        if self.review_pressure > 0.1:
            return "review"
        if self.error_pressure > 0.1:
            return "questions"
        if self.mastery_score < 30:
            return "law"       # read the source law first
        if self.mastery_score < 60:
            return "questions"
        return "flashcards"    # reinforce what's almost there


class NodeScorer:
    """Scores KnowledgeNodes for study prioritisation."""

    def score(self, node: KnowledgeNode) -> Optional[ScoredNode]:
        """Returns None if node has no metrics (static graph, not overlaid)."""
        if node.metrics is None:
            return None

        m = node.metrics
        return ScoredNode(
            node=node,
            mastery_score=m.mastery_score,
            importance=m.importance,
            gap_score=m.gap_score,
            error_pressure=m.error_pressure,
            review_pressure=m.review_pressure,
            impact_score=m.impact_score,
            subject_id=node.subject_id,
            topic_id=node.topic_id,
        )

    def score_all(
        self,
        graph: KnowledgeGraph,
        node_types: Optional[list[NodeType]] = None,
    ) -> list[ScoredNode]:
        """Score all nodes of given types, return sorted by impact_score desc."""
        if node_types is None:
            node_types = [NodeType.SUBJECT, NodeType.TOPIC]

        scored: list[ScoredNode] = []
        for nt in node_types:
            for node in graph.nodes_of_type(nt):
                s = self.score(node)
                if s is not None and s.importance > 0:
                    scored.append(s)

        scored.sort(key=lambda x: x.impact_score, reverse=True)
        return scored
