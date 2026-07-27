"""
Adaptive Difficulty Engine — adjusts question difficulty and content format
based on the user's real-time performance.

Key behaviors:
  - Moves difficulty up after consecutive correct answers
  - Moves difficulty down after errors (preserving confidence)
  - Adjusts question count per block based on accuracy
  - Recommends format switches (text → flashcard → audio)
"""
from __future__ import annotations
from dataclasses import dataclass
from enum import IntEnum


class Difficulty(IntEnum):
    EASY = 1
    MEDIUM = 2
    HARD = 3
    EXPERT = 4


DIFFICULTY_LABELS = {
    Difficulty.EASY: "easy",
    Difficulty.MEDIUM: "medium",
    Difficulty.HARD: "hard",
    Difficulty.EXPERT: "expert",
}


@dataclass
class PerformanceWindow:
    """Rolling window of recent performance."""
    recent_correct: int = 0
    recent_total: int = 0
    consecutive_correct: int = 0
    consecutive_wrong: int = 0
    avg_time_secs: float = 0
    current_difficulty: Difficulty = Difficulty.MEDIUM


@dataclass
class AdaptiveDecision:
    next_difficulty: str
    difficulty_changed: bool
    reason: str
    suggested_format: str | None = None
    reduce_load: bool = False


def adapt_difficulty(window: PerformanceWindow) -> AdaptiveDecision:
    """
    Given a rolling performance window, decide the next difficulty level
    and whether to change format.
    """
    current = window.current_difficulty
    accuracy = window.recent_correct / max(window.recent_total, 1)

    # Promote after 5+ consecutive correct or high accuracy over 10+ questions
    if window.consecutive_correct >= 5 and current < Difficulty.EXPERT:
        new = Difficulty(current + 1)
        return AdaptiveDecision(
            next_difficulty=DIFFICULTY_LABELS[new],
            difficulty_changed=True,
            reason=f"{window.consecutive_correct} acertos seguidos — aumentando dificuldade.",
        )

    if window.recent_total >= 10 and accuracy >= 0.85 and current < Difficulty.EXPERT:
        new = Difficulty(current + 1)
        return AdaptiveDecision(
            next_difficulty=DIFFICULTY_LABELS[new],
            difficulty_changed=True,
            reason=f"Acurácia alta ({accuracy:.0%}) — subindo nível.",
        )

    # Demote after 3 consecutive wrong or low accuracy
    if window.consecutive_wrong >= 3 and current > Difficulty.EASY:
        new = Difficulty(current - 1)
        return AdaptiveDecision(
            next_difficulty=DIFFICULTY_LABELS[new],
            difficulty_changed=True,
            reason="Sequência de erros — ajustando para nível mais acessível.",
            suggested_format="flashcards",
            reduce_load=True,
        )

    if window.recent_total >= 8 and accuracy < 0.4 and current > Difficulty.EASY:
        new = Difficulty(current - 1)
        return AdaptiveDecision(
            next_difficulty=DIFFICULTY_LABELS[new],
            difficulty_changed=True,
            reason=f"Acurácia baixa ({accuracy:.0%}) — ajustando dificuldade.",
            suggested_format="legal_reading",
            reduce_load=True,
        )

    # Fatigue detection — if avg time is increasing significantly
    if window.avg_time_secs > 120 and window.recent_total >= 5:
        return AdaptiveDecision(
            next_difficulty=DIFFICULTY_LABELS[current],
            difficulty_changed=False,
            reason="Tempo por questão alto — possível cansaço.",
            suggested_format="flashcards",
            reduce_load=True,
        )

    return AdaptiveDecision(
        next_difficulty=DIFFICULTY_LABELS[current],
        difficulty_changed=False,
        reason="Rendimento estável — mantendo nível atual.",
    )


def compute_questions_for_block(
    available_mins: int,
    difficulty: Difficulty,
    accuracy: float,
) -> int:
    """How many questions fit in a time block, adjusted for difficulty and accuracy."""
    base_time_per_q = {
        Difficulty.EASY: 1.5,
        Difficulty.MEDIUM: 2.5,
        Difficulty.HARD: 3.5,
        Difficulty.EXPERT: 4.5,
    }[difficulty]

    if accuracy < 0.4:
        base_time_per_q *= 1.3  # slower when struggling

    return max(3, int(available_mins / base_time_per_q))
