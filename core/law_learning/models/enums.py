from __future__ import annotations

from enum import Enum


class DifficultyLevel(str, Enum):
    VERY_EASY  = "VERY_EASY"
    EASY       = "EASY"
    MEDIUM     = "MEDIUM"
    HARD       = "HARD"
    VERY_HARD  = "VERY_HARD"


class ImportanceLevel(str, Enum):
    LOW       = "LOW"
    MEDIUM    = "MEDIUM"
    HIGH      = "HIGH"
    CRITICAL  = "CRITICAL"


class StudyStatus(str, Enum):
    NOT_STARTED = "NOT_STARTED"
    IN_PROGRESS = "IN_PROGRESS"
    MASTERED    = "MASTERED"
    NEEDS_REVIEW = "NEEDS_REVIEW"


class NextActionType(str, Enum):
    READ_ARTICLE        = "READ_ARTICLE"
    REVIEW_ARTICLE      = "REVIEW_ARTICLE"
    SOLVE_QUESTIONS     = "SOLVE_QUESTIONS"
    COMPARE_ARTICLES    = "COMPARE_ARTICLES"
    CREATE_FLASHCARD    = "CREATE_FLASHCARD"
    REVISIT_MISTAKES    = "REVISIT_MISTAKES"
    ADVANCE_TO_RELATED  = "ADVANCE_TO_RELATED"
