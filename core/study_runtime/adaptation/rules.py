"""
Adaptation rules — pure functions that inspect session history and return
AdaptationDecision when a rule fires, or None if it does not.

Rules are evaluated in priority order (lower priority number = higher urgency).
Only the first fired rule is acted on per step (with cooldown enforcement).

Rule priorities:
  1 — CONSECUTIVE_MISTAKES / SESSION_TOO_LONG (safety)
  2 — FATIGUE_DETECTED (safety)
  3 — CONCEPT_CONFUSION / LOW_RETENTION
  4 — LOW_CONFIDENCE
  5 — HIGH_PERFORMANCE / FAST_ANSWERING (optimization)
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from ..interfaces.context import FatigueEstimate
from ..models.enums import (
    AdaptationAction, AdaptationTrigger, FatigueLevel, StepType,
)
from ..models.session import StepRecord, StudySession


@dataclass(frozen=True)
class AdaptationDecision:
    trigger: AdaptationTrigger
    action: AdaptationAction
    reason: str
    to_step_type: Optional[StepType]
    priority: int
    difficulty_delta: float = 0.0   # how much to adjust difficulty (+/- 0-1)


# ── Safety rules (priority 1-2) ──────────────────────────────────────────────

def check_consecutive_mistakes(session: StudySession) -> Optional[AdaptationDecision]:
    """3+ consecutive question steps with accuracy < 50% → switch to law review."""
    if session.consecutive_mistakes < 3:
        return None
    return AdaptationDecision(
        trigger=AdaptationTrigger.CONSECUTIVE_MISTAKES,
        action=AdaptationAction.SWITCH_TO_LAW,
        reason=f"3 consecutive poor-accuracy steps — reinforcing law basis before continuing.",
        to_step_type=StepType.LAW,
        priority=1,
    )


def check_session_too_long(session: StudySession) -> Optional[AdaptationDecision]:
    """Session active > 90 min without a break → mandatory break."""
    if session.active_duration_mins < 90:
        return None
    # Only fire if the last step was not already a BREAK
    if session.step_history and session.step_history[-1].step_type == StepType.BREAK:
        return None
    # Check steps_since_break
    if session.steps_since_break == 0:
        return None
    return AdaptationDecision(
        trigger=AdaptationTrigger.SESSION_TOO_LONG,
        action=AdaptationAction.INSERT_BREAK,
        reason="Session exceeded 90 minutes — mandatory rest to prevent cognitive overload.",
        to_step_type=StepType.BREAK,
        priority=1,
    )


def check_fatigue(
    session: StudySession,
    fatigue: FatigueEstimate,
) -> Optional[AdaptationDecision]:
    """Fatigue HIGH or EXHAUSTED → insert break."""
    if fatigue.level not in (FatigueLevel.HIGH, FatigueLevel.EXHAUSTED):
        return None
    if session.step_history and session.step_history[-1].step_type == StepType.BREAK:
        return None
    return AdaptationDecision(
        trigger=AdaptationTrigger.FATIGUE_DETECTED,
        action=AdaptationAction.INSERT_BREAK,
        reason=f"Fatigue level {fatigue.level} detected — inserting recovery break.",
        to_step_type=StepType.BREAK,
        priority=2,
    )


# ── Conceptual rules (priority 3) ────────────────────────────────────────────

def check_concept_confusion(session: StudySession) -> Optional[AdaptationDecision]:
    """Same topic repeated error 2+ times in last 10 steps → law study."""
    q_steps = [
        r for r in session.step_history[-10:]
        if r.accuracy is not None and r.accuracy < 0.50 and r.mistakes > 0
    ]
    if len(q_steps) >= 2:
        return AdaptationDecision(
            trigger=AdaptationTrigger.CONCEPT_CONFUSION,
            action=AdaptationAction.REQUEST_ERROR_TREATMENT,
            reason="Repeated errors suggest conceptual gap — switching to foundational law review.",
            to_step_type=StepType.LAW,
            priority=3,
        )
    return None


def check_low_retention(session: StudySession) -> Optional[AdaptationDecision]:
    """Net mastery_delta across last 5 steps is negative → review."""
    recent = session.step_history[-5:]
    if len(recent) < 3:
        return None
    net_mastery = sum(r.mastery_delta for r in recent)
    if net_mastery < -0.05:
        return AdaptationDecision(
            trigger=AdaptationTrigger.LOW_RETENTION,
            action=AdaptationAction.SWITCH_TO_REVIEW,
            reason="Net mastery loss detected — reviewing previously studied content.",
            to_step_type=StepType.REVIEW,
            priority=3,
        )
    return None


# ── Confidence rule (priority 4) ─────────────────────────────────────────────

def check_low_confidence(session: StudySession) -> Optional[AdaptationDecision]:
    """Avg confidence < 2.5 for last 3 question steps → insert review."""
    conf_steps = [
        r for r in session.step_history[-6:]
        if r.confidence is not None
    ]
    if len(conf_steps) < 3:
        return None
    avg_conf = sum(r.confidence for r in conf_steps[-3:]) / 3
    if avg_conf < 2.5:
        return AdaptationDecision(
            trigger=AdaptationTrigger.LOW_CONFIDENCE,
            action=AdaptationAction.SWITCH_TO_REVIEW,
            reason=f"Average confidence {avg_conf:.1f}/5 — reviewing to rebuild certainty.",
            to_step_type=StepType.REVIEW,
            priority=4,
        )
    return None


# ── Optimization rules (priority 5) ──────────────────────────────────────────

def check_high_performance(session: StudySession) -> Optional[AdaptationDecision]:
    """Avg accuracy > 85% and avg confidence > 3.5 for last 5 steps → increase difficulty."""
    q_steps = [
        r for r in session.step_history[-5:]
        if r.accuracy is not None
    ]
    if len(q_steps) < 5:
        return None
    avg_acc  = sum(r.accuracy for r in q_steps) / len(q_steps)
    conf_steps = [r for r in q_steps if r.confidence is not None]
    avg_conf = sum(r.confidence for r in conf_steps) / len(conf_steps) if conf_steps else 0
    if avg_acc > 0.85 and avg_conf > 3.5:
        return AdaptationDecision(
            trigger=AdaptationTrigger.HIGH_PERFORMANCE,
            action=AdaptationAction.INCREASE_DIFFICULTY,
            reason=f"High accuracy ({avg_acc:.0%}) + confidence — increasing challenge level.",
            to_step_type=None,
            priority=5,
            difficulty_delta=+0.15,
        )
    return None


def check_fast_answering(session: StudySession) -> Optional[AdaptationDecision]:
    """Avg reaction time < 8s for last 5 question steps → increase difficulty."""
    rt_steps = [
        r for r in session.step_history[-5:]
        if r.reaction_time_secs is not None and r.step_type == StepType.QUESTIONS
    ]
    if len(rt_steps) < 5:
        return None
    avg_rt = sum(r.reaction_time_secs for r in rt_steps) / len(rt_steps)
    if avg_rt < 8.0:
        return AdaptationDecision(
            trigger=AdaptationTrigger.FAST_ANSWERING,
            action=AdaptationAction.INCREASE_DIFFICULTY,
            reason=f"Very fast responses ({avg_rt:.1f}s avg) — escalating to harder questions.",
            to_step_type=None,
            priority=5,
            difficulty_delta=+0.10,
        )
    return None


# ── Rule registry ─────────────────────────────────────────────────────────────

# Safety rules bypass cooldown
_SAFETY_RULES = [
    check_session_too_long,
    check_fatigue,  # requires fatigue kwarg — handled separately
]

# Standard rules respect cooldown
_STANDARD_RULES = [
    check_consecutive_mistakes,
    check_concept_confusion,
    check_low_retention,
    check_low_confidence,
    check_high_performance,
    check_fast_answering,
]

ALL_RULES = [
    check_consecutive_mistakes,
    check_session_too_long,
    check_concept_confusion,
    check_low_retention,
    check_low_confidence,
    check_high_performance,
    check_fast_answering,
]
