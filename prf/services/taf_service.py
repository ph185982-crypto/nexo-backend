"""
TAF projection — tendência de evolução física até a data da prova.

O índice mínimo do edital varia por gênero/idade e o próximo certame ainda não
saiu, então o app não crava número nenhum como "meta oficial" — o candidato
informa a própria meta (user_profiles.taf_targets) e aqui só projetamos a
tendência de regressão linear simples contra ela. Barra é historicamente o
exercício que mais reprova e o que menos se resolve em cima da hora — por
isso a projeção existe: dá pra ver se o ritmo atual chega lá antes da prova.
"""
from __future__ import annotations
from datetime import date
from typing import Optional

EXERCISES = ["barra_reps", "flexao_reps", "abdominal_reps", "corrida_12min_metros"]

EXERCISE_LABELS = {
    "barra_reps": "Barra fixa",
    "flexao_reps": "Flexão de braço",
    "abdominal_reps": "Abdominal",
    "corrida_12min_metros": "Corrida 12min (metros)",
}


def _linear_fit(points: list[tuple[int, float]]) -> tuple[float, float]:
    """Regressão linear simples (mínimos quadrados). Retorna (slope, intercept)."""
    n = len(points)
    if n < 2:
        return 0.0, points[0][1] if points else 0.0
    sum_x = sum(p[0] for p in points)
    sum_y = sum(p[1] for p in points)
    sum_xy = sum(p[0] * p[1] for p in points)
    sum_xx = sum(p[0] * p[0] for p in points)
    denom = n * sum_xx - sum_x * sum_x
    if denom == 0:
        return 0.0, sum_y / n
    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n
    return slope, intercept


def project_taf(
    records: list[dict],
    targets: dict,
    exam_date: Optional[date],
    today: Optional[date] = None,
) -> list[dict]:
    """Uma projeção por exercício com medição registrada."""
    today = today or date.today()
    projections = []

    for exercise in EXERCISES:
        points = [
            (r["measured_at"], r[exercise])
            for r in records
            if r.get(exercise) is not None
        ]
        if not points:
            continue
        points.sort(key=lambda p: p[0])
        base_date = points[0][0]
        xy = [((d - base_date).days, float(v)) for d, v in points]

        slope, intercept = _linear_fit(xy)
        latest_value = xy[-1][1]
        trend_per_week = round(slope * 7, 2)

        target = targets.get(exercise)
        projected_at_exam = None
        gap_to_target = None
        on_track = None

        if exam_date and exam_date >= today:
            days_to_exam = (exam_date - base_date).days
            projected_at_exam = round(intercept + slope * days_to_exam, 1)
            if target is not None:
                gap_to_target = round(target - projected_at_exam, 1)
                on_track = projected_at_exam >= target

        projections.append({
            "exercise": exercise,
            "label": EXERCISE_LABELS[exercise],
            "latest_value": latest_value,
            "target": target,
            "trend_per_week": trend_per_week,
            "projected_at_exam": projected_at_exam,
            "gap_to_target": gap_to_target,
            "on_track": on_track,
        })

    return projections
