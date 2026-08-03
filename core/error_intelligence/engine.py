"""
ErrorIntelligenceEngine — public entry point for all error diagnosis.

Responsibilities:
  - Classify every wrong answer with a primary cause.
  - Score severity based on exam impact.
  - Identify root cause in plain language.
  - Detect recurring behavioural patterns.
  - Track whether errors are improving or worsening.
  - Surface related knowledge from the Knowledge Graph.
  - Generate a structured treatment plan.
  - Produce a human-readable diagnostic report.

Does NOT:
  - Create flashcards.
  - Schedule reviews.
  - Update missions.
  - Modify the approval estimate.
  - Access any database.

The engine is stateless. Callers own data fetching and caching.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from .interfaces.context import ErrorContext, ErrorEntrySnapshot, PreviousAttemptSnapshot
from .interfaces.analysis import (
    ErrorAnalysis,
    PatternMatch,
    RelatedKnowledge,
    TreatmentAction,
)
from .models.enums import ErrorClassification, ErrorSeverity

from .classifiers.error_classifier import classify
from .analyzers.severity import score as _score_severity, score_numeric as _score_numeric
from .analyzers.root_cause import analyze as _root_cause
from .analyzers.evolution import track as _track_evolution
from .analyzers.pattern import detect as _detect_patterns
from .services.knowledge_service import build_related_knowledge
from .services.treatment_service import build_treatment
from .services.report_service import generate_report as _generate_report


class ErrorIntelligenceEngine:
    """
    Stateless error diagnosis engine.

    Instantiate once; call methods as many times as needed.
    All methods are synchronous — no I/O.

    Example::

        engine = ErrorIntelligenceEngine()
        analysis = engine.analyze(context)
        report   = engine.generateReport(analysis)
    """

    def analyze(self, context: ErrorContext) -> ErrorAnalysis:
        """
        Full diagnosis of one wrong answer.

        Pipeline:
          1. classify() — assigns primary cause
          2. score_severity() — estimates impact
          3. root_cause() — explains WHY in plain language
          4. build_related_knowledge() — surfaces KGE content
          5. build_treatment() — generates remediation plan
          6. track_evolution() — checks if error is improving
          7. assemble ErrorAnalysis
        """
        classification, scores = classify(context)
        severity = _score_severity(context, classification)
        severity_numeric = _score_numeric(context, classification)

        root_cause_sentence, knowledge_gap = _root_cause(context, classification)
        related = build_related_knowledge(context.origin_result, classification)
        actions = build_treatment(classification, severity, context)
        evolution = _track_evolution(context)

        review_priority = _compute_review_priority(severity, context)
        estimated_gain = _compute_estimated_gain(severity_numeric, context)

        return ErrorAnalysis(
            user_id=context.user_id,
            question_id=context.question.question_id,
            analyzed_at=datetime.now(timezone.utc),
            classification=classification.value,
            severity=severity.value,
            root_cause=root_cause_sentence,
            knowledge_gap=knowledge_gap,
            related_knowledge=related,
            recommended_actions=actions,
            review_priority=review_priority,
            estimated_gain=round(estimated_gain, 4),
            evolution=evolution,
            pattern_match=None,   # callers use findPatterns() separately on aggregate data
            classifier_scores=scores,
        )

    def buildTreatment(
        self,
        analysis: ErrorAnalysis,
        context: ErrorContext,
    ) -> list[TreatmentAction]:
        """
        (Re-)generate a treatment plan from an existing analysis.

        Useful when the caller wants to override classification or severity
        before building actions, without re-running the full pipeline.
        """
        classification = ErrorClassification(analysis.classification)
        severity = ErrorSeverity(analysis.severity)
        return build_treatment(classification, severity, context)

    def findPatterns(
        self,
        recent_errors: list[ErrorEntrySnapshot],
        recent_attempts: list[PreviousAttemptSnapshot],
    ) -> list[PatternMatch]:
        """
        Detect recurring behavioural patterns across a user's error history.

        Callers pass aggregate data (from ErrorRepositoryPort):
          recent_errors   — from error_notebook (unresolved, last N)
          recent_attempts — from question_attempts (last 30 days)

        Returns patterns with confidence ≥ 0.50, sorted by confidence desc.
        """
        patterns = _detect_patterns(recent_errors, recent_attempts)
        return sorted(patterns, key=lambda p: p.confidence, reverse=True)

    def findRootCause(
        self,
        context: ErrorContext,
        classification: str,
    ) -> str:
        """
        Return just the root-cause sentence for a given classification.

        Useful when the caller already has a classification and only needs
        the human-readable explanation.
        """
        cls = ErrorClassification(classification)
        sentence, _ = _root_cause(context, cls)
        return sentence

    def relatedKnowledge(self, context: ErrorContext) -> RelatedKnowledge:
        """
        Surface related Knowledge Graph content for this error context.

        Requires context.origin_result to be pre-populated by the caller
        (the caller runs KGE.find_error_origins() and passes the result in).
        Returns an empty RelatedKnowledge when origin_result is None.
        """
        # Infer most likely classification to determine mission hints
        classification, _ = classify(context)
        return build_related_knowledge(context.origin_result, classification)

    def generateReport(self, analysis: ErrorAnalysis) -> dict:
        """
        Convert an ErrorAnalysis into a structured diagnostic report.

        The report contains three sections:
          summary   — one-liner for UI display
          diagnosis — full breakdown for detailed view
          actions   — prioritised remediation list
        """
        return _generate_report(analysis)


# ── Private helpers ───────────────────────────────────────────────────────


def _compute_review_priority(severity: ErrorSeverity, context: ErrorContext) -> int:
    """Maps severity + recurrence to a 1-10 review queue priority."""
    base = {
        ErrorSeverity.CRITICAL: 9,
        ErrorSeverity.HIGH:     7,
        ErrorSeverity.MEDIUM:   5,
        ErrorSeverity.LOW:      3,
    }.get(severity, 5)

    # Boost for recurring errors
    if context.is_recurring_error:
        repeated = context.error_entry.times_repeated if context.error_entry else 0
        base = min(base + min(repeated // 2, 2), 10)

    # Boost when review is already overdue
    if context.is_overdue_for_review:
        base = min(base + 1, 10)

    return base


def _compute_estimated_gain(severity_numeric: float, context: ErrorContext) -> float:
    """
    Estimates approval probability gain from resolving this error.

    Factors:
      - severity_numeric: how much this error hurts (0-1)
      - subject weight relative to total exam weight (if available)
      - recurrence: recurring errors have higher impact if fixed
    """
    base_gain = severity_numeric * 0.15  # cap at 15% gain per single error

    if context.approval and context.approval.subject_weight:
        # Scale by subject's importance in the exam
        weight_factor = min(context.approval.subject_weight / 3.0, 1.0)
        base_gain *= weight_factor

    if context.is_recurring_error and context.error_entry:
        recurrence_boost = min(context.error_entry.times_repeated * 0.01, 0.05)
        base_gain += recurrence_boost

    return min(base_gain, 0.20)
