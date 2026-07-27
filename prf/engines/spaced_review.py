"""
Spaced Repetition Engine — SM-2 implementation with modular design for FSRS upgrade.

The algorithm schedules reviews based on the user's recall quality:
  - blackout / wrong  → reset, review again soon
  - hard              → shorter interval, lower ease
  - good              → standard progression
  - easy              → longer interval, raise ease

Each card tracks: ease_factor, interval_days, repetitions, streak.
"""
from __future__ import annotations
from datetime import datetime, timedelta
from dataclasses import dataclass
from enum import IntEnum


class Quality(IntEnum):
    BLACKOUT = 0
    WRONG = 1
    HARD = 2
    GOOD = 3
    EASY = 4

    @classmethod
    def from_str(cls, s: str) -> "Quality":
        return cls[s.upper()]


QUALITY_MAP = {
    "blackout": Quality.BLACKOUT,
    "wrong": Quality.WRONG,
    "hard": Quality.HARD,
    "good": Quality.GOOD,
    "easy": Quality.EASY,
}

MIN_EASE = 1.3
DEFAULT_EASE = 2.5
MAX_INTERVAL = 365


@dataclass
class ReviewState:
    ease_factor: float = DEFAULT_EASE
    interval_days: float = 0
    repetitions: int = 0
    streak: int = 0
    lapsed: bool = False


@dataclass
class ReviewUpdate:
    ease_factor: float
    interval_days: float
    repetitions: int
    streak: int
    lapsed: bool
    next_review: datetime


def compute_review(state: ReviewState, quality: Quality, now: datetime | None = None) -> ReviewUpdate:
    """
    Compute the next review state given current state and quality of recall.
    Returns a ReviewUpdate with the new scheduling parameters.
    """
    now = now or datetime.utcnow()
    ease = state.ease_factor
    interval = state.interval_days
    reps = state.repetitions
    streak = state.streak
    lapsed = state.lapsed

    if quality <= Quality.WRONG:
        reps = 0
        interval = _lapse_interval(state)
        streak = 0
        lapsed = True
        ease = max(MIN_EASE, ease - 0.2)
    elif quality == Quality.HARD:
        reps += 1
        ease = max(MIN_EASE, ease - 0.15)
        if reps == 1:
            interval = 1
        elif reps == 2:
            interval = 3
        else:
            interval = interval * ease * 0.8
        streak += 1
        lapsed = False
    elif quality == Quality.GOOD:
        reps += 1
        ease = max(MIN_EASE, ease + 0.0)
        if reps == 1:
            interval = 1
        elif reps == 2:
            interval = 4
        else:
            interval = interval * ease
        streak += 1
        lapsed = False
    else:  # EASY
        reps += 1
        ease = max(MIN_EASE, ease + 0.15)
        if reps == 1:
            interval = 2
        elif reps == 2:
            interval = 6
        else:
            interval = interval * ease * 1.3
        streak += 1
        lapsed = False

    interval = min(interval, MAX_INTERVAL)
    interval = max(interval, 0.5)

    next_review = now + timedelta(days=interval)

    return ReviewUpdate(
        ease_factor=round(ease, 3),
        interval_days=round(interval, 2),
        repetitions=reps,
        streak=streak,
        lapsed=lapsed,
        next_review=next_review,
    )


def _lapse_interval(state: ReviewState) -> float:
    """On lapse, use a fraction of the previous interval, minimum 0.5 days."""
    if state.interval_days <= 1:
        return 0.25  # ~6 hours
    return max(0.5, state.interval_days * 0.2)


def cards_due_count(cards: list[dict], now: datetime | None = None) -> dict:
    """Categorize cards into overdue, due_today, due_tomorrow."""
    now = now or datetime.utcnow()
    today_end = now.replace(hour=23, minute=59, second=59)
    tomorrow_end = today_end + timedelta(days=1)

    overdue = 0
    due_today = 0
    due_tomorrow = 0

    for card in cards:
        nr = card.get("next_review")
        if isinstance(nr, str):
            nr = datetime.fromisoformat(nr)
        if nr <= now:
            overdue += 1
        elif nr <= today_end:
            due_today += 1
        elif nr <= tomorrow_end:
            due_tomorrow += 1

    return {
        "overdue": overdue,
        "due_today": due_today,
        "due_tomorrow": due_tomorrow,
        "total_due": overdue + due_today,
    }


def xp_for_review(quality: Quality) -> int:
    """XP reward based on review quality."""
    return {
        Quality.BLACKOUT: 2,
        Quality.WRONG: 3,
        Quality.HARD: 8,
        Quality.GOOD: 10,
        Quality.EASY: 12,
    }[quality]
