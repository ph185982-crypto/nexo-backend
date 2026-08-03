from __future__ import annotations
import statistics
from collections import defaultdict

from ..interfaces.observations import AttemptRecord
from ..interfaces.profile import KnowledgeStability


_VOLATILE_THRESHOLD = 0.08   # stddev above this → volatile
_MIN_ATTEMPTS_PER_SUBJECT = 10
_TOP_N = 5


class KnowledgeStabilityAnalyzer:
    """
    How consistent is this user's performance per subject?

    Volatile subjects have high variance in session-by-session accuracy.
    Stable subjects have low variance — the user reliably performs there.

    Method: Compute accuracy per time window (sliding), take stddev.
    High stddev → volatile. Low stddev → stable.
    """

    def analyze(self, attempts: list[AttemptRecord]) -> KnowledgeStability:
        if not attempts:
            return KnowledgeStability(
                stability_score=0.5,
                volatile_subjects=(),
                stable_subjects=(),
            )

        stddevs = self._stddev_by_subject(attempts)
        if not stddevs:
            return KnowledgeStability(
                stability_score=0.5,
                volatile_subjects=(),
                stable_subjects=(),
            )

        overall_stability = self._overall_score(stddevs)
        volatile = self._top_volatile(stddevs)
        stable = self._top_stable(stddevs)

        return KnowledgeStability(
            stability_score=round(overall_stability, 4),
            volatile_subjects=tuple(volatile),
            stable_subjects=tuple(stable),
        )

    # ── Private ───────────────────────────────────────────────────────

    @staticmethod
    def _stddev_by_subject(attempts: list[AttemptRecord]) -> dict[str, float]:
        """
        Split attempts per subject into time buckets (every 20 attempts),
        compute accuracy per bucket, then take stddev across buckets.
        """
        by_subject: dict[str, list[AttemptRecord]] = defaultdict(list)
        for a in attempts:
            if a.subject_id:
                by_subject[str(a.subject_id)].append(a)

        result: dict[str, float] = {}
        for subj_id, subj_attempts in by_subject.items():
            if len(subj_attempts) < _MIN_ATTEMPTS_PER_SUBJECT:
                continue
            sorted_atts = sorted(subj_attempts, key=lambda a: a.answered_at)
            bucket_size = max(len(sorted_atts) // 4, 5)
            buckets = [
                sorted_atts[i : i + bucket_size]
                for i in range(0, len(sorted_atts), bucket_size)
                if len(sorted_atts[i : i + bucket_size]) >= 3
            ]
            if len(buckets) < 2:
                continue
            accs = [sum(1 for a in b if a.is_correct) / len(b) for b in buckets]
            result[subj_id] = statistics.stdev(accs) if len(accs) >= 2 else 0.0

        return result

    @staticmethod
    def _overall_score(stddevs: dict[str, float]) -> float:
        if not stddevs:
            return 0.5
        avg_std = statistics.mean(stddevs.values())
        # stddev > 0.25 = totally erratic → 0.0; stddev = 0 → 1.0
        return max(0.0, 1.0 - avg_std / 0.25)

    @staticmethod
    def _top_volatile(stddevs: dict[str, float]) -> list[str]:
        sorted_items = sorted(stddevs.items(), key=lambda x: x[1], reverse=True)
        return [sid for sid, std in sorted_items[:_TOP_N] if std > _VOLATILE_THRESHOLD]

    @staticmethod
    def _top_stable(stddevs: dict[str, float]) -> list[str]:
        sorted_items = sorted(stddevs.items(), key=lambda x: x[1])
        return [sid for sid, std in sorted_items[:_TOP_N] if std <= _VOLATILE_THRESHOLD]
