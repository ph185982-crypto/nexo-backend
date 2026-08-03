"""
Valid state transitions for the Study Runtime FSM.

Each key is the current state; the value is the set of states that can be
reached from it. Terminal states have empty sets (no transitions out).
"""
from __future__ import annotations

from ..models.enums import SessionState

_STEP_STATES = frozenset({
    SessionState.LAW, SessionState.QUESTIONS, SessionState.REVIEW,
    SessionState.SUMMARY, SessionState.AUDIO, SessionState.BREAK,
    SessionState.ASSESSING,
})

_ANY_ACTIVE = _STEP_STATES | {SessionState.RUNNING, SessionState.ADAPTING}

VALID_TRANSITIONS: dict[SessionState, frozenset[SessionState]] = {
    SessionState.CREATED: frozenset({
        SessionState.READY,
        SessionState.FAILED,
    }),
    SessionState.READY: frozenset({
        SessionState.STARTING,
        SessionState.FAILED,
    }),
    SessionState.STARTING: frozenset({
        SessionState.RUNNING,
        SessionState.FAILED,
    }),
    SessionState.RUNNING: frozenset(
        _STEP_STATES | {
            SessionState.ADAPTING,
            SessionState.PAUSED,
            SessionState.COMPLETED,
            SessionState.INTERRUPTED,
            SessionState.FAILED,
        }
    ),
    # All step sub-states can transition back to RUNNING or enter ADAPTING
    **{
        state: frozenset({
            SessionState.RUNNING,
            SessionState.ADAPTING,
            SessionState.PAUSED,
            SessionState.INTERRUPTED,
            SessionState.FAILED,
        })
        for state in _STEP_STATES
    },
    SessionState.ADAPTING: frozenset(
        _STEP_STATES | {
            SessionState.RUNNING,
            SessionState.PAUSED,
            SessionState.COMPLETED,
            SessionState.INTERRUPTED,
            SessionState.FAILED,
        }
    ),
    SessionState.PAUSED: frozenset({
        SessionState.RUNNING,
        SessionState.INTERRUPTED,
        SessionState.FAILED,
    }),
    # Terminal states — no transitions out
    SessionState.COMPLETED:   frozenset(),
    SessionState.INTERRUPTED: frozenset(),
    SessionState.FAILED:      frozenset(),
}


def is_valid(from_state: SessionState, to_state: SessionState) -> bool:
    return to_state in VALID_TRANSITIONS.get(from_state, frozenset())


def validate(from_state: SessionState, to_state: SessionState) -> None:
    if not is_valid(from_state, to_state):
        raise ValueError(
            f"Invalid state transition: {from_state} → {to_state}"
        )
