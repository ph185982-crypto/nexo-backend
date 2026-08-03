from __future__ import annotations
import statistics
from typing import Optional

from ..interfaces.observations import AttemptRecord, SessionRecord
from ..interfaces.profile import LearningSpeed


_FAST_THRESHOLD_SECS = 30
_SLOW_THRESHOLD_SECS = 60
_VELOCITY_WINDOW = 0.25   # compare first vs last 25% of attempts


class LearningSpeedAnalyzer:
    """
    How fast does this user process and acquire knowledge?

    Signals:
    - avg_time_per_question_secs: mean response time from question_attempts
    - questions_per_session: throughput from study_sessions
    - learning_velocity: accuracy trend over time (early vs late attempts)
    """

    def analyze(
        self,
        attempts: list[AttemptRecord],
        sessions: list[SessionRecord],
    ) -> LearningSpeed:
        avg_time = self._avg_response_time(attempts)
        q_per_session = self._questions_per_session(sessions)
        velocity = self._learning_velocity(attempts)
        category = self._categorize(avg_time)

        return LearningSpeed(
            avg_time_per_question_secs=avg_time,
            questions_per_session=q_per_session,
            learning_velocity=velocity,
            category=category,
        )

    # ── Private ───────────────────────────────────────────────────────

    @staticmethod
    def _avg_response_time(attempts: list[AttemptRecord]) -> float:
        times = [a.time_spent_secs for a in attempts if a.time_spent_secs and a.time_spent_secs > 0]
        if not times:
            return 45.0   # neutral default
        return statistics.mean(times)

    @staticmethod
    def _questions_per_session(sessions: list[SessionRecord]) -> float:
        totals = [s.questions_total for s in sessions if s.is_completed and s.questions_total > 0]
        if not totals:
            return 10.0   # neutral default
        return statistics.mean(totals)

    @staticmethod
    def _learning_velocity(attempts: list[AttemptRecord]) -> float:
        """
        Compare accuracy in the earliest window vs latest window.
        Positive delta → learner is improving → higher velocity.
        """
        if len(attempts) < 10:
            return 0.5   # not enough history

        sorted_attempts = sorted(attempts, key=lambda a: a.answered_at)
        n = len(sorted_attempts)
        window = max(int(n * _VELOCITY_WINDOW), 5)

        early = sorted_attempts[:window]
        late = sorted_attempts[-window:]

        early_acc = sum(1 for a in early if a.is_correct) / len(early)
        late_acc = sum(1 for a in late if a.is_correct) / len(late)

        # Normalise: delta of -1→+1 maps to 0→1
        delta = late_acc - early_acc
        return max(0.0, min((delta + 1.0) / 2.0, 1.0))

    @staticmethod
    def _categorize(avg_secs: float) -> str:
        if avg_secs < _FAST_THRESHOLD_SECS:
            return "fast"
        if avg_secs > _SLOW_THRESHOLD_SECS:
            return "slow"
        return "medium"
