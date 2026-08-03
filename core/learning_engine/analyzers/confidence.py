from __future__ import annotations
import statistics
from collections import defaultdict
from typing import Optional

from ..interfaces.observations import AttemptRecord, MasteryRecord
from ..interfaces.profile import ConfidenceIndex


class ConfidenceAnalyzer:
    """
    Measures confidence per subject from objective accuracy.

    Two signals:
    1. Mastery record accuracy (primary — most stable)
    2. Attempt-level accuracy per subject (recent signal)
    3. If self-rated confidence was recorded (confidence field 1-5),
       compute calibration: alignment between self-rating and actual accuracy.
    """

    def analyze(
        self,
        attempts: list[AttemptRecord],
        mastery: list[MasteryRecord],
    ) -> ConfidenceIndex:
        by_subject = self._confidence_by_subject(attempts, mastery)
        overall = statistics.mean(by_subject.values()) if by_subject else 0.5
        calibration = self._calibration_score(attempts)

        return ConfidenceIndex(
            overall=round(overall, 4),
            by_subject={k: round(v, 4) for k, v in by_subject.items()},
            calibration_score=round(calibration, 4),
        )

    # ── Private ───────────────────────────────────────────────────────

    @staticmethod
    def _confidence_by_subject(
        attempts: list[AttemptRecord],
        mastery: list[MasteryRecord],
    ) -> dict[str, float]:
        result: dict[str, float] = {}

        # Start from mastery records (more stable, broader history)
        for m in mastery:
            if m.topic_id is None:  # subject-level only
                result[str(m.subject_id)] = m.accuracy

        # Blend with recent attempt accuracy (last 50 per subject, weighted 30%)
        recent_by_subject: dict[str, list[bool]] = defaultdict(list)
        sorted_attempts = sorted(attempts, key=lambda a: a.answered_at, reverse=True)
        counts: dict[str, int] = defaultdict(int)

        for a in sorted_attempts:
            if a.subject_id is None:
                continue
            key = str(a.subject_id)
            if counts[key] < 50:
                recent_by_subject[key].append(a.is_correct)
                counts[key] += 1

        for subject_id, correct_list in recent_by_subject.items():
            recent_acc = sum(correct_list) / len(correct_list)
            if subject_id in result:
                # Blend: 70% historical mastery, 30% recent
                result[subject_id] = round(result[subject_id] * 0.7 + recent_acc * 0.3, 4)
            else:
                result[subject_id] = round(recent_acc, 4)

        return result

    @staticmethod
    def _calibration_score(attempts: list[AttemptRecord]) -> float:
        """
        How well does the user's self-rated confidence predict actual correctness?
        Requires `confidence` field (1-5 scale) on attempts.
        Returns 0.5 if no self-ratings available.
        """
        rated = [a for a in attempts if a.confidence is not None]
        if len(rated) < 5:
            return 0.5   # insufficient data

        # Normalise confidence 1-5 → 0-1
        predictions = [(a.confidence - 1) / 4.0 for a in rated]
        actuals = [1.0 if a.is_correct else 0.0 for a in rated]

        # Mean absolute error → calibration (1 - MAE)
        mae = statistics.mean(abs(p - a) for p, a in zip(predictions, actuals))
        return max(0.0, 1.0 - mae)
