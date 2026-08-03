"""
FatigueMonitor — estimates user fatigue from session history.

Three signal sources, weighted combination:

  Duration factor     (0.40) — session active time vs fatigue threshold
  Accuracy drop       (0.40) — recent vs historical accuracy delta
  Reaction time rise  (0.20) — recent vs historical reaction time delta

Thresholds:
  ≥ 0.80 → EXHAUSTED
  ≥ 0.60 → HIGH
  ≥ 0.40 → MODERATE
  ≥ 0.20 → MILD
  <  0.20 → FRESH
"""
from __future__ import annotations

from ..interfaces.context import FatigueEstimate
from ..models.enums import FatigueLevel, StepType
from ..models.session import StudySession

_FATIGUE_THRESHOLD_MINS = 60.0   # baseline; overridden by learning context if provided
_MANDATORY_BREAK_MINS  = 90.0    # always force a break beyond this

_WEIGHTS = {
    "duration":      0.40,
    "accuracy_drop": 0.40,
    "reaction_rise": 0.20,
}

_LEVEL_MAP = [
    (0.80, FatigueLevel.EXHAUSTED),
    (0.60, FatigueLevel.HIGH),
    (0.40, FatigueLevel.MODERATE),
    (0.20, FatigueLevel.MILD),
    (0.00, FatigueLevel.FRESH),
]


class FatigueMonitor:
    """Stateless fatigue estimator — call estimate() after each step."""

    def estimate(
        self,
        session: StudySession,
        fatigue_threshold_mins: float = _FATIGUE_THRESHOLD_MINS,
    ) -> FatigueEstimate:
        duration_score = self._duration_score(session, fatigue_threshold_mins)
        accuracy_drop  = self._accuracy_drop(session)
        reaction_rise  = self._reaction_rise(session)

        composite = (
            _WEIGHTS["duration"]      * duration_score +
            _WEIGHTS["accuracy_drop"] * accuracy_drop  +
            _WEIGHTS["reaction_rise"] * reaction_rise
        )
        composite = min(max(composite, 0.0), 1.0)

        level = FatigueLevel.FRESH
        for threshold, lvl in _LEVEL_MAP:
            if composite >= threshold:
                level = lvl
                break

        session_quality    = 1.0 - composite
        learning_efficiency = max(0.10, 1.0 - composite * 0.70)

        return FatigueEstimate(
            level=level,
            score=round(composite, 4),
            attention_drop=round(accuracy_drop, 4),
            performance_drop=round(accuracy_drop, 4),
            session_quality=round(session_quality, 4),
            learning_efficiency=round(learning_efficiency, 4),
        )

    def should_force_break(
        self,
        session: StudySession,
        mandatory_threshold_mins: float = _MANDATORY_BREAK_MINS,
    ) -> bool:
        """True when the session has exceeded the mandatory break threshold."""
        if session.active_duration_mins >= mandatory_threshold_mins:
            # Allow if already in a BREAK step
            if session.step_history:
                last = session.step_history[-1]
                if last.step_type == StepType.BREAK:
                    return False
            return True
        return False

    # ── Signal scorers ───────────────────────────────────────────────────────

    def _duration_score(
        self,
        session: StudySession,
        threshold: float,
    ) -> float:
        """Linear ramp: 0 at start → 1 at threshold, stays 1 beyond."""
        return min(session.active_duration_mins / max(threshold, 1.0), 1.0)

    def _accuracy_drop(self, session: StudySession) -> float:
        """
        Compares accuracy of the first half vs the second half of question steps.
        Returns 0 when no history, positive when recent accuracy is worse.
        """
        q_steps = [r for r in session.step_history if r.accuracy is not None]
        if len(q_steps) < 4:
            return 0.0

        mid = len(q_steps) // 2
        early_acc = sum(r.accuracy for r in q_steps[:mid]) / mid
        late_acc  = sum(r.accuracy for r in q_steps[mid:]) / (len(q_steps) - mid)

        drop = early_acc - late_acc
        return min(max(drop, 0.0), 1.0)

    def _reaction_rise(self, session: StudySession) -> float:
        """
        Compares reaction time of the first half vs second half.
        Returns 0 when no history, positive when reaction times are getting longer.
        """
        rt_steps = [
            r for r in session.step_history
            if r.reaction_time_secs is not None
        ]
        if len(rt_steps) < 4:
            return 0.0

        mid = len(rt_steps) // 2
        early_rt = sum(r.reaction_time_secs for r in rt_steps[:mid]) / mid
        late_rt  = sum(r.reaction_time_secs for r in rt_steps[mid:]) / (len(rt_steps) - mid)

        if early_rt <= 0:
            return 0.0

        rise_ratio = (late_rt - early_rt) / early_rt
        return min(max(rise_ratio, 0.0), 1.0)
