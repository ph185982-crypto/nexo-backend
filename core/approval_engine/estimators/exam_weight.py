"""
ExamWeightEstimator — measures mastery specifically in the highest-weighted exam subjects.

The exam is not equal across subjects. Winning the highest-weight subjects
has a disproportionate impact on the final score. This estimator rewards
mastery concentrated in what the exam tests most.

Weight: 0.20
"""
from __future__ import annotations

from ..interfaces.context import ApprovalContext
from ..models.estimator import BaseEstimator, EstimatorResult

_MASTERY_CEILING = 100.0   # mastery_score is 0-100
_MIN_WEIGHT_FOR_CRITICAL = 0.15  # subjects above this normalised weight are "critical"


class ExamWeightEstimator(BaseEstimator):
    """
    Formula per subject:
        subject_contribution = (mastery_score / 100) × normalised_weight × coverage_bonus

    where:
        normalised_weight = exam_weight / max_exam_weight
        coverage_bonus = 1.0 if coverage_ratio ≥ 0.5, else coverage_ratio × 2

    Global score:
        exam_weight_score = Σ(subject_contribution × normalised_weight) / Σ(normalised_weight)
    """

    @property
    def name(self) -> str:
        return "exam_weight"

    @property
    def weight(self) -> float:
        return 0.20

    def estimate(self, context: ApprovalContext) -> EstimatorResult:
        if not context.subjects:
            return EstimatorResult(
                name=self.name,
                score=0.0,
                weight=self.weight,
                confidence=0.0,
                explanation="Sem matérias registradas.",
            )

        max_w = context.max_exam_weight
        total_norm_w = sum(s.exam_weight / max_w for s in context.subjects) or 1.0

        weighted_sum = 0.0
        detail: dict = {}
        underperforming_critical: list[str] = []

        for s in context.subjects:
            norm_w = s.exam_weight / max_w
            mastery_frac = s.mastery_score / _MASTERY_CEILING
            coverage_bonus = min(s.coverage_ratio * 2.0, 1.0) if s.coverage_ratio < 0.5 else 1.0
            contribution = mastery_frac * norm_w * coverage_bonus
            weighted_sum += contribution * norm_w
            detail[s.subject_slug] = round(contribution, 4)

            if norm_w >= _MIN_WEIGHT_FOR_CRITICAL and s.mastery_score < 50.0:
                underperforming_critical.append(s.subject_name)

        score = min(weighted_sum / total_norm_w, 1.0)
        confidence = _confidence(context)
        explanation = _build_explanation(score, underperforming_critical)

        return EstimatorResult(
            name=self.name,
            score=round(score, 4),
            weight=self.weight,
            confidence=confidence,
            explanation=explanation,
            detail={
                "per_subject": detail,
                "underperforming_critical": underperforming_critical,
            },
        )


def _confidence(context: ApprovalContext) -> float:
    total_attempts = sum(s.total_attempts for s in context.subjects)
    return min(0.9, total_attempts / 300.0)


def _build_explanation(score: float, underperforming: list[str]) -> str:
    if underperforming:
        return (
            f"Desempenho fraco nas matérias de maior peso: "
            f"{', '.join(underperforming[:3])}. Score: {score:.0%}"
        )
    if score >= 0.75:
        return f"Bom domínio nas matérias mais cobradas. Score: {score:.0%}"
    return f"Domínio médio nas matérias de maior peso no edital. Score: {score:.0%}"
