"""
EvolutionAnalyzer — tracks whether an error is improving or worsening.

Compares the current error state against the previous error_notebook entry
and recent attempt history to classify the error's trajectory.
"""
from __future__ import annotations

from ..interfaces.context import ErrorContext
from ..interfaces.analysis import EvolutionStatus
from ..models.enums import EvolutionDirection

_MIN_ATTEMPTS_FOR_TREND = 3  # need at least this many attempts to measure a trend


def track(context: ErrorContext) -> EvolutionStatus:
    """
    Returns an EvolutionStatus classifying how this error is evolving.
    """
    entry = context.error_entry

    # No error_notebook entry → this is the first error; not yet tracked
    if entry is None:
        return EvolutionStatus(
            direction=EvolutionDirection.STABLE.value,
            description="Primeiro erro registrado — evolução ainda não mensurável.",
            delta=0.0,
        )

    # Resolved error → it had disappeared
    if entry.resolved:
        return EvolutionStatus(
            direction=EvolutionDirection.DISAPPEARED.value,
            description="Erro marcado como resolvido — o aluno superou esta dificuldade.",
            delta=-float(entry.times_repeated),
        )

    # Use recent attempt trend for direction
    if len(context.previous_attempts) >= _MIN_ATTEMPTS_FOR_TREND:
        return _trend_from_attempts(context, entry.times_repeated)

    # Not enough attempts — use times_repeated as proxy
    if entry.times_repeated == 1:
        return EvolutionStatus(
            direction=EvolutionDirection.STABLE.value,
            description="Erro isolado — sem histórico suficiente para determinar tendência.",
            delta=0.0,
        )

    if entry.times_repeated >= 4:
        return EvolutionStatus(
            direction=EvolutionDirection.WORSENING.value,
            description=f"Erro recorrente: cometido {entry.times_repeated}× — padrão persistente.",
            delta=float(entry.times_repeated),
        )

    return EvolutionStatus(
        direction=EvolutionDirection.STABLE.value,
        description=f"Erro repetido {entry.times_repeated}× — sem sinal claro de melhora.",
        delta=float(entry.times_repeated - 1),
    )


def _trend_from_attempts(context: ErrorContext, times_repeated: int) -> EvolutionStatus:
    """
    Split previous attempts into two halves and compare accuracy.
    Improving: recent half is more accurate than older half.
    Worsening: recent half is less accurate.
    """
    attempts = sorted(context.previous_attempts, key=lambda a: a.answered_at)
    mid = len(attempts) // 2
    older = attempts[:mid]
    recent = attempts[mid:]

    older_acc = sum(1 for a in older if a.is_correct) / len(older) if older else 0.5
    recent_acc = sum(1 for a in recent if a.is_correct) / len(recent) if recent else 0.5
    delta = recent_acc - older_acc

    if recent_acc >= 0.70:
        return EvolutionStatus(
            direction=EvolutionDirection.IMPROVED.value,
            description=f"Desempenho recente de {recent_acc:.0%} — grande melhora em relação a {older_acc:.0%}.",
            delta=round(delta, 3),
        )

    if delta >= 0.15:
        return EvolutionStatus(
            direction=EvolutionDirection.IMPROVED.value,
            description=f"Melhora detectada: acurácia subiu {delta:+.0%} nas tentativas recentes.",
            delta=round(delta, 3),
        )

    if delta <= -0.15:
        return EvolutionStatus(
            direction=EvolutionDirection.WORSENING.value,
            description=f"Piora detectada: acurácia caiu {delta:+.0%} nas tentativas recentes.",
            delta=round(delta, 3),
        )

    return EvolutionStatus(
        direction=EvolutionDirection.STABLE.value,
        description=f"Desempenho estável: acurácia {recent_acc:.0%} (recente) vs {older_acc:.0%} (anterior).",
        delta=round(delta, 3),
    )
