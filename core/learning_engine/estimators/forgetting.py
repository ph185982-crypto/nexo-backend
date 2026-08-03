"""
ForgettingEstimator — computes forgetting velocity per subject.

Uses Ebbinghaus decay: R(t) = e^(-t / S) where S is memory stability.
Stability is derived from SM-2 ease_factor and interval_days.

Forgetting velocity = 1 / S (per day).
Higher velocity → content forgotten faster → needs more frequent review.
"""
from __future__ import annotations
import math
from collections import defaultdict

from ..interfaces.observations import ReviewCardRecord


_MIN_STABILITY = 0.5   # floor to avoid division by zero


class ForgettingEstimator:
    """
    Computes forgetting velocity per subject (0-1 per day).
    Higher velocity = faster forgetting = higher review urgency.
    Returns dict: subject_id (str) → forgetting_velocity (0-1).
    """

    def estimate(self, cards: list[ReviewCardRecord]) -> dict[str, float]:
        by_subject: dict[str, list[ReviewCardRecord]] = defaultdict(list)
        for c in cards:
            if c.subject_id:
                by_subject[str(c.subject_id)].append(c)

        result: dict[str, float] = {}
        for subject_id, subj_cards in by_subject.items():
            velocity = self._subject_velocity(subj_cards)
            result[subject_id] = round(velocity, 6)

        return result

    # ── Private ───────────────────────────────────────────────────────

    @staticmethod
    def _subject_velocity(cards: list[ReviewCardRecord]) -> float:
        """
        Mean forgetting velocity across all cards for this subject.
        velocity = 1 / stability  where stability = interval × ease_factor.
        Normalised so that stability=1 day → velocity≈1.0, stability=30 days → velocity≈0.033.
        """
        velocities = []
        for c in cards:
            if c.total_reviews == 0:
                continue
            stability = max(c.interval_days * c.ease_factor, _MIN_STABILITY)
            velocity = 1.0 / stability
            velocities.append(velocity)

        if not velocities:
            # No review history → assume default high forgetting
            return 1.0 / 3.0   # forgetting within 3 days

        raw_velocity = sum(velocities) / len(velocities)
        # Normalise to [0, 1]: cap at 1.0/day
        return min(raw_velocity, 1.0)
