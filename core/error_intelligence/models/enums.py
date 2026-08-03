"""
All enumerations for the Error Intelligence Engine.
"""
from __future__ import annotations
from enum import Enum


class ErrorClassification(str, Enum):
    """Primary cause assigned to every wrong answer."""
    UNKNOWN_CONTENT     = "UNKNOWN_CONTENT"       # content never studied
    MEMORY_FAILURE      = "MEMORY_FAILURE"         # was known, now forgotten
    CONCEPT_CONFUSION   = "CONCEPT_CONFUSION"      # confuses two related ideas
    MISREAD_QUESTION    = "MISREAD_QUESTION"        # didn't read carefully
    DISTRACTION         = "DISTRACTION"             # session fatigue or low energy
    LAW_CONFUSION       = "LAW_CONFUSION"           # confuses overlapping legislation
    INTERPRETATION_ERROR = "INTERPRETATION_ERROR"  # misinterpreted the sentence
    EXCEPTION_CONFUSION = "EXCEPTION_CONFUSION"    # missed the exception / "salvo"
    OVERCONFIDENCE      = "OVERCONFIDENCE"          # high confidence, still wrong
    LOW_CONFIDENCE      = "LOW_CONFIDENCE"          # uncertainty / paralysis
    TIME_PRESSURE       = "TIME_PRESSURE"           # answered too fast
    GUESS               = "GUESS"                   # random attempt with no basis


class ErrorSeverity(str, Enum):
    """Impact on approval probability."""
    LOW      = "LOW"
    MEDIUM   = "MEDIUM"
    HIGH     = "HIGH"
    CRITICAL = "CRITICAL"


class TreatmentActionType(str, Enum):
    """Possible remediation actions."""
    READ_LAW                 = "READ_LAW"
    REVIEW_SPECIFIC_ARTICLE  = "REVIEW_SPECIFIC_ARTICLE"
    SOLVE_SIMILAR_QUESTIONS  = "SOLVE_SIMILAR_QUESTIONS"
    REVIEW_RELATED_CONCEPTS  = "REVIEW_RELATED_CONCEPTS"
    CREATE_FLASHCARD_CANDIDATE = "CREATE_FLASHCARD_CANDIDATE"
    INCREASE_REVIEW_PRIORITY = "INCREASE_REVIEW_PRIORITY"
    SCHEDULE_SHORT_REVIEW    = "SCHEDULE_SHORT_REVIEW"
    SCHEDULE_LONG_REVIEW     = "SCHEDULE_LONG_REVIEW"
    REVISIT_PREVIOUS_MISTAKES = "REVISIT_PREVIOUS_MISTAKES"


class PatternType(str, Enum):
    """Recurring behavioural patterns across errors."""
    FAST_ANSWERER      = "FAST_ANSWERER"       # consistently answers too quickly
    EXCEPTION_MISSER   = "EXCEPTION_MISSER"    # misses exception-based questions
    OVERCONFIDENT      = "OVERCONFIDENT"       # high confidence with wrong answers
    FATIGUE_ERRORS     = "FATIGUE_ERRORS"      # errors cluster at end of sessions
    LAW_CONFUSER       = "LAW_CONFUSER"        # confuses overlapping legislation
    TOPIC_BLIND_SPOT   = "TOPIC_BLIND_SPOT"    # consistent failure in one topic area
    ANSWER_CHANGER     = "ANSWER_CHANGER"      # changes correct answers to wrong


class EvolutionDirection(str, Enum):
    """Whether an error is improving, stable, or getting worse over time."""
    DISAPPEARED = "DISAPPEARED"
    IMPROVED    = "IMPROVED"
    STABLE      = "STABLE"
    WORSENING   = "WORSENING"
