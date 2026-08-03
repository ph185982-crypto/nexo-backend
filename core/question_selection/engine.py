"""
QuestionSelectionEngine — public entry point.

Single public class. Four public methods:
  select()              → QuestionSelectionResult | None
  buildCandidatePool()  → list[QuestionCandidate]
  rankCandidates()      → list[QuestionCandidate]
  explainSelection()    → str

Usage::

    engine = QuestionSelectionEngine()
    result = engine.select(context)
    if result:
        print(engine.explainSelection(result))

Thread safety: stateless (no instance-level mutable state), safe to share
across threads if scorers are also stateless (default scorers are).
"""
from __future__ import annotations

from typing import Optional

from .interfaces.context import QuestionSelectionContext
from .interfaces.output import QuestionSelectionResult
from .models.candidate import QuestionCandidate
from .models.enums import SelectionReason
from .pipeline.builder import CandidatePoolBuilder
from .pipeline.filter import CandidateFilter
from .pipeline.ranker import CandidateRanker
from .scorers import default_scorers


class QuestionSelectionEngine:
    """
    Stateless orchestrator for the question selection pipeline.

    Dependency Injection: pass a custom scorers_with_weights list to override
    the default scoring model (e.g., for A/B testing or domain customisation).
    """

    def __init__(self, scorers_with_weights: Optional[list[tuple]] = None) -> None:
        sw = scorers_with_weights if scorers_with_weights is not None else default_scorers()
        self._builder = CandidatePoolBuilder()
        self._filter  = CandidateFilter()
        self._ranker  = CandidateRanker(sw)

    # ── Public API ────────────────────────────────────────────────────────────

    def select(
        self,
        context: QuestionSelectionContext,
    ) -> Optional[QuestionSelectionResult]:
        """
        Run the full pipeline and return the best question.

        Returns None only when the available pool is completely empty
        (all questions filtered out — should not happen in practice).
        """
        pool   = self.buildCandidatePool(context)
        if not pool:
            return None
        ranked = self.rankCandidates(pool, context)
        return self._make_result(ranked[0], ranked[1:4], context)

    def buildCandidatePool(
        self,
        context: QuestionSelectionContext,
    ) -> list[QuestionCandidate]:
        """
        Build and filter the candidate pool from context.available_questions.

        Pipeline:
          1. Convert QuestionSnapshot → QuestionCandidate
          2. Remove session-used questions
          3. Remove recently answered (24h) when mastery is high
          4. Apply article diversity rules
          5. Remove questions that exceed remaining session time
        """
        raw      = self._builder.build(context)
        filtered = self._filter.exclude_session_used(raw, context)
        filtered = self._filter.exclude_recently_answered(filtered, context)
        filtered = self._filter.apply_diversity_rules(filtered, context)
        filtered = self._filter.exclude_time_overrun(filtered, context)
        return filtered

    def rankCandidates(
        self,
        candidates: list[QuestionCandidate],
        context: QuestionSelectionContext,
    ) -> list[QuestionCandidate]:
        """
        Score every candidate with all scorers and return sorted list (best first).

        Side effect: writes composite_score, score_breakdown, primary_reason
        onto each QuestionCandidate (candidates are mutable).
        """
        return self._ranker.rank(candidates, context)

    def explainSelection(self, result: QuestionSelectionResult) -> str:
        """
        Return a human-readable explanation of why a question was selected.

        Useful for debugging, admin dashboards, and engineering logs.
        """
        lines = [
            f"Selected question: {result.question_id}",
            f"  Mode:           {result.selection_mode.value}",
            f"  Primary reason: {result.selection_reason.value}",
            f"  Composite score:{result.selection_score:.4f}",
            f"  Difficulty:     {result.difficulty.value}",
            f"  Est. time:      {result.estimated_time_secs}s",
            f"  Est. gain:      {result.estimated_learning_gain:.4f}",
            "",
            "  Score breakdown (scorer → raw score):",
        ]
        for name, raw in sorted(result.score_breakdown.items(), key=lambda x: -x[1]):
            lines.append(f"    {name:20s}: {raw:.4f}")

        if result.alternative_question_ids:
            lines.append(
                f"  Alternatives: {[str(q) for q in result.alternative_question_ids]}"
            )
        return "\n".join(lines)

    # ── Private ───────────────────────────────────────────────────────────────

    def _make_result(
        self,
        best: QuestionCandidate,
        alternatives: list[QuestionCandidate],
        context: QuestionSelectionContext,
    ) -> QuestionSelectionResult:
        # estimated_learning_gain = raw score from learning_gain scorer
        lg = best.score_breakdown.get("learning_gain", 0.50)

        return QuestionSelectionResult(
            question_id=best.question_id,
            selection_reason=best.primary_reason,
            selection_score=best.composite_score,
            difficulty=best.difficulty,
            estimated_learning_gain=round(lg, 4),
            estimated_time_secs=best.estimated_time_secs,
            related_article_id=best.article_id,
            related_topic_id=best.topic_id,
            score_breakdown=dict(best.score_breakdown),
            alternative_question_ids=tuple(a.question_id for a in alternatives),
            selection_mode=context.mode,
        )
