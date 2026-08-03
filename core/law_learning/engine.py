"""
LawLearningEngine — public entry point for article-level study intelligence.

Responsibilities:
  - Enrich a legal article with a plain-language explanation.
  - Estimate how difficult and how important the article is for the exam.
  - Find related articles, questions, and topics.
  - Determine the user's current study status for the article.
  - Recommend the single best next action.
  - Estimate how much mastering this article improves approval probability.

Does NOT:
  - Create flashcards.
  - Schedule reviews.
  - Modify missions or the Decision Engine.
  - Call the database.
  - Generate AI explanations (provider is injected and swappable).

The engine is stateless. Instantiate once; call analyze() as many times as needed.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from .interfaces.context import ArticleContext
from .interfaces.output import ArticleLearningObject
from .providers.base import ExplanationProvider
from .providers.static import StaticExplanationProvider
from .estimators.difficulty import estimate as _estimate_difficulty
from .estimators.importance import estimate as _estimate_importance
from .analyzers.relationship import find_related
from .analyzers.study import (
    determine_status,
    recommend_action,
    compute_learning_gain,
)


class LawLearningEngine:
    """
    Stateless article enrichment engine.

    Instantiate with an ExplanationProvider. Defaults to StaticExplanationProvider
    (uses DB's simple_text field). Swap for an AI provider when ready — no other
    code needs to change.

    Example::

        engine = LawLearningEngine()
        obj = engine.analyze(context)
        print(obj.as_dict())

        # AI provider (future):
        engine = LawLearningEngine(provider=GPTExplanationProvider(api_key=...))
    """

    def __init__(self, provider: Optional[ExplanationProvider] = None) -> None:
        self._provider: ExplanationProvider = provider or StaticExplanationProvider()

    def analyze(self, context: ArticleContext) -> ArticleLearningObject:
        """
        Full enrichment pipeline for one legal article.

        Pipeline:
          1. explain()          — Article Explainer (pluggable provider)
          2. estimate_difficulty() — Article Difficulty Estimator
          3. estimate_importance() — Article Importance Estimator
          4. find_related()     — Article Relationship Finder
          5. determine_status() — study status from personal history
          6. recommend_action() — single best next action
          7. compute_learning_gain() — projected approval probability delta
          8. assemble ArticleLearningObject
        """
        article = context.article

        explanation = self._provider.explain(context)
        difficulty   = _estimate_difficulty(context)
        importance   = _estimate_importance(context)
        related_refs = find_related(context)
        status       = determine_status(context)
        recommendation = recommend_action(context, status, difficulty, importance)
        gain         = compute_learning_gain(context, importance)

        related_question_ids = (
            list(context.related_content.related_question_ids)
            if context.related_content else []
        )
        related_topic_ids = (
            list(context.related_content.related_topic_ids)
            if context.related_content else []
        )

        return ArticleLearningObject(
            user_id=context.user_id,
            article_id=article.article_id,
            analyzed_at=datetime.now(timezone.utc),
            article_number=article.article_number,
            document_abbreviation=article.document_abbreviation,
            title=article.title,
            official_text=article.official_text,
            explanation=explanation,
            difficulty=difficulty,
            importance=importance,
            personal_mastery=context.progress.mastery_level if context.progress else 0.0,
            mistake_count=context.progress.mistake_count if context.progress else 0,
            review_count=context.progress.review_count if context.progress else 0,
            study_status=status,
            related_articles=related_refs,
            related_question_ids=related_question_ids,
            related_topic_ids=related_topic_ids,
            exam_importance=importance.score,
            estimated_learning_gain=gain,
            recommended_next_action=recommendation,
        )

    def explainArticle(self, context: ArticleContext) -> str:
        """
        Return just the plain-language summary for an article.

        Shortcut when the caller only needs the explanation text without
        running the full pipeline.
        """
        return self._provider.explain(context).summary

    def estimateDifficulty(self, context: ArticleContext):
        """Difficulty assessment only (skips explanation and relationships)."""
        return _estimate_difficulty(context)

    def estimateImportance(self, context: ArticleContext):
        """Importance assessment only (skips explanation and relationships)."""
        return _estimate_importance(context)

    def findRelated(self, context: ArticleContext):
        """Relationship finder only (skips explanation, difficulty, importance)."""
        return find_related(context)

    def studyStatus(self, context: ArticleContext):
        """Determine study status only (skips all estimators)."""
        return determine_status(context)
