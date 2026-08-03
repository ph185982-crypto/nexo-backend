from __future__ import annotations
import statistics
from collections import defaultdict

from ..interfaces.observations import AttemptRecord, BehaviorMetricsRecord, SessionRecord
from ..interfaces.profile import FatigueThreshold


_DEFAULT_THRESHOLD_MINS = 45
_MIN_ATTEMPTS_FOR_ANALYSIS = 6
_WINDOW_FRACTION = 0.33   # first vs last third of session


class FatigueAnalyzer:
    """
    At what session length does this user's accuracy start to degrade?

    Method: for each session, split attempts into early (first third) and
    late (last third). Compare accuracy across both windows across all sessions.
    The threshold is the session length where late accuracy drops below early.
    """

    def analyze(
        self,
        attempts: list[AttemptRecord],
        sessions: list[SessionRecord],
        behavior: BehaviorMetricsRecord | None,
    ) -> FatigueThreshold:
        # Prefer pre-computed threshold from behavior_metrics if fresh
        if behavior and behavior.fatigue_threshold_mins > 0:
            threshold = behavior.fatigue_threshold_mins
        else:
            threshold = _DEFAULT_THRESHOLD_MINS

        acc_start, acc_end = self._compute_accuracy_windows(attempts, sessions)
        drop_rate = self._compute_drop_rate(acc_start, acc_end, threshold)

        # Refine threshold from session data if available
        estimated_threshold = self._estimate_threshold(sessions, threshold)

        return FatigueThreshold(
            threshold_minutes=estimated_threshold,
            accuracy_at_start=round(acc_start, 4),
            accuracy_at_end=round(acc_end, 4),
            drop_rate=round(drop_rate, 4),
        )

    # ── Private ───────────────────────────────────────────────────────

    @staticmethod
    def _compute_accuracy_windows(
        attempts: list[AttemptRecord],
        sessions: list[SessionRecord],
    ) -> tuple[float, float]:
        """Return (early_accuracy, late_accuracy) across all sessions."""
        session_map: dict = {s.id: s for s in sessions}
        by_session: dict = defaultdict(list)

        for a in attempts:
            if a.session_id and a.session_id in session_map:
                by_session[a.session_id].append(a)

        early_correct = []
        late_correct = []

        for session_id, sess_attempts in by_session.items():
            sess = session_map[session_id]
            if len(sess_attempts) < _MIN_ATTEMPTS_FOR_ANALYSIS:
                continue
            sorted_atts = sorted(sess_attempts, key=lambda a: a.answered_at)
            n = len(sorted_atts)
            window = max(int(n * _WINDOW_FRACTION), 2)
            early = sorted_atts[:window]
            late = sorted_atts[-window:]
            early_correct.extend(1 if a.is_correct else 0 for a in early)
            late_correct.extend(1 if a.is_correct else 0 for a in late)

        acc_start = statistics.mean(early_correct) if early_correct else 0.6
        acc_end = statistics.mean(late_correct) if late_correct else 0.55
        return acc_start, acc_end

    @staticmethod
    def _compute_drop_rate(acc_start: float, acc_end: float, threshold_mins: int) -> float:
        """Accuracy loss per 30-minute block after threshold."""
        delta = acc_start - acc_end
        if threshold_mins <= 0:
            return 0.0
        return max(0.0, delta / (threshold_mins / 30.0))

    @staticmethod
    def _estimate_threshold(sessions: list[SessionRecord], fallback: int) -> int:
        """
        Find the median session duration of completed sessions.
        If the tail accuracy analysis showed a drop, threshold is that median.
        """
        durations = [
            s.duration_mins
            for s in sessions
            if s.is_completed and s.duration_mins and s.duration_mins > 5
        ]
        if not durations:
            return fallback
        median_dur = int(statistics.median(durations))
        # Cap between 15 and 120 minutes
        return max(15, min(median_dur, 120))
