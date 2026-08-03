"""
Input types for the Law Learning Engine.

Each snapshot is a read-only projection of data owned by another subsystem.
Callers are responsible for mapping their domain objects to these types.
The engine never touches a database — all data arrives through context.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional
from uuid import UUID


@dataclass(frozen=True)
class ArticleSnapshot:
    """Projection of a legal_articles row."""
    article_id: UUID
    document_id: UUID
    subject_id: Optional[UUID]
    topic_id: Optional[UUID]
    article_number: str
    title: Optional[str]
    official_text: str
    simple_text: Optional[str]          # plain-language version from DB, may be None
    highlights: list[str]               # from highlights JSONB
    tags: list[str]                     # from tags JSONB
    frequency_score: float              # how often this article is tested (0-1)
    chapter: Optional[str]
    section: Optional[str]
    document_abbreviation: str          # e.g. "CTB", "CP", "CF"

    @property
    def has_simple_text(self) -> bool:
        return bool(self.simple_text and self.simple_text.strip())

    @property
    def char_length(self) -> int:
        return len(self.official_text)

    @property
    def word_count(self) -> int:
        return len(self.official_text.split())


@dataclass(frozen=True)
class PersonalProgressSnapshot:
    """User's historical interaction with this article."""
    mastery_level: float              # 0-1 (from subject_mastery or KGE node)
    total_attempts: int               # question attempts on this article's questions
    accuracy: float                   # correct / total_attempts
    mistake_count: int                # errors logged in error_notebook
    review_count: int                 # how many spaced-repetition reviews done
    last_studied: Optional[datetime]
    is_overdue: bool


@dataclass(frozen=True)
class RelatedContentSnapshot:
    """
    Pre-computed related content from the Knowledge Graph Engine.
    Callers run KGE queries and pass results in — engine never calls KGE directly.
    """
    related_article_ids: list[UUID] = field(default_factory=list)
    related_article_labels: list[str] = field(default_factory=list)
    related_question_ids: list[UUID] = field(default_factory=list)
    related_topic_ids: list[UUID] = field(default_factory=list)
    related_topic_labels: list[str] = field(default_factory=list)
    sibling_article_ids: list[UUID] = field(default_factory=list)  # same chapter/section


@dataclass(frozen=True)
class LearningContextSnapshot:
    """
    Relevant slice of the user's LearningProfile (from Learning Engine).
    Built from LearningProfile.as_roi_context() or similar projection.
    """
    forgetting_velocity_article: float    # how fast user forgets this article's content
    confidence_for_subject: float        # calibration accuracy for the subject (0-1)
    retention_category: str              # "low" / "medium" / "high"
    review_efficiency: float             # fraction of reviews that actually stick (0-1)
    topic_mastery_confidence: float      # how confident the model is in mastery estimate


@dataclass(frozen=True)
class ApprovalContextSnapshot:
    """Relevant slice of ApprovalEstimate (from Approval Engine)."""
    approval_probability: float
    subject_weight: float    # how important this subject is on the exam (0-5 scale)
    risk_level: str          # "low" / "medium" / "high"


@dataclass
class ArticleContext:
    """
    Full context for analyzing a single legal article.
    Callers assemble this from DB rows + other engine outputs.
    """
    user_id: UUID
    article: ArticleSnapshot
    progress: Optional[PersonalProgressSnapshot]
    related_content: Optional[RelatedContentSnapshot]
    learning: Optional[LearningContextSnapshot]
    approval: Optional[ApprovalContextSnapshot]

    # Optional: pre-loaded error analysis for this article's questions
    # Duck-typed to avoid importing from error_intelligence
    recent_error_analyses: list[Any] = field(default_factory=list)

    # Optional: KGE node for this article (duck-typed — engine accesses .metrics)
    kge_node: Optional[Any] = None

    @property
    def has_personal_history(self) -> bool:
        return self.progress is not None and self.progress.total_attempts > 0

    @property
    def subject_weight(self) -> float:
        return self.approval.subject_weight if self.approval else 1.0

    @property
    def approval_probability(self) -> float:
        return self.approval.approval_probability if self.approval else 0.50

    @property
    def kge_impact_score(self) -> float:
        """Returns KGE node impact_score if available, else falls back to frequency_score."""
        if self.kge_node and hasattr(self.kge_node, "metrics") and self.kge_node.metrics:
            return float(self.kge_node.metrics.impact_score)
        return self.article.frequency_score
