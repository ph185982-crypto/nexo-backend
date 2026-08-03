"""
AdaptationEngine — evaluates adaptation rules and emits decisions.

Called after every step. Returns the highest-priority fired rule (or None).
Safety rules (fatigue, session_too_long) bypass the cooldown period.
"""
from __future__ import annotations

from typing import Optional

from ..interfaces.context import FatigueEstimate
from ..models.enums import FatigueLevel
from ..models.session import StudySession
from .rules import (
    AdaptationDecision,
    ALL_RULES,
    check_fatigue,
    check_session_too_long,
    check_consecutive_mistakes,
)

_ADAPTATION_COOLDOWN = 2   # min steps between non-safety adaptations


class AdaptationEngine:
    """
    Evaluates all adaptation rules in priority order.

    Safety rules (priority ≤ 2) always fire regardless of cooldown.
    Standard rules respect a cooldown of _ADAPTATION_COOLDOWN steps.
    """

    def evaluate(
        self,
        session: StudySession,
        fatigue: FatigueEstimate,
    ) -> Optional[AdaptationDecision]:
        # Safety rules first (bypass cooldown)
        safety = self._check_safety(session, fatigue)
        if safety:
            return safety

        # Standard rules (respect cooldown)
        if session.steps_since_adaptation < _ADAPTATION_COOLDOWN:
            return None

        return self._check_standard(session)

    # ── Private ──────────────────────────────────────────────────────────────

    def _check_safety(
        self,
        session: StudySession,
        fatigue: FatigueEstimate,
    ) -> Optional[AdaptationDecision]:
        # Consecutive mistakes (priority 1 — bypasses cooldown)
        decision = check_consecutive_mistakes(session)
        if decision:
            return decision

        # Session too long (priority 1)
        decision = check_session_too_long(session)
        if decision:
            return decision

        # Fatigue (priority 2 — requires fatigue estimate)
        decision = check_fatigue(session, fatigue)
        if decision:
            return decision

        return None

    def _check_standard(self, session: StudySession) -> Optional[AdaptationDecision]:
        """Evaluate all standard rules; return the one with lowest priority number."""
        candidates: list[AdaptationDecision] = []

        for rule_fn in ALL_RULES:
            try:
                result = rule_fn(session)
                if result:
                    candidates.append(result)
            except Exception:
                pass  # never let a rule crash the session

        if not candidates:
            return None

        # Return the highest-urgency decision (lowest priority number)
        return min(candidates, key=lambda d: d.priority)
