"""Enumerations for the Question Selection domain."""
from __future__ import annotations

from enum import Enum


class DifficultyLevel(str, Enum):
    VERY_EASY = "VERY_EASY"
    EASY      = "EASY"
    MEDIUM    = "MEDIUM"
    HARD      = "HARD"
    VERY_HARD = "VERY_HARD"


# Numeric value for distance calculations
DIFFICULTY_VALUE: dict[DifficultyLevel, int] = {
    DifficultyLevel.VERY_EASY: 0,
    DifficultyLevel.EASY:      1,
    DifficultyLevel.MEDIUM:    2,
    DifficultyLevel.HARD:      3,
    DifficultyLevel.VERY_HARD: 4,
}


class SelectionMode(str, Enum):
    NORMAL          = "NORMAL"           # Default balanced selection
    REINFORCEMENT   = "REINFORCEMENT"    # Prioritise concept consolidation
    REVIEW          = "REVIEW"           # Clear spaced-repetition backlog
    EXAM_SIMULATION = "EXAM_SIMULATION"  # Mirror real exam question profile
    OBJECTIVE       = "OBJECTIVE"        # Align with specific session objective


class SelectionReason(str, Enum):
    KNOWLEDGE_GAP          = "KNOWLEDGE_GAP"
    RECURRING_MISTAKE      = "RECURRING_MISTAKE"
    EXAM_FREQUENCY         = "EXAM_FREQUENCY"
    OBJECTIVE_ALIGNMENT    = "OBJECTIVE_ALIGNMENT"
    RETENTION_DUE          = "RETENTION_DUE"
    DIFFICULTY_MATCH       = "DIFFICULTY_MATCH"
    COVERAGE_BALANCE       = "COVERAGE_BALANCE"
    BEST_ROI               = "BEST_ROI"
    REINFORCEMENT_REQUIRED = "REINFORCEMENT_REQUIRED"
    REVIEW_BACKLOG         = "REVIEW_BACKLOG"
    FALLBACK               = "FALLBACK"
