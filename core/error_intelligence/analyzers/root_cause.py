"""
RootCauseAnalyzer — answers WHY the user failed in plain language.

Every classification maps to one or more sentence templates.
The most specific template that matches the context is chosen.
"""
from __future__ import annotations

from ..interfaces.context import ErrorContext
from ..models.enums import ErrorClassification


def analyze(context: ErrorContext, classification: ErrorClassification) -> tuple[str, str]:
    """
    Returns:
        (root_cause_sentence, knowledge_gap_label)
    """
    dispatch = {
        ErrorClassification.UNKNOWN_CONTENT:      _unknown_content,
        ErrorClassification.MEMORY_FAILURE:       _memory_failure,
        ErrorClassification.CONCEPT_CONFUSION:    _concept_confusion,
        ErrorClassification.MISREAD_QUESTION:     _misread_question,
        ErrorClassification.DISTRACTION:          _distraction,
        ErrorClassification.LAW_CONFUSION:        _law_confusion,
        ErrorClassification.INTERPRETATION_ERROR: _interpretation_error,
        ErrorClassification.EXCEPTION_CONFUSION:  _exception_confusion,
        ErrorClassification.OVERCONFIDENCE:       _overconfidence,
        ErrorClassification.LOW_CONFIDENCE:       _low_confidence,
        ErrorClassification.TIME_PRESSURE:        _time_pressure,
        ErrorClassification.GUESS:                _guess,
    }
    fn = dispatch.get(classification, _fallback)
    return fn(context)


# ── Per-classification handlers ──────────────────────────────────────────


def _unknown_content(ctx: ErrorContext) -> tuple[str, str]:
    if ctx.is_first_attempt:
        cause = "Conteúdo respondido pela primeira vez — não havia estudo prévio sobre este tema."
    elif ctx.mastery is None:
        cause = "Nenhum registro de estudo encontrado para esta matéria."
    else:
        cause = "O conteúdo específico desta questão ainda não foi dominado pelo aluno."
    gap = _gap_label(ctx)
    return cause, gap


def _memory_failure(ctx: ErrorContext) -> tuple[str, str]:
    overdue_info = ""
    if ctx.review_card and ctx.review_card.is_overdue:
        overdue_info = " A revisão estava atrasada."
    if ctx.review_card and ctx.review_card.lapsed:
        cause = f"O cartão de revisão entrou em colapso (SM-2 lapse) — o conteúdo foi esquecido.{overdue_info}"
    elif ctx.prev_correct_count > 0:
        cause = f"O aluno já acertou esta questão {ctx.prev_correct_count}× antes, mas esqueceu o conteúdo.{overdue_info}"
    else:
        cause = f"Retenção insuficiente — o conteúdo não foi consolidado antes de ser esquecido.{overdue_info}"
    gap = _gap_label(ctx)
    return cause, gap


def _concept_confusion(ctx: ErrorContext) -> tuple[str, str]:
    if ctx.learning and ctx.topic_id_str and ctx.topic_id_str in ctx.learning.confused_topics:
        cause = "O aluno confunde este tópico com um conceito relacionado — padrão de confusão registrado no perfil cognitivo."
    else:
        cause = "Confusão entre dois conceitos relacionados dentro do mesmo assunto."
    gap = _gap_label(ctx)
    return cause, gap


def _misread_question(ctx: ErrorContext) -> tuple[str, str]:
    if ctx.response_time_secs:
        cause = f"Resposta em {ctx.response_time_secs}s — muito rápida para uma leitura cuidadosa. Possível leitura superficial do enunciado."
    else:
        cause = "Leitura superficial do enunciado — o aluno não processou todo o texto da questão."
    gap = _gap_label(ctx)
    return cause, gap


def _distraction(ctx: ErrorContext) -> tuple[str, str]:
    if ctx.session and ctx.learning:
        if ctx.session.duration_so_far_mins > ctx.learning.fatigue_threshold_mins:
            cause = (
                f"Erro por fadiga: sessão de {ctx.session.duration_so_far_mins:.0f} min ultrapassou "
                f"o limiar de {ctx.learning.fatigue_threshold_mins} min deste aluno."
            )
        else:
            cause = f"Energia baixa ({ctx.session.energy_level}) durante a sessão — foco comprometido."
    else:
        cause = "Possível distração ou fadiga — desempenho abaixo do padrão do aluno nesta sessão."
    gap = _gap_label(ctx)
    return cause, gap


def _law_confusion(ctx: ErrorContext) -> tuple[str, str]:
    if ctx.question.legal_basis:
        cause = f"Confusão entre legislações concorrentes (base legal: {ctx.question.legal_basis})."
    else:
        cause = "O aluno confunde dispositivos de leis diferentes que tratam de assuntos semelhantes."
    gap = _gap_label(ctx)
    return cause, gap


def _interpretation_error(ctx: ErrorContext) -> tuple[str, str]:
    if ctx.response_time_secs and ctx.response_time_secs > 45:
        cause = f"Dificuldade de interpretação textual — o aluno levou {ctx.response_time_secs}s mas ainda interpretou incorretamente."
    else:
        cause = "Erro de interpretação da afirmação — o aluno entendeu o sentido oposto ao proposto."
    gap = _gap_label(ctx)
    return cause, gap


def _exception_confusion(ctx: ErrorContext) -> tuple[str, str]:
    cause = "O aluno não identificou a exceção à regra geral — questões do tipo 'salvo', 'exceto' ou 'ressalvado' são um padrão de dificuldade recorrente."
    gap = _gap_label(ctx)
    return cause, gap


def _overconfidence(ctx: ErrorContext) -> tuple[str, str]:
    conf_str = f" (confiança declarada: {ctx.confidence}/5)" if ctx.confidence else ""
    cause = f"Excesso de confiança{conf_str} — o aluno acreditava saber a resposta mas não verificou o raciocínio."
    gap = _gap_label(ctx)
    return cause, gap


def _low_confidence(ctx: ErrorContext) -> tuple[str, str]:
    if ctx.mastery and ctx.mastery.mastery_level < 0.30:
        cause = "Base de conhecimento insuficiente — baixa confiança e domínio abaixo de 30%."
    else:
        cause = "Baixa confiança gerou hesitação — o aluno provavelmente sabia a resposta mas foi afetado pela insegurança."
    gap = _gap_label(ctx)
    return cause, gap


def _time_pressure(ctx: ErrorContext) -> tuple[str, str]:
    if ctx.response_time_secs:
        cause = f"Pressão de tempo — resposta em {ctx.response_time_secs}s, muito abaixo da média histórica ({ctx.avg_past_time:.0f}s)."
    else:
        cause = "Pressão de tempo — resposta precipitada sem análise adequada do enunciado."
    gap = _gap_label(ctx)
    return cause, gap


def _guess(ctx: ErrorContext) -> tuple[str, str]:
    cause = "Chute — sem base de conhecimento, o aluno respondeu de forma aleatória."
    gap = _gap_label(ctx)
    return cause, gap


def _fallback(ctx: ErrorContext) -> tuple[str, str]:
    cause = "Causa não determinada com precisão — análise com dados insuficientes."
    return cause, _gap_label(ctx)


# ── Gap label helper ──────────────────────────────────────────────────────


def _gap_label(ctx: ErrorContext) -> str:
    """
    Produces a human-readable label for the specific knowledge gap.
    Priority: legal article > origin_result article > question topic.
    """
    if ctx.question.legal_basis:
        return ctx.question.legal_basis

    if ctx.origin_result:
        if ctx.origin_result.article and hasattr(ctx.origin_result.article, "label"):
            return ctx.origin_result.article.label
        if ctx.origin_result.topic and hasattr(ctx.origin_result.topic, "label"):
            return ctx.origin_result.topic.label

    if ctx.mastery:
        return f"Matéria: subject_id={ctx.question.subject_id}"

    return "Conteúdo não identificado"
