"""
ConfidenceEstimator — measures calibration between perceived and actual mastery.

A well-calibrated student knows what they know and what they don't,
which translates to fewer careless errors and better test strategy.

Weight: 0.03 — smallest factor; useful as a tiebreaker and diagnostic signal.
"""
from __future__ import annotations

from ..interfaces.context import ApprovalContext
from ..models.estimator import BaseEstimator, EstimatorResult

_HIGH_CONFIDENCE = 0.70  # confidence_overall above this → "well calibrated"
_LOW_CONFIDENCE = 0.40   # below this → "poor calibration / underconfident"


class ConfidenceEstimator(BaseEstimator):
    """
    Uses two signals from the LearningProfile cognitive context:

    1. confidence_overall (0-1):
       Derived from LearningProfile.confidence calibration score.
       Measures accuracy vs self-reported confidence on answered questions.

    2. session accuracy consistency:
       Low variance in session accuracy → reliable performance under pressure.
       High variance → unpredictable; penalised regardless of average.

    Formula:
        confidence_score = confidence_overall × 0.70 + stability_score × 0.30
    """

    @property
    def name(self) -> str:
        return "confidence"

    @property
    def weight(self) -> float:
        return 0.03

    def estimate(self, context: ApprovalContext) -> EstimatorResult:
        conf = context.confidence_overall
        stability = _session_stability(context)

        score = conf * 0.70 + stability * 0.30
        score = max(0.0, min(score, 1.0))

        # Low confidence when learning_context is absent
        confidence = 0.5 if context.learning_context else 0.2
        explanation = _build_explanation(score, conf, stability)

        return EstimatorResult(
            name=self.name,
            score=round(score, 4),
            weight=self.weight,
            confidence=confidence,
            explanation=explanation,
            detail={
                "confidence_overall": round(conf, 4),
                "session_stability": round(stability, 4),
            },
        )


def _session_stability(context: ApprovalContext) -> float:
    """
    Measures consistency of session-level accuracy across recent missions.
    Returns 1.0 when all missions have uniform scores; lower when erratic.
    """
    scored = [m.score for m in context.missions if m.score is not None]
    if len(scored) < 3:
        # Not enough data → neutral
        return 0.5
    mean = sum(scored) / len(scored)
    variance = sum((x - mean) ** 2 for x in scored) / len(scored)
    # variance in [0, 0.25] for scores in [0,1]; map to stability 0-1
    return max(0.0, 1.0 - variance * 4.0)


def _build_explanation(score: float, conf: float, stability: float) -> str:
    if conf >= _HIGH_CONFIDENCE and stability >= 0.70:
        return f"Calibração e consistência excelentes. Score: {score:.0%}"
    if conf < _LOW_CONFIDENCE:
        return f"Calibração fraca — resultados imprevisíveis. Score: {score:.0%}"
    if stability < 0.40:
        return f"Desempenho instável entre sessões. Score: {score:.0%}"
    return f"Calibração moderada. Score: {score:.0%}"
