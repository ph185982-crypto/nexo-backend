"""
TimeManager — tracks session time and projects completion.

Responsibilities:
  - Compute elapsed active time (excluding pauses)
  - Compute remaining time
  - Estimate completion time for remaining objectives
  - Compute time distribution per step type
  - Warn when time is running short
"""
from __future__ import annotations

from collections import defaultdict

from ..models.enums import StepType
from ..models.session import StudySession

_STEP_DURATIONS: dict[StepType, int] = {
    StepType.LAW:        15,
    StepType.QUESTIONS:  20,
    StepType.REVIEW:     10,
    StepType.FLASHCARDS:  8,
    StepType.SUMMARY:    10,
    StepType.AUDIO:      12,
    StepType.BREAK:       5,
    StepType.ASSESSMENT: 15,
}


class TimeManager:
    """Stateless time calculation component."""

    def is_time_expired(self, session: StudySession) -> bool:
        return session.remaining_mins <= 0

    def is_time_running_short(self, session: StudySession, threshold_mins: float = 10.0) -> bool:
        return 0 < session.remaining_mins <= threshold_mins

    def estimated_completion_mins(
        self,
        session: StudySession,
        remaining_steps: int,
        step_type: StepType = StepType.QUESTIONS,
    ) -> float:
        """Rough estimate: remaining steps × avg step duration."""
        avg_step = _STEP_DURATIONS.get(step_type, 15)
        return remaining_steps * avg_step

    def time_distribution(self, session: StudySession) -> dict[str, float]:
        """Minutes spent per step type across all recorded steps."""
        dist: dict[str, float] = defaultdict(float)
        for record in session.step_history:
            dist[record.step_type.value] += record.duration_secs / 60.0
        return dict(dist)

    def recommended_step_duration(self, session: StudySession, step_type: StepType) -> int:
        """
        Suggests a duration for the next step given remaining time.
        Shrinks step duration when time is short to fit more content.
        """
        default = _STEP_DURATIONS.get(step_type, 15)
        remaining = session.remaining_mins
        if remaining <= 0:
            return 0
        if remaining < 20:
            return min(default, max(5, int(remaining // 2)))
        return default

    def pace_rating(self, session: StudySession) -> str:
        """
        "on_track" | "ahead" | "behind" based on steps completed vs time.

        Rough heuristic: expected ~1 step per 15 minutes.
        """
        expected_steps = session.active_duration_mins / 15
        actual_steps = session.total_steps
        if expected_steps <= 0:
            return "on_track"
        ratio = actual_steps / max(expected_steps, 1)
        if ratio >= 1.2:
            return "ahead"
        if ratio <= 0.8:
            return "behind"
        return "on_track"
