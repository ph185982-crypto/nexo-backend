"""
Score Projection — quantos pontos a prova daria hoje, contra o corte real.

Antes disso era uma média ponderada de domínio comparada com um
PASSING_THRESHOLD que existia no código e nunca era lido em lugar nenhum —
"chance de aprovação" era a própria acurácia do usuário rebatizada, sem
nota de corte, sem blueprint, sem contar pontos de verdade.

Agora o modelo projeta pontos reais contra o ExamProfile (blocos, itens
por matéria, peso — dado, não código, ver prf/engines/exam_profile.py) e
responde a pergunta que interessa: "se a prova fosse hoje, você projeta X
de Y pontos — faltam A pra não ser eliminado, B pro corte da sua região."
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

from prf.engines.exam_profile import ExamProfile

# Horas estimadas pra fechar 100% do gap de acurácia numa matéria — mesma
# heurística de antes (HOURS_PER_MASTERY_POINT), só que agora aplicada em
# cima de itens reais do blueprint, não de peso abstrato.
HOURS_PER_ACCURACY_POINT = 8.0


@dataclass
class SubjectMastery:
    subject_slug: str
    subject_name: str
    accuracy: float           # 0-1, acurácia recente
    total_attempts: int
    trend: float = 0.0        # positivo = melhorando


@dataclass
class SubjectProjection:
    subject_name: str
    subject_slug: str
    items_in_blueprint: int
    block_weight: float
    projected_correct: float     # itens que você acertaria hoje, nesse recorte
    max_points: float            # items_in_blueprint * block_weight
    projected_points: float      # projected_correct * block_weight
    points_at_risk: float        # max_points - projected_points
    hours_to_close_gap: float
    points_per_hour: float       # retorno de uma hora de estudo nessa matéria
    zero_risk: bool              # projeta menos de 1 item certo — risco de zerar a área


@dataclass
class ApprovalPrediction:
    projected_points: float
    max_points: float
    survive_threshold: float     # pontos mínimos pra não ser eliminado
    gap_to_survive: float
    eliminated_risk: bool
    target_cutoff: Optional[float]   # corte da região/certame, se informado
    gap_to_cutoff: Optional[float]
    zero_risk_subjects: list[str]
    factors: list[SubjectProjection]     # ordenado por pontos em risco (maior primeiro)
    best_value: list[SubjectProjection]  # top 3 por pontos/hora — as barganhas
    trend: str
    days_until_exam: Optional[int] = None
    probability: float = 0.0     # projected_points / max_points — mantido por compat com UI que já lê esse campo


def estimate_approval(
    profile: ExamProfile,
    subjects: list[SubjectMastery],
    target_cutoff: Optional[float] = None,
    exam_date: Optional[date] = None,
    today: Optional[date] = None,
) -> ApprovalPrediction:
    today = today or date.today()
    by_slug = {s.subject_slug: s for s in subjects}

    factors: list[SubjectProjection] = []
    projected_points = 0.0
    zero_risk: list[str] = []
    overall_trend = 0.0
    trend_weight = 0.0

    for block in profile.blocks:
        for slug in block.subjects:
            items = profile.items_of(slug)
            if items <= 0:
                continue

            s = by_slug.get(slug)
            # Sem tentativa nenhuma na matéria: assume 0 pontos. Melhor
            # superestimar o risco do que descobrir na hora da prova que
            # zerou uma área nunca estudada.
            accuracy = s.accuracy if s and s.total_attempts > 0 else 0.0
            subject_name = s.subject_name if s else slug

            proj_correct = accuracy * items
            max_pts = items * block.weight
            proj_pts = proj_correct * block.weight
            gap_items = max(0.0, items - proj_correct)
            hours = round(gap_items / items * HOURS_PER_ACCURACY_POINT, 1)
            pts_per_hour = round((max_pts - proj_pts) / hours, 2) if hours > 0 else 0.0
            is_zero_risk = proj_correct < 1.0

            if is_zero_risk:
                zero_risk.append(subject_name)
            if s:
                overall_trend += s.trend * max_pts
                trend_weight += max_pts

            projected_points += proj_pts
            factors.append(SubjectProjection(
                subject_name=subject_name,
                subject_slug=slug,
                items_in_blueprint=items,
                block_weight=block.weight,
                projected_correct=round(proj_correct, 1),
                max_points=round(max_pts, 1),
                projected_points=round(proj_pts, 1),
                points_at_risk=round(max_pts - proj_pts, 1),
                hours_to_close_gap=hours,
                points_per_hour=pts_per_hour,
                zero_risk=is_zero_risk,
            ))

    max_points = profile.max_points
    survive_threshold = profile.survive_threshold
    gap_to_survive = round(max(0.0, survive_threshold - projected_points), 1)
    eliminated_risk = projected_points < survive_threshold or (profile.zero_eliminates and bool(zero_risk))

    gap_to_cutoff = None
    if target_cutoff is not None:
        gap_to_cutoff = round(max(0.0, target_cutoff - projected_points), 1)

    days_left = None
    if exam_date:
        days_left = max(0, (exam_date - today).days)

    trend = "stable"
    if trend_weight > 0:
        avg_trend = overall_trend / trend_weight
        if avg_trend > 0.02:
            trend = "improving"
        elif avg_trend < -0.02:
            trend = "declining"

    factors.sort(key=lambda f: f.points_at_risk, reverse=True)
    best_value = sorted(
        (f for f in factors if f.points_at_risk > 0),
        key=lambda f: f.points_per_hour, reverse=True,
    )[:3]

    return ApprovalPrediction(
        projected_points=round(projected_points, 1),
        max_points=round(max_points, 1),
        survive_threshold=survive_threshold,
        gap_to_survive=gap_to_survive,
        eliminated_risk=eliminated_risk,
        target_cutoff=target_cutoff,
        gap_to_cutoff=gap_to_cutoff,
        zero_risk_subjects=zero_risk,
        factors=factors,
        best_value=best_value,
        trend=trend,
        days_until_exam=days_left,
        probability=round(projected_points / max_points, 3) if max_points else 0.0,
    )
