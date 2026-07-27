"""
Behavior Analysis Engine — learns from the user's study patterns
to optimize scheduling and content delivery.

Tracks:
  - Best study hours (when accuracy peaks)
  - Fatigue patterns (when performance drops)
  - Format preferences (what yields best retention)
  - Consistency patterns (which days they study/skip)
  - Session length sweet spot
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, time
from collections import defaultdict
from typing import Optional


@dataclass
class SessionRecord:
    started_at: datetime
    duration_mins: float
    accuracy: float
    questions_answered: int
    mode: str
    energy_start: str
    energy_end: Optional[str] = None
    completed: bool = True


@dataclass
class BehaviorInsights:
    best_study_hour: Optional[int] = None
    worst_study_hour: Optional[int] = None
    avg_session_minutes: float = 0
    optimal_session_minutes: int = 30
    fatigue_threshold_mins: int = 45
    best_day_of_week: Optional[int] = None
    worst_day_of_week: Optional[int] = None
    preferred_block_size: int = 15
    consistency_score: float = 0
    retention_score: float = 0
    format_accuracy: dict[str, float] = field(default_factory=dict)


def analyze_behavior(sessions: list[SessionRecord]) -> BehaviorInsights:
    """
    Analyze a list of study sessions to extract behavioral insights.
    """
    if not sessions:
        return BehaviorInsights()

    # Group accuracy by hour
    accuracy_by_hour: dict[int, list[float]] = defaultdict(list)
    accuracy_by_day: dict[int, list[float]] = defaultdict(list)
    accuracy_by_mode: dict[str, list[float]] = defaultdict(list)
    durations: list[float] = []
    completed_durations: list[float] = []
    fatigue_points: list[float] = []

    for s in sessions:
        hour = s.started_at.hour
        day = s.started_at.weekday()
        accuracy_by_hour[hour].append(s.accuracy)
        accuracy_by_day[day].append(s.accuracy)
        accuracy_by_mode[s.mode].append(s.accuracy)
        durations.append(s.duration_mins)

        if s.completed:
            completed_durations.append(s.duration_mins)

        if s.duration_mins > 30 and s.accuracy < 0.5:
            fatigue_points.append(s.duration_mins)

    # Best / worst hour
    hour_avgs = {h: sum(accs) / len(accs) for h, accs in accuracy_by_hour.items() if len(accs) >= 2}
    best_hour = max(hour_avgs, key=hour_avgs.get) if hour_avgs else None
    worst_hour = min(hour_avgs, key=hour_avgs.get) if hour_avgs else None

    # Best / worst day
    day_avgs = {d: sum(accs) / len(accs) for d, accs in accuracy_by_day.items() if len(accs) >= 2}
    best_day = max(day_avgs, key=day_avgs.get) if day_avgs else None
    worst_day = min(day_avgs, key=day_avgs.get) if day_avgs else None

    # Average session
    avg_duration = sum(durations) / len(durations) if durations else 0

    # Optimal session length: median of completed sessions with good accuracy
    good_sessions = [s.duration_mins for s in sessions if s.accuracy >= 0.6 and s.completed]
    if good_sessions:
        good_sessions.sort()
        optimal = good_sessions[len(good_sessions) // 2]
    else:
        optimal = 30

    # Fatigue threshold: average duration where performance drops
    fatigue = int(sum(fatigue_points) / len(fatigue_points)) if fatigue_points else 45

    # Preferred block size based on completed session durations
    if completed_durations:
        completed_durations.sort()
        preferred_block = int(completed_durations[len(completed_durations) // 2])
        preferred_block = max(10, min(preferred_block, 45))
    else:
        preferred_block = 15

    # Consistency: what % of the last 30 days had study sessions
    if sessions:
        unique_dates = set(s.started_at.date() for s in sessions)
        recent_dates = sorted(unique_dates)[-30:]
        consistency = len(recent_dates) / 30 * 100
    else:
        consistency = 0

    # Retention: average accuracy on review cards
    review_sessions = [s for s in sessions if s.mode == "review"]
    retention = (sum(s.accuracy for s in review_sessions) / len(review_sessions) * 100) if review_sessions else 0

    # Format accuracy
    format_acc = {
        mode: round(sum(accs) / len(accs) * 100, 1)
        for mode, accs in accuracy_by_mode.items()
        if accs
    }

    return BehaviorInsights(
        best_study_hour=best_hour,
        worst_study_hour=worst_hour,
        avg_session_minutes=round(avg_duration, 1),
        optimal_session_minutes=int(optimal),
        fatigue_threshold_mins=fatigue,
        best_day_of_week=best_day,
        worst_day_of_week=worst_day,
        preferred_block_size=preferred_block,
        consistency_score=round(consistency, 1),
        retention_score=round(retention, 1),
        format_accuracy=format_acc,
    )


def detect_study_mode(
    hour: int,
    is_commuting: bool,
    energy: str,
    available_minutes: int,
) -> str:
    """Detect the appropriate study mode based on context."""
    if is_commuting:
        return "commute"
    if available_minutes <= 10:
        return "micro"
    if energy in ("very_low", "low"):
        return "tired"
    if energy in ("very_high", "high"):
        return "high_energy"
    return "focus"


def suggest_energy_level(hour: int, day_of_week: int, insights: BehaviorInsights) -> str:
    """Suggest a likely energy level based on behavioral patterns."""
    if insights.best_study_hour is not None:
        diff = abs(hour - insights.best_study_hour)
        if diff <= 1:
            return "high"
        if diff >= 6:
            return "low"

    if 6 <= hour <= 10:
        return "high"
    if 13 <= hour <= 15:
        return "low"
    if 19 <= hour <= 21:
        return "medium"
    if hour >= 22 or hour < 6:
        return "very_low"
    return "medium"
