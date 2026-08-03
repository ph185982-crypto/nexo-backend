from __future__ import annotations
import statistics

from ..interfaces.observations import ReviewCardRecord
from ..interfaces.profile import ReviewEfficiency


_EFFICIENT_THRESHOLD = 0.65


class ReviewEfficiencyAnalyzer:
    """
    How efficiently does SM-2 repetition translate to mastery for this user?

    Signals:
    - reviews_per_mastery_point: total reviews / total correct (lower = better)
    - lapse_rate: fraction of cards that lapsed back to learning
    - streak_avg: mean consecutive correct streak
    """

    def analyze(self, cards: list[ReviewCardRecord]) -> ReviewEfficiency:
        if not cards:
            return ReviewEfficiency(
                reviews_per_mastery_point=4.0,
                lapse_rate=0.3,
                streak_avg=1.0,
                efficiency_score=0.5,
            )

        reviews_per_point = self._reviews_per_mastery_point(cards)
        lapse_rate = self._lapse_rate(cards)
        streak_avg = self._streak_avg(cards)
        efficiency = self._efficiency_score(reviews_per_point, lapse_rate, streak_avg)

        return ReviewEfficiency(
            reviews_per_mastery_point=round(reviews_per_point, 2),
            lapse_rate=round(lapse_rate, 4),
            streak_avg=round(streak_avg, 2),
            efficiency_score=round(efficiency, 4),
        )

    # ── Private ───────────────────────────────────────────────────────

    @staticmethod
    def _reviews_per_mastery_point(cards: list[ReviewCardRecord]) -> float:
        total_reviews = sum(c.total_reviews for c in cards)
        total_correct = sum(c.total_correct for c in cards)
        if total_correct == 0:
            return 10.0   # worst case: no correct answers yet
        return total_reviews / total_correct

    @staticmethod
    def _lapse_rate(cards: list[ReviewCardRecord]) -> float:
        if not cards:
            return 0.0
        return sum(1 for c in cards if c.lapsed) / len(cards)

    @staticmethod
    def _streak_avg(cards: list[ReviewCardRecord]) -> float:
        streaks = [c.streak for c in cards]
        return statistics.mean(streaks) if streaks else 0.0

    @staticmethod
    def _efficiency_score(
        reviews_per_point: float,
        lapse_rate: float,
        streak_avg: float,
    ) -> float:
        # Normalise reviews_per_point: 1.0 → perfect (1 review per correct), 10+ → terrible
        review_score = max(0.0, 1.0 - (reviews_per_point - 1.0) / 9.0)

        # Lapse penalty: 0 lapses → 1.0, all cards lapsed → 0.0
        lapse_score = 1.0 - lapse_rate

        # Streak bonus: normalised to [0, 1] assuming max useful streak = 10
        streak_score = min(streak_avg / 10.0, 1.0)

        return max(0.0, review_score * 0.5 + lapse_score * 0.35 + streak_score * 0.15)
