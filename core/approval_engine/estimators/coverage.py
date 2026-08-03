"""
CoverageEstimator — measures breadth of study coverage across exam topics.

Coverage = fraction of exam topics studied at minimum depth.
Uncovered topics score zero on the real exam, which directly caps maximum score.

Weight: 0.30 — largest single factor because an exam is won or lost on breadth,
not on perfect mastery of a narrow slice.
"""
from __future__ import annotations

from ..interfaces.context import ApprovalContext
from ..models.estimator import BaseEstimator, EstimatorResult

_MIN_ATTEMPTS = 5          # below this → topic is "not yet covered"
_MIN_MASTERY = 30.0        # below this → topic is "covered but critical"
_COVERAGE_THRESHOLD = 0.70 # fraction of coverage needed for "good"


class CoverageEstimator(BaseEstimator):
    """
    Computes a coverage score per subject (weighted by exam weight) and
    aggregates to a single 0-1 score.

    Formula per subject:
        subject_score = coverage_ratio × (mastery_score / 100)
        (coverage_ratio = fraction of topics attempted;
         mastery_score = accuracy-weighted knowledge depth)

    Global score:
        coverage_score = Σ(subject_score × exam_weight) / Σ(exam_weight)
    """

    @property
    def name(self) -> str:
        return "coverage"

    @property
    def weight(self) -> float:
        return 0.30

    def estimate(self, context: ApprovalContext) -> EstimatorResult:
        if not context.subjects:
            return EstimatorResult(
                name=self.name,
                score=0.0,
                weight=self.weight,
                confidence=0.0,
                explanation="Nenhuma matéria registrada.",
            )

        total_weight = context.total_exam_weight
        weighted_sum = 0.0
        detail: dict = {}
        low_coverage: list[str] = []
        no_coverage: list[str] = []

        for s in context.subjects:
            # Effective coverage: only count topics attempted above minimum threshold
            effective_cov = s.coverage_ratio
            if s.total_attempts < _MIN_ATTEMPTS:
                effective_cov *= 0.5   # penalise subjects barely touched

            subject_score = effective_cov * (s.mastery_score / 100.0)
            norm_weight = s.exam_weight / total_weight
            weighted_sum += subject_score * norm_weight

            detail[s.subject_slug] = round(subject_score, 4)
            if s.coverage_ratio < 0.20:
                no_coverage.append(s.subject_name)
            elif s.coverage_ratio < _COVERAGE_THRESHOLD:
                low_coverage.append(s.subject_name)

        score = min(weighted_sum, 1.0)
        confidence = _confidence_from_attempts(context)
        explanation = _build_explanation(score, no_coverage, low_coverage)

        return EstimatorResult(
            name=self.name,
            score=round(score, 4),
            weight=self.weight,
            confidence=confidence,
            explanation=explanation,
            detail={"per_subject": detail, "low_coverage": low_coverage, "no_coverage": no_coverage},
        )


def _confidence_from_attempts(context: ApprovalContext) -> float:
    """More attempts → higher confidence in the coverage estimate."""
    total = sum(s.total_attempts for s in context.subjects)
    if total < 20:
        return 0.2
    if total < 100:
        return 0.5
    return min(0.9, total / 500.0)


def _build_explanation(score: float, no_coverage: list, low_coverage: list) -> str:
    if no_coverage:
        return (
            f"Cobertura crítica: {', '.join(no_coverage[:3])} sem estudo registrado. "
            f"Score: {score:.0%}"
        )
    if low_coverage:
        return f"Cobertura baixa em: {', '.join(low_coverage[:3])}. Score: {score:.0%}"
    if score >= 0.80:
        return f"Cobertura boa em todas as matérias. Score: {score:.0%}"
    return f"Cobertura razoável, mas há lacunas. Score: {score:.0%}"
