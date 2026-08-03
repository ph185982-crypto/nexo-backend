"""
MasteryEstimator — projects how many days until a subject reaches target mastery.

Method:
- From mastery records, compute current mastery and accuracy.
- From attempt history, compute learning velocity (mastery gain per attempt).
- Extrapolate: days_to_target = (target - current) / daily_gain.
- Returns None if no progress is observed (stuck or unknown).
"""
from __future__ import annotations
from collections import defaultdict
from typing import Optional

from ..interfaces.observations import AttemptRecord, MasteryRecord


_TARGET_MASTERY = 0.70   # 70% mastery = passing threshold
_ATTEMPTS_PER_DAY_DEFAULT = 15
_MAX_DAYS_PROJECTION = 365


class MasteryEstimator:
    """
    Estimates days to reach target mastery per subject.
    Returns dict: subject_id (str) → days_to_target (None if unreachable/unknown).
    """

    def estimate(
        self,
        mastery: list[MasteryRecord],
        attempts: list[AttemptRecord],
        daily_attempts: float = _ATTEMPTS_PER_DAY_DEFAULT,
    ) -> dict[str, Optional[int]]:
        # Build velocity per subject from attempt history
        velocity_by_subject = self._velocity_per_subject(attempts)

        result: dict[str, Optional[int]] = {}
        for m in mastery:
            if m.topic_id is not None:
                continue   # subject-level only
            subject_id = str(m.subject_id)
            days = self._project_days(m, velocity_by_subject.get(subject_id, 0.0), daily_attempts)
            result[subject_id] = days

        return result

    # ── Private ───────────────────────────────────────────────────────

    @staticmethod
    def _velocity_per_subject(attempts: list[AttemptRecord]) -> dict[str, float]:
        """
        Mastery gain rate per attempt.
        Proxy: improvement in accuracy per attempt window.
        Returns mastery_gain_per_attempt ≈ 0.002 - 0.01 (empirical range).
        """
        by_subject: dict[str, list[AttemptRecord]] = defaultdict(list)
        for a in attempts:
            if a.subject_id:
                by_subject[str(a.subject_id)].append(a)

        result: dict[str, float] = {}
        for subject_id, atts in by_subject.items():
            if len(atts) < 5:
                continue
            sorted_atts = sorted(atts, key=lambda a: a.answered_at)
            n = len(sorted_atts)
            mid = n // 2
            early_acc = sum(1 for a in sorted_atts[:mid] if a.is_correct) / max(mid, 1)
            late_acc = sum(1 for a in sorted_atts[mid:] if a.is_correct) / max(n - mid, 1)
            # Mastery gain = improvement in accuracy across all attempts
            gain = (late_acc - early_acc) / max(n, 1)
            result[subject_id] = max(0.0, gain)

        return result

    @staticmethod
    def _project_days(
        mastery: MasteryRecord,
        velocity_per_attempt: float,
        daily_attempts: float,
    ) -> Optional[int]:
        current = mastery.mastery_level   # already 0-1

        if current >= _TARGET_MASTERY:
            return 0   # already there

        gap = _TARGET_MASTERY - current

        if velocity_per_attempt <= 0:
            # No observable progress — can't project
            return None

        # Daily mastery gain = velocity × attempts per day
        daily_gain = velocity_per_attempt * daily_attempts
        if daily_gain <= 0:
            return None

        days = gap / daily_gain
        if days > _MAX_DAYS_PROJECTION:
            return None   # too far to be useful

        return max(1, round(days))
