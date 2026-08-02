from __future__ import annotations
from dataclasses import dataclass
from typing import Optional

from ..graph.edge import EdgeType
from ..graph.graph import KnowledgeGraph
from ..graph.node import KnowledgeNode, NodeType


@dataclass
class RelatedContent:
    node: KnowledgeNode
    relation: str               # "same_article" | "same_topic" | "sibling_topic" | "parent" | "subtopic"
    relevance_score: float      # 0-1
    reason: str


class RelatedQuery:
    """Answers: 'Which related content should be reviewed now?'"""

    _OVERDUE_BONUS = 0.3
    _ERROR_BONUS = 0.2
    _IMPORTANCE_WEIGHT = 0.5

    def find_related(
        self,
        graph: KnowledgeGraph,
        node_id: str,
        limit: int = 10,
    ) -> list[RelatedContent]:
        node = graph.get_node(node_id)
        if node is None:
            return []

        results: dict[str, RelatedContent] = {}

        dispatch = {
            NodeType.SUBJECT: self._from_subject,
            NodeType.TOPIC: self._from_topic,
            NodeType.QUESTION: self._from_question,
            NodeType.ARTICLE: self._from_article,
            NodeType.FLASHCARD: self._from_flashcard,
        }
        handler = dispatch.get(node.node_type)
        if handler:
            for rc in handler(graph, node):
                if rc.node.node_id != node_id and rc.node.node_id not in results:
                    results[rc.node.node_id] = rc

        # Sort by relevance, then by overdue/error pressure
        sorted_results = sorted(
            results.values(), key=lambda r: r.relevance_score, reverse=True
        )
        return sorted_results[:limit]

    # ── Per-type handlers ─────────────────────────────────────────────

    def _from_subject(self, graph: KnowledgeGraph, node: KnowledgeNode) -> list[RelatedContent]:
        results: list[RelatedContent] = []
        # All topics in this subject
        for topic in graph.neighbors(node.node_id, [EdgeType.SUBJECT_CONTAINS_TOPIC]):
            results.append(self._score(topic, "same_subject", "mesmo assunto do edital"))
        return results

    def _from_topic(self, graph: KnowledgeGraph, node: KnowledgeNode) -> list[RelatedContent]:
        results: list[RelatedContent] = []

        # Questions in this topic
        for q in graph.neighbors(node.node_id, [EdgeType.TOPIC_CONTAINS_QUESTION]):
            results.append(self._score(q, "same_topic", "questão do mesmo tópico"))

        # Articles in this topic
        for edge in graph.incoming(node.node_id, [EdgeType.ARTICLE_BELONGS_TO_TOPIC]):
            art = graph.get_node(edge.source_id)
            if art:
                results.append(self._score(art, "same_topic", "artigo base do tópico"))

        # Subtopics
        for sub in graph.neighbors(node.node_id, [EdgeType.TOPIC_HAS_SUBTOPIC]):
            results.append(self._score(sub, "subtopic", "subtópico relacionado"))

        # Sibling topics (same parent subject)
        parent_edges = graph.incoming(node.node_id, [EdgeType.SUBJECT_CONTAINS_TOPIC])
        if parent_edges:
            parent = graph.get_node(parent_edges[0].source_id)
            if parent:
                for sibling in graph.neighbors(parent.node_id, [EdgeType.SUBJECT_CONTAINS_TOPIC]):
                    if sibling.node_id != node.node_id:
                        results.append(self._score(sibling, "sibling_topic", "tópico irmão no mesmo assunto"))

        return results

    def _from_question(self, graph: KnowledgeGraph, node: KnowledgeNode) -> list[RelatedContent]:
        results: list[RelatedContent] = []

        # Article this question tests
        for edge in graph.outgoing(node.node_id, [EdgeType.QUESTION_GROUNDED_IN]):
            art = graph.get_node(edge.target_id)
            if art:
                results.append(self._score(art, "same_article", "artigo que esta questão testa"))
                # Sibling questions on same article
                for sibling_edge in graph.incoming(art.node_id, [EdgeType.QUESTION_GROUNDED_IN]):
                    sib = graph.get_node(sibling_edge.source_id)
                    if sib:
                        results.append(self._score(sib, "same_article", "outra questão do mesmo artigo"))

        # Topic parent
        for edge in graph.incoming(node.node_id, [EdgeType.TOPIC_CONTAINS_QUESTION]):
            topic = graph.get_node(edge.source_id)
            if topic:
                results.append(self._score(topic, "parent", "tópico que contém esta questão"))
                # Other questions in same topic
                for q in graph.neighbors(topic.node_id, [EdgeType.TOPIC_CONTAINS_QUESTION]):
                    if q.node_id != node.node_id:
                        results.append(self._score(q, "same_topic", "questão do mesmo tópico"))

        return results

    def _from_article(self, graph: KnowledgeGraph, node: KnowledgeNode) -> list[RelatedContent]:
        results: list[RelatedContent] = []

        # Questions grounded in this article
        for edge in graph.incoming(node.node_id, [EdgeType.QUESTION_GROUNDED_IN]):
            q = graph.get_node(edge.source_id)
            if q:
                results.append(self._score(q, "same_article", "questão baseada neste artigo"))

        # Topic this article belongs to
        for edge in graph.outgoing(node.node_id, [EdgeType.ARTICLE_BELONGS_TO_TOPIC]):
            topic = graph.get_node(edge.target_id)
            if topic:
                results.append(self._score(topic, "parent", "tópico deste artigo"))

        return results

    def _from_flashcard(self, graph: KnowledgeGraph, node: KnowledgeNode) -> list[RelatedContent]:
        results: list[RelatedContent] = []
        for edge in graph.outgoing(node.node_id, [EdgeType.FLASHCARD_DERIVED_FROM]):
            q = graph.get_node(edge.target_id)
            if q:
                results.append(self._score(q, "same_article", "questão origem do flashcard"))
        for edge in graph.outgoing(node.node_id, [EdgeType.FLASHCARD_BASED_ON]):
            art = graph.get_node(edge.target_id)
            if art:
                results.append(self._score(art, "same_article", "artigo base do flashcard"))
        return results

    # ── Scoring helper ────────────────────────────────────────────────

    def _score(self, node: KnowledgeNode, relation: str, reason: str) -> RelatedContent:
        score = 0.3  # base

        if node.metrics:
            m = node.metrics
            # Boost by gap (needs study)
            score += m.gap_score * self._IMPORTANCE_WEIGHT
            # Boost by urgency signals
            if m.overdue_reviews > 0:
                score += self._OVERDUE_BONUS
            if m.error_count > 0:
                score += self._ERROR_BONUS

        score = min(score, 1.0)
        return RelatedContent(node=node, relation=relation, relevance_score=score, reason=reason)
