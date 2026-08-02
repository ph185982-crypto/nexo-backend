from __future__ import annotations
from collections import defaultdict
from datetime import datetime, timezone
from uuid import UUID

from .edge import EdgeType, KnowledgeEdge
from .graph import KnowledgeGraph
from .node import KnowledgeNode, NodeMetrics, NodeType, make_node_id
from ..ports.repository import (
    ArticleData, FlashcardData, QuestionData, SubjectData, TopicData,
    UserErrorData, UserMasteryData, UserReviewCardData,
)


class GraphBuilder:
    """
    Builds the static structural graph from raw DB data.
    Also builds the user metrics overlay (NodeMetrics per node).
    Stateless — call build_static() and build_metrics() independently.
    """

    def build_static(
        self,
        subjects: list[SubjectData],
        topics: list[TopicData],
        questions: list[QuestionData],
        articles: list[ArticleData],
        flashcards: list[FlashcardData],
    ) -> KnowledgeGraph:
        g = KnowledgeGraph()

        # ── Subjects ────────────────────────────────────────────────
        for s in subjects:
            if not s.is_active:
                continue
            node = KnowledgeNode(
                node_id=make_node_id(NodeType.SUBJECT, s.id),
                node_type=NodeType.SUBJECT,
                entity_id=s.id,
                label=s.name,
                metadata={
                    "slug": s.slug,
                    "weight_prf": s.weight_prf,
                    "weight_pm": s.weight_pm,
                    "weight": s.weight_prf,  # default; overlaid at query time per exam
                },
            )
            g.add_node(node)

        # ── Topics ──────────────────────────────────────────────────
        for t in topics:
            if not t.is_active:
                continue
            node = KnowledgeNode(
                node_id=make_node_id(NodeType.TOPIC, t.id),
                node_type=NodeType.TOPIC,
                entity_id=t.id,
                label=t.name,
                metadata={
                    "slug": t.slug,
                    "subject_id": t.subject_id,
                    "weight": t.weight,
                    "parent_topic_id": t.parent_topic_id,
                },
            )
            g.add_node(node)

        # ── Topics → Subject edges ───────────────────────────────────
        for t in topics:
            if not t.is_active:
                continue
            g.add_edge(KnowledgeEdge(
                source_id=make_node_id(NodeType.SUBJECT, t.subject_id),
                target_id=make_node_id(NodeType.TOPIC, t.id),
                edge_type=EdgeType.SUBJECT_CONTAINS_TOPIC,
            ))
            if t.parent_topic_id:
                g.add_edge(KnowledgeEdge(
                    source_id=make_node_id(NodeType.TOPIC, t.parent_topic_id),
                    target_id=make_node_id(NodeType.TOPIC, t.id),
                    edge_type=EdgeType.TOPIC_HAS_SUBTOPIC,
                ))

        # ── Articles (before questions so QUESTION_GROUNDED_IN edges resolve) ──
        for a in articles:
            node = KnowledgeNode(
                node_id=make_node_id(NodeType.ARTICLE, a.id),
                node_type=NodeType.ARTICLE,
                entity_id=a.id,
                label=f"{a.article_number}" + (f" — {a.title}" if a.title else ""),
                metadata={
                    "document_id": a.document_id,
                    "subject_id": a.subject_id,
                    "topic_id": a.topic_id,
                    "frequency_score": a.frequency_score,
                },
            )
            g.add_node(node)

            if a.subject_id:
                g.add_edge(KnowledgeEdge(
                    source_id=make_node_id(NodeType.ARTICLE, a.id),
                    target_id=make_node_id(NodeType.SUBJECT, a.subject_id),
                    edge_type=EdgeType.ARTICLE_BELONGS_TO_SUBJECT,
                ))
            if a.topic_id:
                g.add_edge(KnowledgeEdge(
                    source_id=make_node_id(NodeType.ARTICLE, a.id),
                    target_id=make_node_id(NodeType.TOPIC, a.topic_id),
                    edge_type=EdgeType.ARTICLE_BELONGS_TO_TOPIC,
                ))

        # ── Questions (after articles so QUESTION_GROUNDED_IN edges resolve) ──
        for q in questions:
            if not q.is_active:
                continue
            node = KnowledgeNode(
                node_id=make_node_id(NodeType.QUESTION, q.id),
                node_type=NodeType.QUESTION,
                entity_id=q.id,
                label=f"{q.question_type}/{q.difficulty}",
                metadata={
                    "subject_id": q.subject_id,
                    "topic_id": q.topic_id,
                    "legal_article_id": q.legal_article_id,
                    "question_type": q.question_type,
                    "difficulty": q.difficulty,
                },
            )
            g.add_node(node)

            if q.topic_id:
                g.add_edge(KnowledgeEdge(
                    source_id=make_node_id(NodeType.TOPIC, q.topic_id),
                    target_id=make_node_id(NodeType.QUESTION, q.id),
                    edge_type=EdgeType.TOPIC_CONTAINS_QUESTION,
                ))
            else:
                g.add_edge(KnowledgeEdge(
                    source_id=make_node_id(NodeType.SUBJECT, q.subject_id),
                    target_id=make_node_id(NodeType.QUESTION, q.id),
                    edge_type=EdgeType.SUBJECT_CONTAINS_QUESTION,
                ))

            if q.legal_article_id:
                g.add_edge(KnowledgeEdge(
                    source_id=make_node_id(NodeType.QUESTION, q.id),
                    target_id=make_node_id(NodeType.ARTICLE, q.legal_article_id),
                    edge_type=EdgeType.QUESTION_GROUNDED_IN,
                ))

        # ── Flashcards ───────────────────────────────────────────────
        for f in flashcards:
            node = KnowledgeNode(
                node_id=make_node_id(NodeType.FLASHCARD, f.id),
                node_type=NodeType.FLASHCARD,
                entity_id=f.id,
                label="flashcard",
                metadata={
                    "subject_id": f.subject_id,
                    "topic_id": f.topic_id,
                    "question_id": f.question_id,
                    "article_id": f.article_id,
                },
            )
            g.add_node(node)

            if f.question_id:
                g.add_edge(KnowledgeEdge(
                    source_id=make_node_id(NodeType.FLASHCARD, f.id),
                    target_id=make_node_id(NodeType.QUESTION, f.question_id),
                    edge_type=EdgeType.FLASHCARD_DERIVED_FROM,
                ))
            if f.article_id:
                g.add_edge(KnowledgeEdge(
                    source_id=make_node_id(NodeType.FLASHCARD, f.id),
                    target_id=make_node_id(NodeType.ARTICLE, f.article_id),
                    edge_type=EdgeType.FLASHCARD_BASED_ON,
                ))

        return g

    def build_metrics(
        self,
        graph: KnowledgeGraph,
        target_exam: str,
        mastery_rows: list[UserMasteryData],
        error_rows: list[UserErrorData],
        review_rows: list[UserReviewCardData],
    ) -> dict[str, NodeMetrics]:
        """
        Returns a mapping node_id → NodeMetrics to be overlaid on the static graph.
        """
        now = datetime.now(timezone.utc)

        # Index mastery by (subject_id, topic_id)
        mastery_by_subject: dict[UUID, UserMasteryData] = {}
        mastery_by_topic: dict[UUID, UserMasteryData] = {}
        for m in mastery_rows:
            if m.topic_id is None:
                mastery_by_subject[m.subject_id] = m
            else:
                mastery_by_topic[m.topic_id] = m

        # Count errors per subject and topic
        errors_by_subject: dict[UUID, int] = defaultdict(int)
        errors_by_topic: dict[UUID, int] = defaultdict(int)
        errors_by_question: dict[UUID, int] = defaultdict(int)
        for e in error_rows:
            if not e.resolved:
                if e.subject_id:
                    errors_by_subject[e.subject_id] += e.times_repeated
                if e.topic_id:
                    errors_by_topic[e.topic_id] += e.times_repeated
                errors_by_question[e.question_id] += e.times_repeated

        # Count reviews (and overdue) per entity
        reviews_by_question: dict[UUID, tuple[int, int]] = defaultdict(lambda: (0, 0))
        reviews_by_article: dict[UUID, tuple[int, int]] = defaultdict(lambda: (0, 0))
        for r in review_rows:
            total, overdue = (r.total_reviews, 1 if r.is_overdue else 0)
            if r.question_id:
                prev = reviews_by_question[r.question_id]
                reviews_by_question[r.question_id] = (prev[0] + total, prev[1] + overdue)
            if r.article_id:
                prev = reviews_by_article[r.article_id]
                reviews_by_article[r.article_id] = (prev[0] + total, prev[1] + overdue)

        weight_field = "weight_prf" if target_exam.upper() != "PMGO" else "weight_pm"
        metrics: dict[str, NodeMetrics] = {}

        for node in graph.nodes_of_type(NodeType.SUBJECT):
            sid = node.entity_id
            raw_weight = node.metadata.get(weight_field, 1.0)
            max_weight = 5.0  # normalise to 0-1 (weights range 0.5-5.0 in seeds)
            importance = min(raw_weight / max_weight, 1.0)

            m = mastery_by_subject.get(sid)
            mastery = (m.mastery_level * 100) if m else 0.0
            attempts = m.total_attempts if m else 0
            correct_rate = m.accuracy if m else 0.0
            error_c = errors_by_subject.get(sid, 0)
            last_studied = m.last_studied if m else None

            metrics[node.node_id] = NodeMetrics(
                mastery_score=mastery,
                importance=importance,
                attempts=attempts,
                correct_rate=correct_rate,
                error_count=error_c,
                review_count=0,
                overdue_reviews=0,
                last_studied=last_studied,
            )

        for node in graph.nodes_of_type(NodeType.TOPIC):
            tid = node.entity_id
            parent_subject_id: UUID = node.metadata.get("subject_id")
            subject_node = graph.get_by_entity(NodeType.SUBJECT, parent_subject_id) if parent_subject_id else None
            parent_importance = (
                metrics.get(subject_node.node_id, NodeMetrics(0, 0, 0, 0, 0, 0, 0, None)).importance
                if subject_node else 0.5
            )
            topic_weight = node.metadata.get("weight", 1.0)
            importance = min(parent_importance * topic_weight, 1.0)

            m = mastery_by_topic.get(tid)
            mastery = (m.mastery_level * 100) if m else 0.0
            attempts = m.total_attempts if m else 0
            correct_rate = m.accuracy if m else 0.0
            error_c = errors_by_topic.get(tid, 0)
            last_studied = m.last_studied if m else None

            metrics[node.node_id] = NodeMetrics(
                mastery_score=mastery,
                importance=importance,
                attempts=attempts,
                correct_rate=correct_rate,
                error_count=error_c,
                review_count=0,
                overdue_reviews=0,
                last_studied=last_studied,
            )

        for node in graph.nodes_of_type(NodeType.QUESTION):
            qid = node.entity_id
            error_c = errors_by_question.get(qid, 0)
            rc_total, rc_overdue = reviews_by_question.get(qid, (0, 0))

            metrics[node.node_id] = NodeMetrics(
                mastery_score=0.0,    # individual question mastery not tracked
                importance=0.0,       # questions inherit importance from topic/subject
                attempts=0,
                correct_rate=0.0,
                error_count=error_c,
                review_count=rc_total,
                overdue_reviews=rc_overdue,
                last_studied=None,
            )

        for node in graph.nodes_of_type(NodeType.ARTICLE):
            aid = node.entity_id
            rc_total, rc_overdue = reviews_by_article.get(aid, (0, 0))
            freq = node.metadata.get("frequency_score", 0.0)

            metrics[node.node_id] = NodeMetrics(
                mastery_score=0.0,
                importance=min(freq / 10.0, 1.0),  # frequency_score normalised
                attempts=0,
                correct_rate=0.0,
                error_count=0,
                review_count=rc_total,
                overdue_reviews=rc_overdue,
                last_studied=None,
            )

        return metrics
