from __future__ import annotations
import statistics
from collections import defaultdict

from ..interfaces.observations import BehaviorMetricsRecord, SessionRecord
from ..interfaces.profile import SequencePreference


_DEFAULT_SESSION_LENGTH = 30
_DEFAULT_BEST_HOUR = 8


class PreferredSequenceAnalyzer:
    """
    When and how long should this user study?

    Signals:
    - best_study_hour from user_behavior_metrics (pre-computed)
    - session accuracy grouped by start hour (fresh signal)
    - median session duration of completed sessions
    """

    def analyze(
        self,
        sessions: list[SessionRecord],
        behavior: BehaviorMetricsRecord | None,
    ) -> SequencePreference:
        best_hour = self._best_hour(sessions, behavior)
        best_length = self._best_session_length(sessions, behavior)
        pattern = self._energy_pattern(best_hour, sessions)

        return SequencePreference(
            best_hour=best_hour,
            best_session_length_mins=best_length,
            energy_pattern=pattern,
        )

    # ── Private ───────────────────────────────────────────────────────

    @staticmethod
    def _best_hour(
        sessions: list[SessionRecord],
        behavior: BehaviorMetricsRecord | None,
    ) -> int:
        # Fresh signal: accuracy by hour from session history
        acc_by_hour: dict[int, list[float]] = defaultdict(list)
        for s in sessions:
            if s.is_completed and s.questions_total > 0:
                hour = s.started_at.hour
                acc = s.questions_correct / s.questions_total
                acc_by_hour[hour].append(acc)

        if acc_by_hour:
            best = max(acc_by_hour.items(), key=lambda x: statistics.mean(x[1]))
            return best[0]

        # Fall back to pre-computed
        if behavior and behavior.best_study_hour is not None:
            return behavior.best_study_hour

        return _DEFAULT_BEST_HOUR

    @staticmethod
    def _best_session_length(
        sessions: list[SessionRecord],
        behavior: BehaviorMetricsRecord | None,
    ) -> int:
        durations = [
            s.duration_mins
            for s in sessions
            if s.is_completed and s.duration_mins and s.duration_mins > 5
        ]
        if durations:
            return max(10, int(statistics.median(durations)))
        if behavior:
            return max(10, int(behavior.avg_session_minutes))
        return _DEFAULT_SESSION_LENGTH

    @staticmethod
    def _energy_pattern(best_hour: int, sessions: list[SessionRecord]) -> str:
        if not sessions:
            return "unknown"

        morning = sum(1 for s in sessions if 5 <= s.started_at.hour < 12)
        evening = sum(1 for s in sessions if 17 <= s.started_at.hour < 23)
        total = len(sessions)

        morning_ratio = morning / total
        evening_ratio = evening / total

        if morning_ratio > 0.6:
            return "morning_peak"
        if evening_ratio > 0.6:
            return "evening_peak"
        if abs(morning_ratio - evening_ratio) < 0.15:
            return "consistent"
        return "morning_peak" if best_hour < 12 else "evening_peak"
