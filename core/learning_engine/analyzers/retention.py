from __future__ import annotations
import statistics

from ..interfaces.observations import ReviewCardRecord
from ..interfaces.profile import RetentionStrength


_EF_MIN = 1.3
_EF_MAX = 3.5
_STRONG_THRESHOLD = 0.65
_WEAK_THRESHOLD = 0.40


class RetentionAnalyzer:
    """
    How well does this user retain what they learned?

    Signals from SM-2 review_cards:
    - ease_factor (EF): high EF → retains better, needs fewer reviews
    - interval_days: longer intervals → stronger retention
    - total_correct / total_reviews: review accuracy
    - lapsed: card reverted to learning phase (memory failure)
    """

    def analyze(self, cards: list[ReviewCardRecord]) -> RetentionStrength:
        avg_ef = self._avg_ease_factor(cards)
        avg_interval = self._avg_interval_days(cards)
        retention_rate = self._review_retention_rate(cards)
        stability = self._stability_score(avg_ef, retention_rate, cards)
        category = self._categorize(stability)

        return RetentionStrength(
            avg_ease_factor=avg_ef,
            avg_interval_days=avg_interval,
            review_retention_rate=retention_rate,
            stability_score=stability,
            category=category,
        )

    # ── Private ───────────────────────────────────────────────────────

    @staticmethod
    def _avg_ease_factor(cards: list[ReviewCardRecord]) -> float:
        efs = [c.ease_factor for c in cards if c.ease_factor > 0]
        return statistics.mean(efs) if efs else 2.5

    @staticmethod
    def _avg_interval_days(cards: list[ReviewCardRecord]) -> float:
        intervals = [c.interval_days for c in cards if not c.lapsed and c.interval_days > 0]
        return statistics.mean(intervals) if intervals else 1.0

    @staticmethod
    def _review_retention_rate(cards: list[ReviewCardRecord]) -> float:
        total_reviews = sum(c.total_reviews for c in cards)
        total_correct = sum(c.total_correct for c in cards)
        if total_reviews == 0:
            return 0.5   # neutral default for new users
        return min(total_correct / total_reviews, 1.0)

    @staticmethod
    def _stability_score(
        avg_ef: float,
        retention_rate: float,
        cards: list[ReviewCardRecord],
    ) -> float:
        # Normalise EF from [1.3, 3.5] → [0, 1]
        ef_score = max(0.0, min((avg_ef - _EF_MIN) / (_EF_MAX - _EF_MIN), 1.0))

        # Lapse penalty: fraction of cards that lapsed
        lapse_rate = sum(1 for c in cards if c.lapsed) / max(len(cards), 1)
        lapse_penalty = lapse_rate * 0.3

        return max(0.0, round(ef_score * 0.4 + retention_rate * 0.6 - lapse_penalty, 4))

    @staticmethod
    def _categorize(stability: float) -> str:
        if stability >= _STRONG_THRESHOLD:
            return "strong"
        if stability <= _WEAK_THRESHOLD:
            return "weak"
        return "medium"
