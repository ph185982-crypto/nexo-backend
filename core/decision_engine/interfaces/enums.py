from enum import Enum


class StepType(str, Enum):
    LAW = "law"
    QUESTIONS = "questions"
    FLASHCARDS = "flashcards"
    REVIEW = "review"
    SIMULATION = "simulation"
    AUDIO = "audio"
    SUMMARY = "summary"
    BREAK = "break"


class DecisionReason(str, Enum):
    LOW_RETENTION = "low_retention"
    HIGH_PRIORITY_TOPIC = "high_priority_topic"
    WEAK_SUBJECT = "weak_subject"
    RECENT_ERRORS = "recent_errors"
    SPACED_REVIEW = "spaced_review"
    LOW_COVERAGE = "low_coverage"
    MISSION_INCOMPLETE = "mission_incomplete"
    STRONG_MASTERY = "strong_mastery"
    EXAM_APPROACHING = "exam_approaching"
    OPTIMAL_ENERGY = "optimal_energy"


class MissionPriority(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"
