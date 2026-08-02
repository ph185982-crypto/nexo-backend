from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional
from uuid import UUID


class NodeType(str, Enum):
    SUBJECT = "subject"
    TOPIC = "topic"
    QUESTION = "question"
    ARTICLE = "article"
    FLASHCARD = "flashcard"


@dataclass
class NodeMetrics:
    """User-specific overlay — absent on the static graph."""
    mastery_score: float        # 0-100 (mastery_level * 100 from DB)
    importance: float           # 0-1 (derived from exam weight)
    attempts: int
    correct_rate: float         # 0-1
    error_count: int            # unresolved errors touching this node
    review_count: int           # active review cards on this node
    overdue_reviews: int
    last_studied: Optional[datetime]

    @property
    def gap_score(self) -> float:
        """importance × mastery_deficit — higher = bigger gap."""
        return self.importance * (1.0 - self.mastery_score / 100.0)

    @property
    def error_pressure(self) -> float:
        """Boost from unresolved errors; capped at 0.3."""
        return min(self.error_count * 0.05, 0.3)

    @property
    def review_pressure(self) -> float:
        """Boost from overdue review cards; capped at 0.3."""
        return min(self.overdue_reviews * 0.05, 0.3)

    @property
    def impact_score(self) -> float:
        """Composite score for ranking: gap + error pressure + review pressure."""
        return min(self.gap_score + self.error_pressure + self.review_pressure, 1.0)


@dataclass
class KnowledgeNode:
    node_id: str                        # "subject:{uuid}", "topic:{uuid}", etc.
    node_type: NodeType
    entity_id: UUID
    label: str                          # human-readable name
    metadata: dict[str, Any] = field(default_factory=dict)
    metrics: Optional[NodeMetrics] = None

    def with_metrics(self, m: NodeMetrics) -> KnowledgeNode:
        return KnowledgeNode(
            node_id=self.node_id,
            node_type=self.node_type,
            entity_id=self.entity_id,
            label=self.label,
            metadata=self.metadata,
            metrics=m,
        )

    # Convenience helpers
    @property
    def subject_id(self) -> Optional[UUID]:
        return self.metadata.get("subject_id")

    @property
    def topic_id(self) -> Optional[UUID]:
        return self.metadata.get("topic_id")

    @property
    def exam_weight(self) -> float:
        return float(self.metadata.get("weight", 1.0))


def make_node_id(node_type: NodeType, entity_id: UUID) -> str:
    return f"{node_type.value}:{entity_id}"
