"""
ArticleStudyAnalyzer — determines study status and next recommended action.

Combines difficulty, importance, and personal progress to decide:
  1. StudyStatus (NOT_STARTED → IN_PROGRESS → NEEDS_REVIEW → MASTERED)
  2. StudyRecommendation (what to do next, why, how long it'll take)
  3. estimated_learning_gain (approval probability delta if mastered)
"""
from __future__ import annotations

from ..interfaces.context import ArticleContext
from ..interfaces.output import ArticleDifficulty, ArticleImportance, StudyRecommendation
from ..models.enums import DifficultyLevel, ImportanceLevel, NextActionType, StudyStatus

_TIME_ESTIMATES: dict[NextActionType, int] = {
    NextActionType.READ_ARTICLE:       15,
    NextActionType.REVIEW_ARTICLE:     10,
    NextActionType.SOLVE_QUESTIONS:    20,
    NextActionType.COMPARE_ARTICLES:   12,
    NextActionType.CREATE_FLASHCARD:    5,
    NextActionType.REVISIT_MISTAKES:   15,
    NextActionType.ADVANCE_TO_RELATED: 10,
}


def determine_status(context: ArticleContext) -> StudyStatus:
    progress = context.progress

    if progress is None or progress.total_attempts == 0:
        return StudyStatus.NOT_STARTED

    if progress.is_overdue:
        return StudyStatus.NEEDS_REVIEW

    if progress.mastery_level >= 0.80 and progress.accuracy >= 0.80:
        return StudyStatus.MASTERED

    return StudyStatus.IN_PROGRESS


def recommend_action(
    context: ArticleContext,
    status: StudyStatus,
    difficulty: ArticleDifficulty,
    importance: ArticleImportance,
) -> StudyRecommendation:
    progress = context.progress

    # ── Priority calculation ────────────────────────────────────────────────
    base_priority = {
        ImportanceLevel.CRITICAL: 9,
        ImportanceLevel.HIGH:     7,
        ImportanceLevel.MEDIUM:   5,
        ImportanceLevel.LOW:      3,
    }.get(importance.level, 5)

    if status == StudyStatus.NEEDS_REVIEW:
        base_priority = min(base_priority + 2, 10)
    if difficulty.level in (DifficultyLevel.HARD, DifficultyLevel.VERY_HARD):
        base_priority = min(base_priority + 1, 10)

    # ── Action selection ────────────────────────────────────────────────────
    if status == StudyStatus.NOT_STARTED:
        action = NextActionType.READ_ARTICLE
        reason = "Você ainda não estudou este artigo. Comece pela leitura guiada."
        target_id = context.article.article_id
        target_label = f"Art. {context.article.article_number} ({context.article.document_abbreviation})"

    elif status == StudyStatus.NEEDS_REVIEW:
        if progress and progress.mistake_count > 3:
            action = NextActionType.REVISIT_MISTAKES
            reason = f"Você errou este artigo {progress.mistake_count}× — revisite seus erros antes de avançar."
        else:
            action = NextActionType.REVIEW_ARTICLE
            reason = "Revisão programada em atraso — reforce a memória antes que o esquecimento avance."
        target_id = context.article.article_id
        target_label = f"Art. {context.article.article_number} ({context.article.document_abbreviation})"

    elif status == StudyStatus.MASTERED:
        if context.related_content and context.related_content.related_article_ids:
            action = NextActionType.ADVANCE_TO_RELATED
            first_related = context.related_content.related_article_ids[0]
            labels = context.related_content.related_article_labels
            target_id = first_related
            target_label = labels[0] if labels else "Artigo relacionado"
            reason = "Artigo dominado — avance para conteúdo relacionado e expanda o conhecimento."
        else:
            action = NextActionType.SOLVE_QUESTIONS
            reason = "Artigo dominado — consolide praticando questões de prova."
            target_id = None
            target_label = None

    else:  # IN_PROGRESS
        if progress and progress.mistake_count > 2:
            action = NextActionType.REVISIT_MISTAKES
            reason = "Padrão de erros detectado — revise especificamente onde está errando."
        elif difficulty.level in (DifficultyLevel.HARD, DifficultyLevel.VERY_HARD):
            action = NextActionType.COMPARE_ARTICLES
            reason = "Artigo difícil — comparar com artigos similares ajuda a fixar as diferenças."
        else:
            action = NextActionType.SOLVE_QUESTIONS
            reason = "Continue praticando questões para consolidar o conteúdo."
        target_id = None
        target_label = None

    return StudyRecommendation(
        action=action,
        reason=reason,
        priority=base_priority,
        estimated_time_mins=_TIME_ESTIMATES[action],
        target_id=target_id if "target_id" in dir() else None,  # noqa: F821
        target_label=target_label if "target_label" in dir() else None,  # noqa: F821
    )


def compute_learning_gain(
    context: ArticleContext,
    importance: ArticleImportance,
) -> float:
    """
    Estimates approval probability delta if the user fully masters this article.

    Formula:
      gain = importance.score × subject_weight_factor × 0.10
             + recurrence_bonus (capped at 0.03)

    Capped at 0.12 per article — realistic single-article ceiling.
    """
    importance_score = importance.score
    weight_factor = min(context.subject_weight / _MAX_SUBJECT_WEIGHT, 1.0)

    base = importance_score * weight_factor * 0.10

    recurrence_bonus = 0.0
    if context.progress and context.progress.mistake_count > 0:
        recurrence_bonus = min(context.progress.mistake_count * 0.005, 0.03)

    gain = min(base + recurrence_bonus, 0.12)
    return round(gain, 4)


_MAX_SUBJECT_WEIGHT = 5.0
