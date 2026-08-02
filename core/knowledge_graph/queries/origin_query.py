from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
from uuid import UUID

from ..graph.edge import EdgeType
from ..graph.graph import KnowledgeGraph
from ..graph.node import KnowledgeNode, NodeType, make_node_id


@dataclass
class OriginResult:
    """
    Traces a question (usually one the user got wrong) back to its legal origin
    and surfaces related content worth studying.
    """
    question_id: UUID
    question_node: Optional[KnowledgeNode]

    # The legal article the question tests — the "why" behind the error
    article: Optional[KnowledgeNode]

    # Structural parents
    topic: Optional[KnowledgeNode]
    subject: Optional[KnowledgeNode]

    # Sibling questions that test the same article/topic
    sibling_questions: list[KnowledgeNode] = field(default_factory=list)

    # Related articles in the same topic/subject (content worth pre-studying)
    related_articles: list[KnowledgeNode] = field(default_factory=list)

    # Recommended study path: article first, then topic, then questions
    study_path: list[KnowledgeNode] = field(default_factory=list)


class OriginQuery:
    """Answers: 'Which article is at the origin of this error?'"""

    def find_origin(
        self, graph: KnowledgeGraph, question_id: UUID
    ) -> OriginResult:
        q_node = graph.get_by_entity(NodeType.QUESTION, question_id)
        if q_node is None:
            return OriginResult(
                question_id=question_id, question_node=None,
                article=None, topic=None, subject=None,
            )

        # ── Find article (direct edge from question) ─────────────────
        article_edges = graph.outgoing(q_node.node_id, [EdgeType.QUESTION_GROUNDED_IN])
        article = graph.get_node(article_edges[0].target_id) if article_edges else None

        # ── Find topic ───────────────────────────────────────────────
        topic_edges = graph.incoming(
            q_node.node_id, [EdgeType.TOPIC_CONTAINS_QUESTION]
        )
        topic = graph.get_node(topic_edges[0].source_id) if topic_edges else None

        # If topic missing, try article → topic
        if topic is None and article:
            art_topic_edges = graph.outgoing(
                article.node_id, [EdgeType.ARTICLE_BELONGS_TO_TOPIC]
            )
            topic = graph.get_node(art_topic_edges[0].target_id) if art_topic_edges else None

        # ── Find subject ─────────────────────────────────────────────
        subject: Optional[KnowledgeNode] = None
        if topic:
            subj_edges = graph.incoming(topic.node_id, [EdgeType.SUBJECT_CONTAINS_TOPIC])
            subject = graph.get_node(subj_edges[0].source_id) if subj_edges else None
        if subject is None:
            subj_edges = graph.incoming(
                q_node.node_id, [EdgeType.SUBJECT_CONTAINS_QUESTION]
            )
            subject = graph.get_node(subj_edges[0].source_id) if subj_edges else None

        # ── Sibling questions: same article ──────────────────────────
        siblings: list[KnowledgeNode] = []
        if article:
            reverse = graph.incoming(article.node_id, [EdgeType.QUESTION_GROUNDED_IN])
            for edge in reverse[:20]:  # cap to avoid noise
                sib = graph.get_node(edge.source_id)
                if sib and sib.entity_id != question_id:
                    siblings.append(sib)

        # If no siblings via article, use topic
        if not siblings and topic:
            topic_qs = graph.neighbors(topic.node_id, [EdgeType.TOPIC_CONTAINS_QUESTION])
            siblings = [n for n in topic_qs if n.entity_id != question_id][:10]

        # ── Related articles in same topic ───────────────────────────
        related_articles: list[KnowledgeNode] = []
        if topic:
            # Articles that belong to the same topic
            art_edges = graph.incoming(topic.node_id, [EdgeType.ARTICLE_BELONGS_TO_TOPIC])
            for edge in art_edges[:10]:
                art_node = graph.get_node(edge.source_id)
                if art_node and (article is None or art_node.node_id != article.node_id):
                    related_articles.append(art_node)

        # ── Recommended study path ────────────────────────────────────
        study_path: list[KnowledgeNode] = []
        if article:
            study_path.append(article)
        if topic:
            study_path.append(topic)
        study_path.append(q_node)
        if siblings:
            study_path.extend(siblings[:3])

        return OriginResult(
            question_id=question_id,
            question_node=q_node,
            article=article,
            topic=topic,
            subject=subject,
            sibling_questions=siblings,
            related_articles=related_articles,
            study_path=study_path,
        )

    def find_origins_for_errors(
        self, graph: KnowledgeGraph, question_ids: list[UUID]
    ) -> list[OriginResult]:
        return [self.find_origin(graph, qid) for qid in question_ids]
