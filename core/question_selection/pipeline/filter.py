"""
CandidateFilter — eliminates ineligible candidates before scoring.

Four filtering passes applied in order:
  1. exclude_session_used()      → removes questions already presented this session
  2. exclude_recently_answered() → removes questions seen in last 24h when mastery ≥ 0.70
  3. apply_diversity_rules()     → removes over-represented articles when pool is large
  4. exclude_time_overrun()      → removes questions that exceed remaining session time

Design principle: filters are hard exits, not soft penalties. Candidates that
survive all filters enter the ranker on equal footing; it is the scorers' job
to differentiate them.

Fallback: if a filter would eliminate every remaining candidate it is skipped
so the engine always returns *something* rather than None.
"""
from __future__ import annotations

from ..interfaces.context import QuestionSelectionContext
from ..models.candidate import QuestionCandidate


_MASTERY_THRESHOLD_FOR_DEDUP = 0.70   # above this, avoid 24h repetition
_MAX_SAME_ARTICLE = 5                  # diversity rule ceiling
_MIN_POOL_FOR_DIVERSITY = 10           # don't apply diversity to tiny pools


class CandidateFilter:

    # ── Pass 1: session deduplication ────────────────────────────────────────

    def exclude_session_used(
        self,
        candidates: list[QuestionCandidate],
        context: QuestionSelectionContext,
    ) -> list[QuestionCandidate]:
        """Remove questions the student has already seen this session."""
        used = frozenset(context.session_questions)
        result = [c for c in candidates if c.question_id not in used]
        return result if result else candidates  # fallback: never return empty

    # ── Pass 2: recent-exposure dedup (24 h window) ───────────────────────────

    def exclude_recently_answered(
        self,
        candidates: list[QuestionCandidate],
        context: QuestionSelectionContext,
    ) -> list[QuestionCandidate]:
        """
        When mastery is high (≥ 0.70), skip questions answered within 24 h.
        Low-mastery students benefit from repetition so the filter is not applied.
        """
        avg_mastery = (
            sum(context.subject_mastery.values()) / len(context.subject_mastery)
            if context.subject_mastery else 0.50
        )
        if avg_mastery < _MASTERY_THRESHOLD_FOR_DEDUP:
            return candidates

        recent = frozenset(context.recent_questions)
        result = [c for c in candidates if c.question_id not in recent]
        return result if result else candidates

    # ── Pass 3: topic/article diversity ──────────────────────────────────────

    def apply_diversity_rules(
        self,
        candidates: list[QuestionCandidate],
        context: QuestionSelectionContext,
    ) -> list[QuestionCandidate]:
        """
        Prevent the pool from being dominated by a single article.

        Counts how many times each article_id appears in context.recent_article_ids.
        Candidates whose article has already hit _MAX_SAME_ARTICLE recent occurrences
        are removed — unless the objective explicitly targets that article.

        Only applied when the pool is large enough (≥ _MIN_POOL_FOR_DIVERSITY)
        to avoid over-filtering small question sets.
        """
        if len(candidates) < _MIN_POOL_FOR_DIVERSITY:
            return candidates

        article_counts: dict = {}
        for aid in context.recent_article_ids:
            article_counts[aid] = article_counts.get(aid, 0) + 1

        exempt_article = context.objective_article_id

        def _keep(c: QuestionCandidate) -> bool:
            if not c.article_id:
                return True
            if c.article_id == exempt_article:
                return True
            return article_counts.get(c.article_id, 0) < _MAX_SAME_ARTICLE

        result = [c for c in candidates if _keep(c)]
        return result if result else candidates

    # ── Pass 4: time budget ───────────────────────────────────────────────────

    def exclude_time_overrun(
        self,
        candidates: list[QuestionCandidate],
        context: QuestionSelectionContext,
    ) -> list[QuestionCandidate]:
        """
        Remove candidates whose estimated duration exceeds the remaining session
        time.  A question the student cannot realistically finish is worse than
        any other question, regardless of its scoring signals.

        Fallback: if all candidates would be eliminated (e.g. very short
        remaining time) the filter is skipped so the engine always returns
        *something*.
        """
        if context.remaining_time_secs <= 0:
            return candidates

        result = [
            c for c in candidates
            if c.estimated_time_secs <= context.remaining_time_secs
        ]
        return result if result else candidates
