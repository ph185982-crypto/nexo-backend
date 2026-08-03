"""
StepObserver — processes raw StepResult into a StepRecord.

After each step the caller provides a StepResult. The observer enriches it
with derived metrics (study_speed, fatigue_contribution) and returns the
immutable StepRecord that gets appended to session history.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from ..interfaces.context import StepResult
from ..models.enums import StepType
from ..models.session import StepRecord, StudySession

# Questions per minute benchmarks
_SPEED_BENCHMARKS: dict[StepType, float] = {
    StepType.QUESTIONS:  2.0,   # 2 questions/min = fast
    StepType.REVIEW:     4.0,   # 4 cards/min
    StepType.FLASHCARDS: 5.0,
    StepType.LAW:        0.5,   # 0.5 articles/min = normal
    StepType.SUMMARY:    1.0,
    StepType.AUDIO:      1.0,
    StepType.BREAK:      0.0,
    StepType.ASSESSMENT: 1.5,
}


class StepObserver:
    """Stateless step result processor."""

    def process(
        self,
        result: StepResult,
        started_at: datetime,
        completed_at: Optional[datetime] = None,
        was_adapted: bool = False,
    ) -> StepRecord:
        now = completed_at or datetime.now(timezone.utc)
        duration = result.duration_secs

        study_speed = self._compute_study_speed(result, duration)
        fatigue_contribution = self._estimate_fatigue_contribution(result, duration)

        return StepRecord(
            step_id=uuid4(),
            step_type=result.step_type,
            started_at=started_at,
            completed_at=now,
            duration_secs=duration,
            accuracy=result.accuracy,
            confidence=result.confidence,
            mistakes=result.mistakes,
            reaction_time_secs=result.reaction_time_secs,
            study_speed=study_speed,
            mastery_delta=result.mastery_delta,
            retention_delta=result.retention_delta,
            knowledge_gain=result.knowledge_gain,
            fatigue_contribution=fatigue_contribution,
            was_adapted=was_adapted,
        )

    def _compute_study_speed(self, result: StepResult, duration_secs: float) -> float:
        """
        Normalized study speed 0-1 relative to a benchmark for this step type.
        1.0 = at or above benchmark speed.
        """
        if duration_secs <= 0:
            return 0.0

        benchmark = _SPEED_BENCHMARKS.get(result.step_type, 1.0)
        if benchmark == 0.0:
            return 1.0  # BREAK — always "full speed"

        duration_mins = duration_secs / 60.0
        if duration_mins <= 0:
            return 0.0

        # For question steps, use accuracy-adjusted speed
        if result.step_type == StepType.QUESTIONS and result.accuracy is not None:
            effective_rate = (1.0 / duration_mins) * result.accuracy
        else:
            effective_rate = 1.0 / duration_mins

        return min(effective_rate / benchmark, 1.0)

    def _estimate_fatigue_contribution(self, result: StepResult, duration_secs: float) -> float:
        """
        Estimates how much this step contributed to fatigue (0-1).

        High mistakes + long duration → high contribution.
        Break → negative contribution (recovery).
        """
        if result.step_type == StepType.BREAK:
            return -0.15  # breaks reduce fatigue

        base = min(duration_secs / 3600, 0.30)  # duration component (cap at 30%)

        # Error penalty
        if result.accuracy is not None and result.accuracy < 0.50:
            base += 0.10

        # Confidence penalty
        if result.confidence is not None and result.confidence < 2.0:
            base += 0.05

        return min(base, 0.40)
