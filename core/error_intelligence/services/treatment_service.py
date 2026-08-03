"""
TreatmentService — generates a structured remediation plan.

Given a classification, severity, and context, produces an ordered list
of TreatmentAction recommendations.

Rules:
  - Only recommends — never creates flashcards, schedules reviews, or modifies missions.
  - Other engines (Decision Engine, Mission Builder) consume these recommendations.
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from ..interfaces.context import ErrorContext
from ..interfaces.analysis import TreatmentAction
from ..models.enums import ErrorClassification, ErrorSeverity, TreatmentActionType

# Base estimated times (minutes) per action type
_TIME_ESTIMATES = {
    TreatmentActionType.READ_LAW:                  15,
    TreatmentActionType.REVIEW_SPECIFIC_ARTICLE:   10,
    TreatmentActionType.SOLVE_SIMILAR_QUESTIONS:   20,
    TreatmentActionType.REVIEW_RELATED_CONCEPTS:   15,
    TreatmentActionType.CREATE_FLASHCARD_CANDIDATE: 5,
    TreatmentActionType.INCREASE_REVIEW_PRIORITY:   3,
    TreatmentActionType.SCHEDULE_SHORT_REVIEW:       8,
    TreatmentActionType.SCHEDULE_LONG_REVIEW:       12,
    TreatmentActionType.REVISIT_PREVIOUS_MISTAKES:  15,
}

# Learning gain estimates per action type
_GAIN_ESTIMATES = {
    TreatmentActionType.READ_LAW:                  0.60,
    TreatmentActionType.REVIEW_SPECIFIC_ARTICLE:   0.55,
    TreatmentActionType.SOLVE_SIMILAR_QUESTIONS:   0.50,
    TreatmentActionType.REVIEW_RELATED_CONCEPTS:   0.40,
    TreatmentActionType.CREATE_FLASHCARD_CANDIDATE: 0.35,
    TreatmentActionType.INCREASE_REVIEW_PRIORITY:  0.45,
    TreatmentActionType.SCHEDULE_SHORT_REVIEW:     0.40,
    TreatmentActionType.SCHEDULE_LONG_REVIEW:      0.55,
    TreatmentActionType.REVISIT_PREVIOUS_MISTAKES: 0.35,
}

# Ordered action lists per classification (highest priority first)
_PLAN_TEMPLATES: dict[ErrorClassification, list[tuple[TreatmentActionType, str, int]]] = {
    ErrorClassification.UNKNOWN_CONTENT: [
        (TreatmentActionType.READ_LAW,                "Base legal desta questão nunca foi estudada.", 9),
        (TreatmentActionType.REVIEW_SPECIFIC_ARTICLE, "Revisar o artigo específico referenciado.",    8),
        (TreatmentActionType.SOLVE_SIMILAR_QUESTIONS, "Praticar questões do mesmo tópico.",           7),
    ],
    ErrorClassification.MEMORY_FAILURE: [
        (TreatmentActionType.INCREASE_REVIEW_PRIORITY, "Cartão SM-2 em atraso — revisão urgente.",   9),
        (TreatmentActionType.SCHEDULE_SHORT_REVIEW,    "Revisão de curto prazo para reconsolidar.",   8),
        (TreatmentActionType.REVIEW_SPECIFIC_ARTICLE,  "Rever artigo antes da próxima revisão.",      7),
    ],
    ErrorClassification.CONCEPT_CONFUSION: [
        (TreatmentActionType.REVIEW_RELATED_CONCEPTS,  "Comparar conceitos que o aluno está confundindo.", 9),
        (TreatmentActionType.SOLVE_SIMILAR_QUESTIONS,  "Praticar questões que exigem distinção entre os conceitos.", 8),
        (TreatmentActionType.CREATE_FLASHCARD_CANDIDATE, "Criar cartão que contraste os dois conceitos.", 7),
    ],
    ErrorClassification.MISREAD_QUESTION: [
        (TreatmentActionType.SOLVE_SIMILAR_QUESTIONS,  "Praticar questões semelhantes com foco na leitura lenta.", 7),
        (TreatmentActionType.SCHEDULE_SHORT_REVIEW,    "Revisão rápida para reforçar atenção ao enunciado.", 5),
    ],
    ErrorClassification.DISTRACTION: [
        (TreatmentActionType.SCHEDULE_SHORT_REVIEW,    "Sessão curta focada — evitar fadiga.",        6),
        (TreatmentActionType.REVISIT_PREVIOUS_MISTAKES, "Revisitar erros anteriores do mesmo dia.",   5),
    ],
    ErrorClassification.LAW_CONFUSION: [
        (TreatmentActionType.READ_LAW,                 "Comparar os textos das legislações concorrentes.", 9),
        (TreatmentActionType.REVIEW_RELATED_CONCEPTS,  "Revisar os pontos de divergência entre as leis.", 8),
        (TreatmentActionType.CREATE_FLASHCARD_CANDIDATE, "Criar cartão de contraste das legislações.", 7),
    ],
    ErrorClassification.INTERPRETATION_ERROR: [
        (TreatmentActionType.SOLVE_SIMILAR_QUESTIONS,  "Praticar questões de interpretação do mesmo assunto.", 8),
        (TreatmentActionType.READ_LAW,                 "Reler o texto legal com atenção à estrutura da frase.", 7),
    ],
    ErrorClassification.EXCEPTION_CONFUSION: [
        (TreatmentActionType.REVIEW_SPECIFIC_ARTICLE,  "Estudar especificamente as exceções à regra geral.", 9),
        (TreatmentActionType.CREATE_FLASHCARD_CANDIDATE, "Criar cartão dedicado à exceção desta regra.", 8),
        (TreatmentActionType.SOLVE_SIMILAR_QUESTIONS,  "Praticar questões de exceção do mesmo artigo.", 7),
    ],
    ErrorClassification.OVERCONFIDENCE: [
        (TreatmentActionType.SOLVE_SIMILAR_QUESTIONS,  "Praticar questões parecidas para calibrar a confiança.", 7),
        (TreatmentActionType.REVIEW_RELATED_CONCEPTS,  "Revisar diferenças sutis que costumam enganar.", 6),
    ],
    ErrorClassification.LOW_CONFIDENCE: [
        (TreatmentActionType.REVIEW_SPECIFIC_ARTICLE,  "Estudar o conteúdo até atingir confiança ≥ 70%.", 8),
        (TreatmentActionType.SCHEDULE_LONG_REVIEW,     "Revisão espaçada para consolidar a memória.",   7),
        (TreatmentActionType.SOLVE_SIMILAR_QUESTIONS,  "Exposição repetida para construir confiança.",   6),
    ],
    ErrorClassification.TIME_PRESSURE: [
        (TreatmentActionType.SOLVE_SIMILAR_QUESTIONS,  "Praticar sob condições de tempo similar.",       6),
        (TreatmentActionType.SCHEDULE_SHORT_REVIEW,    "Revisão rápida para automatizar o reconhecimento.", 5),
    ],
    ErrorClassification.GUESS: [
        (TreatmentActionType.READ_LAW,                 "Conteúdo desconhecido — iniciar pelo texto legal.", 9),
        (TreatmentActionType.REVIEW_SPECIFIC_ARTICLE,  "Estudar o artigo referenciado pela questão.",    9),
        (TreatmentActionType.SCHEDULE_LONG_REVIEW,     "Planejar revisões espaçadas para fixar o novo conteúdo.", 7),
    ],
}


def build_treatment(
    classification: ErrorClassification,
    severity: ErrorSeverity,
    context: ErrorContext,
) -> list[TreatmentAction]:
    """
    Returns an ordered list of TreatmentAction recommendations.
    CRITICAL severity always prepends an INCREASE_REVIEW_PRIORITY action.
    """
    actions: list[TreatmentAction] = []

    # CRITICAL: always lead with an immediate review priority bump
    if severity == ErrorSeverity.CRITICAL:
        actions.append(
            _make_action(
                TreatmentActionType.INCREASE_REVIEW_PRIORITY,
                target_id=None,
                target_label=_topic_label(context),
                reason=f"Erro CRÍTICO em matéria de alto peso — revisão imediata necessária.",
                priority=10,
            )
        )

    template = _PLAN_TEMPLATES.get(classification, [])
    for action_type, reason, base_priority in template:
        # Amplify priority for HIGH/CRITICAL severity
        priority = base_priority
        if severity in (ErrorSeverity.CRITICAL, ErrorSeverity.HIGH) and priority >= 7:
            priority = min(priority + 1, 10)

        target_id, target_label = _resolve_target(action_type, context)
        actions.append(
            _make_action(action_type, target_id=target_id, target_label=target_label, reason=reason, priority=priority)
        )

    return actions


def _make_action(
    action_type: TreatmentActionType,
    target_id: Optional[UUID],
    target_label: str,
    reason: str,
    priority: int,
) -> TreatmentAction:
    return TreatmentAction(
        action_type=action_type.value,
        target_id=target_id,
        target_label=target_label,
        reason=reason,
        priority=priority,
        estimated_time_mins=_TIME_ESTIMATES[action_type],
        expected_learning_gain=_GAIN_ESTIMATES[action_type],
    )


def _resolve_target(
    action_type: TreatmentActionType,
    ctx: ErrorContext,
) -> tuple[Optional[UUID], str]:
    """
    Returns (entity_id, label) for the most specific target of this action.
    """
    if action_type in (TreatmentActionType.READ_LAW, TreatmentActionType.REVIEW_SPECIFIC_ARTICLE):
        if ctx.question.legal_article_id:
            label = ctx.question.legal_basis or "Artigo referenciado"
            return ctx.question.legal_article_id, label
        if ctx.origin_result and ctx.origin_result.article:
            art = ctx.origin_result.article
            label = getattr(art, "label", "Artigo relacionado")
            entity_id = getattr(art, "entity_id", None)
            return entity_id, label
        return None, ctx.question.legal_basis or "Lei base da questão"

    if action_type in (TreatmentActionType.SOLVE_SIMILAR_QUESTIONS, TreatmentActionType.REVIEW_RELATED_CONCEPTS):
        if ctx.question.topic_id:
            return ctx.question.topic_id, _topic_label(ctx)
        return ctx.question.subject_id, _subject_label(ctx)

    if action_type == TreatmentActionType.CREATE_FLASHCARD_CANDIDATE:
        if ctx.question.legal_article_id:
            return ctx.question.legal_article_id, ctx.question.legal_basis or "Artigo"
        return ctx.question.subject_id, _subject_label(ctx)

    return None, _topic_label(ctx)


def _topic_label(ctx: ErrorContext) -> str:
    if ctx.origin_result and ctx.origin_result.topic:
        return getattr(ctx.origin_result.topic, "label", "Tópico")
    return f"Tópico (subject_id={ctx.question.subject_id})"


def _subject_label(ctx: ErrorContext) -> str:
    if ctx.origin_result and ctx.origin_result.subject:
        return getattr(ctx.origin_result.subject, "label", "Matéria")
    return f"Matéria (subject_id={ctx.question.subject_id})"
