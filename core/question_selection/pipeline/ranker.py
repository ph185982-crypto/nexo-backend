"""
CandidateRanker — scores every candidate and sorts by composite score.

Each scorer produces a value in [0, 1]. The composite is a weighted sum:
  composite = Σ (scorer.weight × scorer.score(candidate, context))

The primary_reason is the scorer whose weighted contribution is largest,
providing a human-readable explanation of why the top candidate was chosen.

Scorer failures are caught and clamped to 0.0 — a broken scorer degrades
gracefully without crashing the session.
"""
from __future__ import annotations

from ..interfaces.context import QuestionSelectionContext
from ..models.candidate import QuestionCandidate
from ..models.enums import SelectionReason


# Maps scorer name → SelectionReason for primary_reason assignment
_SCORER_TO_REASON: dict[str, SelectionReason] = {
    "knowledge_gap":   SelectionReason.KNOWLEDGE_GAP,
    "exam_weight":     SelectionReason.EXAM_FREQUENCY,
    "recurrence":      SelectionReason.RECURRING_MISTAKE,
    "retention":       SelectionReason.RETENTION_DUE,
    "difficulty":      SelectionReason.DIFFICULTY_MATCH,
    "learning_gain":   SelectionReason.BEST_ROI,
    "objective":       SelectionReason.OBJECTIVE_ALIGNMENT,
    "coverage":        SelectionReason.COVERAGE_BALANCE,
    "recent_exposure": SelectionReason.COVERAGE_BALANCE,
    "time_cost":       SelectionReason.DIFFICULTY_MATCH,
}


class CandidateRanker:
    """
    Applies all scorers to every candidate, writes composite_score and
    score_breakdown, then returns a list sorted by composite_score DESC.
    """

    def __init__(self, scorers_with_weights: list[tuple]) -> None:
        # list of (scorer_instance, weight_float)
        self._scorers = scorers_with_weights
        self._name_to_weight: dict[str, float] = {
            s.name: w for s, w in scorers_with_weights
        }

    def rank(
        self,
        candidates: list[QuestionCandidate],
        context: QuestionSelectionContext,
    ) -> list[QuestionCandidate]:
        for candidate in candidates:
            self._score(candidate, context)
        return sorted(candidates, key=lambda c: c.composite_score, reverse=True)

    # ── Private ───────────────────────────────────────────────────────────────

    def _score(
        self,
        candidate: QuestionCandidate,
        context: QuestionSelectionContext,
    ) -> None:
        total = 0.0
        breakdown: dict[str, float] = {}

        for scorer, weight in self._scorers:
            try:
                raw = float(scorer.score(candidate, context))
                raw = max(0.0, min(1.0, raw))
            except Exception:
                raw = 0.0
            breakdown[scorer.name] = raw
            total += raw * weight

        candidate.composite_score = round(total, 6)
        candidate.score_breakdown = breakdown

        # Primary reason = scorer with highest weighted contribution
        contributions = {
            name: breakdown.get(name, 0.0) * self._name_to_weight.get(name, 0.0)
            for name in breakdown
        }
        if contributions:
            top_name = max(contributions, key=lambda k: contributions[k])
            candidate.primary_reason = _SCORER_TO_REASON.get(top_name, SelectionReason.FALLBACK)
        else:
            candidate.primary_reason = SelectionReason.FALLBACK
