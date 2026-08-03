"""
LearningProfileBuilder — orchestrates all analyzers and estimators.

Single Responsibility: given raw data from the port, produce a LearningProfile.
Pure computation — no I/O, no side effects. Safe to test without infrastructure.
"""
from __future__ import annotations
from datetime import datetime, timezone
from uuid import UUID

from ..analyzers.confidence import ConfidenceAnalyzer
from ..analyzers.confusion import ConfusionAnalyzer
from ..analyzers.fatigue import FatigueAnalyzer
from ..analyzers.format_preference import PreferredFormatAnalyzer
from ..analyzers.learning_speed import LearningSpeedAnalyzer
from ..analyzers.retention import RetentionAnalyzer
from ..analyzers.review_efficiency import ReviewEfficiencyAnalyzer
from ..analyzers.sequence_preference import PreferredSequenceAnalyzer
from ..analyzers.stability import KnowledgeStabilityAnalyzer
from ..estimators.confidence import ConfidenceEstimator
from ..estimators.forgetting import ForgettingEstimator
from ..estimators.mastery import MasteryEstimator
from ..estimators.retention import RetentionEstimator
from ..interfaces.observations import (
    AttemptRecord,
    BehaviorMetricsRecord,
    ErrorRecord,
    MasteryRecord,
    ReviewCardRecord,
    SessionRecord,
)
from ..interfaces.profile import LearningProfile


class LearningProfileBuilder:
    """
    Assembles a LearningProfile from raw historical data.

    Call order:
    1. All analyzers (pure, parallel-safe)
    2. All estimators (depend on analyzer-level data)
    3. Assembly into LearningProfile
    """

    def __init__(self) -> None:
        # Analyzers
        self._speed_analyzer = LearningSpeedAnalyzer()
        self._retention_analyzer = RetentionAnalyzer()
        self._confidence_analyzer = ConfidenceAnalyzer()
        self._fatigue_analyzer = FatigueAnalyzer()
        self._confusion_analyzer = ConfusionAnalyzer()
        self._stability_analyzer = KnowledgeStabilityAnalyzer()
        self._format_analyzer = PreferredFormatAnalyzer()
        self._sequence_analyzer = PreferredSequenceAnalyzer()
        self._review_efficiency_analyzer = ReviewEfficiencyAnalyzer()

        # Estimators
        self._retention_estimator = RetentionEstimator()
        self._forgetting_estimator = ForgettingEstimator()
        self._confidence_estimator = ConfidenceEstimator()
        self._mastery_estimator = MasteryEstimator()

    def build(
        self,
        user_id: UUID,
        target_exam: str,
        attempts: list[AttemptRecord],
        sessions: list[SessionRecord],
        cards: list[ReviewCardRecord],
        errors: list[ErrorRecord],
        mastery: list[MasteryRecord],
        behavior: BehaviorMetricsRecord | None,
    ) -> LearningProfile:
        now = datetime.now(timezone.utc)

        # ── Phase 1: Analyzers ────────────────────────────────────────
        learning_speed = self._speed_analyzer.analyze(attempts, sessions)
        retention_strength = self._retention_analyzer.analyze(cards)
        confidence = self._confidence_analyzer.analyze(attempts, mastery)
        knowledge_stability = self._stability_analyzer.analyze(attempts)
        preferred_format = self._format_analyzer.analyze(sessions)
        preferred_sequence = self._sequence_analyzer.analyze(sessions, behavior)
        review_efficiency = self._review_efficiency_analyzer.analyze(cards)
        fatigue_threshold = self._fatigue_analyzer.analyze(attempts, sessions, behavior)
        confusion_matrix = self._confusion_analyzer.analyze(errors)

        # ── Phase 2: Estimators ───────────────────────────────────────
        forgetting_velocity = self._forgetting_estimator.estimate(cards)
        mastery_projections = self._mastery_estimator.estimate(mastery, attempts)
        topic_confidence = self._confidence_estimator.estimate(attempts)

        # ── Phase 3: Summary ──────────────────────────────────────────
        summary = _build_summary(
            learning_speed.category,
            retention_strength.category,
            preferred_format.primary,
            preferred_sequence.energy_pattern,
            confidence.overall,
        )

        return LearningProfile(
            user_id=user_id,
            target_exam=target_exam,
            computed_at=now,
            learning_speed=learning_speed,
            retention_strength=retention_strength,
            confidence=confidence,
            knowledge_stability=knowledge_stability,
            preferred_format=preferred_format,
            preferred_sequence=preferred_sequence,
            review_efficiency=review_efficiency,
            fatigue_threshold=fatigue_threshold,
            confusion_matrix=confusion_matrix,
            topic_mastery_confidence=topic_confidence,
            forgetting_velocity=forgetting_velocity,
            mastery_projections=mastery_projections,
            cognitive_summary=summary,
        )


def _build_summary(
    speed: str,
    retention: str,
    fmt: str,
    pattern: str,
    confidence: float,
) -> str:
    """Produce a one-line human-readable cognitive profile description."""
    conf_label = "alta" if confidence > 0.65 else "média" if confidence > 0.40 else "baixa"
    return (
        f"Aprendiz {speed} | retenção {retention} | prefere {fmt} | "
        f"pico {pattern} | confiança {conf_label} ({confidence:.0%})"
    )
