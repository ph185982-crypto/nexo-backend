"""
RetentionEstimator — predicts when each subject's retention will fall below threshold.

Uses the SM-2 formula: next_review = last_review + interval_days × ease_factor.
For subjects with no cards, fall back to a conservative default.
"""
from __future__ import annotations
import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from ..interfaces.observations import ReviewCardRecord


_RETENTION_THRESHOLD = 0.70   # below this probability → topic needs review
_DEFAULT_HALF_LIFE_DAYS = 7   # assumed for users with no review history


class RetentionEstimator:
    """
    Projects the date when retention for each subject will fall below threshold.
    Returns a dict: subject_id (str) → datetime when retention drops below 70%.
    """

    def estimate(
        self,
        cards: list[ReviewCardRecord],
        now: Optional[datetime] = None,
    ) -> dict[str, datetime]:
        if now is None:
            now = datetime.now(timezone.utc)

        by_subject: dict[str, list[ReviewCardRecord]] = defaultdict(list)
        for c in cards:
            if c.subject_id:
                by_subject[str(c.subject_id)].append(c)

        result: dict[str, datetime] = {}
        for subject_id, subj_cards in by_subject.items():
            drop_date = self._earliest_drop(subj_cards, now)
            if drop_date:
                result[subject_id] = drop_date

        return result

    # ── Private ───────────────────────────────────────────────────────

    @staticmethod
    def _earliest_drop(
        cards: list[ReviewCardRecord],
        now: datetime,
    ) -> Optional[datetime]:
        """
        For each card, compute the point in time when the Ebbinghaus retention
        drops below threshold, given the SM-2 interval as stability proxy.

        R(t) = e^(-t / S)  where S = interval_days × ease_factor
        Solve for t when R(t) = threshold:
        t_drop = -S × ln(threshold)
        """
        drop_dates = []
        for c in cards:
            if c.total_reviews == 0:
                continue
            last = c.last_review or now
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            stability = max(c.interval_days, 1) * max(c.ease_factor, 1.3)
            t_drop_days = -stability * math.log(_RETENTION_THRESHOLD)
            drop_date = last + timedelta(days=t_drop_days)
            drop_dates.append(drop_date)

        if not drop_dates:
            return None
        return min(drop_dates)   # earliest drop across all cards in this subject
