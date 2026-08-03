"""
ConfidenceEstimator — projects confidence at the next study session.

Approach:
- Look at the accuracy trend (last 10 attempts) per subject.
- Fit a simple linear trend.
- Project one step forward.
- Clamp result to [0, 1].
"""
from __future__ import annotations
from collections import defaultdict

from ..interfaces.observations import AttemptRecord


_WINDOW = 10   # attempts to consider
_PROJECTION_WEIGHT = 0.3   # how much weight to give to the trend vs current level


class ConfidenceEstimator:
    """
    Estimates confidence (accuracy) at the next session per subject.
    Returns dict: subject_id (str) → estimated_confidence (0-1).
    """

    def estimate(self, attempts: list[AttemptRecord]) -> dict[str, float]:
        by_subject: dict[str, list[AttemptRecord]] = defaultdict(list)
        for a in attempts:
            if a.subject_id:
                by_subject[str(a.subject_id)].append(a)

        result: dict[str, float] = {}
        for subject_id, subj_attempts in by_subject.items():
            confidence = self._project(subj_attempts)
            result[subject_id] = round(confidence, 4)

        return result

    # ── Private ───────────────────────────────────────────────────────

    @staticmethod
    def _project(attempts: list[AttemptRecord]) -> float:
        sorted_atts = sorted(attempts, key=lambda a: a.answered_at)
        if len(sorted_atts) < 3:
            # Not enough data — return raw accuracy
            return sum(1 for a in sorted_atts if a.is_correct) / max(len(sorted_atts), 1)

        window = sorted_atts[-_WINDOW:]
        n = len(window)

        # Compute accuracy in first half vs second half as trend proxy
        mid = n // 2
        first_half_acc = sum(1 for a in window[:mid] if a.is_correct) / max(mid, 1)
        second_half_acc = sum(1 for a in window[mid:] if a.is_correct) / max(n - mid, 1)

        trend = second_half_acc - first_half_acc   # direction of change
        current = second_half_acc

        # Project one half-window step forward
        projected = current + trend * _PROJECTION_WEIGHT
        return max(0.0, min(projected, 1.0))
