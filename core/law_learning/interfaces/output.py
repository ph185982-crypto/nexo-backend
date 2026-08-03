"""
Output types for the Law Learning Engine.

ArticleLearningObject is the single deliverable — a fully enriched study object
for one legal article, ready for consumption by the Decision Engine, UI, or
any other caller.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from uuid import UUID

from ..models.enums import DifficultyLevel, ImportanceLevel, NextActionType, StudyStatus


@dataclass(frozen=True)
class ArticleExplanation:
    """Plain-language enrichment produced by the pluggable ExplanationProvider."""
    summary: str                    # 2-3 sentence plain-language explanation
    keywords: list[str]             # key legal terms in this article
    mnemonic: Optional[str]         # optional memory aid
    common_mistakes: list[str]      # typical errors test-takers make
    provider_name: str              # which provider generated this (e.g. "static", "gpt-4o")


@dataclass(frozen=True)
class ArticleDifficulty:
    """Difficulty assessment for this article."""
    level: DifficultyLevel
    score: float                    # 0-1 (higher = harder)
    factors: dict[str, float]       # contributing factors + their partial scores
    reasoning: str                  # one-sentence rationale


@dataclass(frozen=True)
class ArticleImportance:
    """Exam-relevance assessment for this article."""
    level: ImportanceLevel
    score: float                    # 0-1 (higher = more important)
    factors: dict[str, float]
    reasoning: str


@dataclass(frozen=True)
class RelatedArticleRef:
    article_id: UUID
    label: str
    relationship_type: str          # "same_chapter", "cross_referenced", "often_confused"
    strength: float                 # 0-1


@dataclass(frozen=True)
class StudyRecommendation:
    action: NextActionType
    reason: str
    priority: int                   # 1-10
    estimated_time_mins: int
    target_id: Optional[UUID] = None
    target_label: Optional[str] = None


@dataclass
class ArticleLearningObject:
    """
    The enriched study object produced by LawLearningEngine for one article.

    Consumed by:
      - Decision Engine  → builds study missions around articles
      - UI               → renders article study cards
      - Approval Engine  → uses estimated_learning_gain for probability projections
    """
    # Identity
    user_id: UUID
    article_id: UUID
    analyzed_at: datetime

    # Raw article data (caller's snapshot, unmodified)
    article_number: str
    document_abbreviation: str
    title: Optional[str]
    official_text: str

    # Explanation (from ExplanationProvider)
    explanation: ArticleExplanation

    # Assessments
    difficulty: ArticleDifficulty
    importance: ArticleImportance

    # Personal history
    personal_mastery: float         # 0-1
    mistake_count: int
    review_count: int
    study_status: StudyStatus

    # Relationships
    related_articles: list[RelatedArticleRef]
    related_question_ids: list[UUID]
    related_topic_ids: list[UUID]

    # Actionable outputs
    exam_importance: float          # 0-1 composite, same as importance.score
    estimated_learning_gain: float  # projected approval probability delta if mastered
    recommended_next_action: StudyRecommendation

    def as_dict(self) -> dict:
        return {
            "user_id": str(self.user_id),
            "article_id": str(self.article_id),
            "analyzed_at": self.analyzed_at.isoformat(),
            "article_number": self.article_number,
            "document": self.document_abbreviation,
            "title": self.title,
            "study_status": self.study_status,
            "personal_mastery": round(self.personal_mastery, 4),
            "mistake_count": self.mistake_count,
            "review_count": self.review_count,
            "difficulty": {
                "level": self.difficulty.level,
                "score": round(self.difficulty.score, 4),
                "reasoning": self.difficulty.reasoning,
            },
            "importance": {
                "level": self.importance.level,
                "score": round(self.importance.score, 4),
                "reasoning": self.importance.reasoning,
            },
            "explanation": {
                "summary": self.explanation.summary,
                "keywords": self.explanation.keywords,
                "mnemonic": self.explanation.mnemonic,
                "common_mistakes": self.explanation.common_mistakes,
                "provider": self.explanation.provider_name,
            },
            "related_articles": [
                {
                    "article_id": str(r.article_id),
                    "label": r.label,
                    "relationship": r.relationship_type,
                    "strength": round(r.strength, 3),
                }
                for r in self.related_articles
            ],
            "related_question_ids": [str(q) for q in self.related_question_ids],
            "related_topic_ids": [str(t) for t in self.related_topic_ids],
            "exam_importance": round(self.exam_importance, 4),
            "estimated_learning_gain": round(self.estimated_learning_gain, 4),
            "recommended_next_action": {
                "action": self.recommended_next_action.action,
                "reason": self.recommended_next_action.reason,
                "priority": self.recommended_next_action.priority,
                "estimated_time_mins": self.recommended_next_action.estimated_time_mins,
                "target_id": str(self.recommended_next_action.target_id) if self.recommended_next_action.target_id else None,
                "target_label": self.recommended_next_action.target_label,
            },
        }
