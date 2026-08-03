"""
LearningProfile and all its value objects.
These are the cognitive outputs of the Learning Engine — read-only from outside.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID


@dataclass(frozen=True)
class LearningSpeed:
    """How fast does this user process and acquire new knowledge?"""
    avg_time_per_question_secs: float  # mean response time
    questions_per_session: float       # throughput per study block
    learning_velocity: float           # accuracy improvement rate 0-1 (higher = learns faster)
    category: str                      # "fast" | "medium" | "slow"

    @property
    def is_fast(self) -> bool:
        return self.category == "fast"


@dataclass(frozen=True)
class RetentionStrength:
    """How well does this user retain what they learned?"""
    avg_ease_factor: float             # SM-2 EF aggregate; 2.5 = default, higher = retains better
    avg_interval_days: float           # how long between reviews on average
    review_retention_rate: float       # fraction of reviews answered correctly 0-1
    stability_score: float             # 0-1 composite
    category: str                      # "strong" | "medium" | "weak"

    @property
    def needs_more_reviews(self) -> bool:
        return self.category == "weak"


@dataclass(frozen=True)
class ConfidenceIndex:
    """Measured confidence per subject, derived from accuracy trends."""
    overall: float                     # 0-1 overall confidence
    by_subject: dict[str, float]       # subject_id (str) → 0-1
    calibration_score: float           # 0-1; 1 = perfect alignment between self-rating and accuracy

    def for_subject(self, subject_id: str) -> float:
        return self.by_subject.get(subject_id, self.overall)


@dataclass(frozen=True)
class KnowledgeStability:
    """How consistent (vs volatile) is this user's performance?"""
    stability_score: float             # 0-1; high = consistent, low = erratic
    volatile_subjects: tuple[str, ...]  # subject_ids where accuracy fluctuates most
    stable_subjects: tuple[str, ...]    # subject_ids with consistent performance

    def is_volatile(self, subject_id: str) -> bool:
        return subject_id in self.volatile_subjects


@dataclass(frozen=True)
class FormatPreference:
    """Which study format correlates with the best performance for this user?"""
    primary: str                       # "questions" | "review" | "simulation" | "reading" | "audio"
    secondary: str
    performance_by_format: dict[str, float]  # format → accuracy 0-1

    def accuracy_for(self, fmt: str) -> float:
        return self.performance_by_format.get(fmt, 0.5)


@dataclass(frozen=True)
class SequencePreference:
    """When and how long should this user study?"""
    best_hour: int                     # 0-23; peak performance hour
    best_session_length_mins: int      # optimal session duration
    energy_pattern: str                # "morning_peak" | "evening_peak" | "consistent" | "unknown"

    @property
    def is_morning_learner(self) -> bool:
        return self.best_hour < 12


@dataclass(frozen=True)
class ReviewEfficiency:
    """How efficiently does SM-2 repetition translate to mastery?"""
    reviews_per_mastery_point: float   # lower is better; reviews needed per 1% mastery gain
    lapse_rate: float                  # 0-1; fraction of cards that lapsed back to learning
    streak_avg: float                  # average consecutive correct streak
    efficiency_score: float            # 0-1 composite; higher = more efficient

    @property
    def is_efficient(self) -> bool:
        return self.efficiency_score >= 0.65


@dataclass(frozen=True)
class FatigueThreshold:
    """At what session length does this user's performance degrade?"""
    threshold_minutes: int             # estimated session length before accuracy drops
    accuracy_at_start: float           # 0-1 accuracy at session start
    accuracy_at_end: float             # 0-1 accuracy at session end
    drop_rate: float                   # accuracy loss per 30 minutes

    @property
    def should_take_break(self, elapsed_minutes: int = 0) -> bool:
        return elapsed_minutes >= self.threshold_minutes


@dataclass(frozen=True)
class ConceptConfusionMatrix:
    """Which topics does this user confuse with each other?"""
    confused_pairs: tuple[tuple[str, str, float], ...]  # (topic_a, topic_b, confusion_score 0-1)
    most_confused: tuple[str, ...]     # topic_ids most frequently involved in errors

    def confusion_score(self, topic_a: str, topic_b: str) -> float:
        for a, b, score in self.confused_pairs:
            if (a, b) == (topic_a, topic_b) or (b, a) == (topic_a, topic_b):
                return score
        return 0.0


@dataclass
class LearningProfile:
    """
    Complete cognitive model of a user's learning behaviour.
    Computed from raw history — never persisted directly.
    Read-only from external engines; updated only by LearningEngine.
    """
    user_id: UUID
    target_exam: str
    computed_at: datetime

    # ── Cognitive dimensions ───────────────────────────────────────────
    learning_speed: LearningSpeed
    retention_strength: RetentionStrength
    confidence: ConfidenceIndex
    knowledge_stability: KnowledgeStability
    preferred_format: FormatPreference
    preferred_sequence: SequencePreference
    review_efficiency: ReviewEfficiency
    fatigue_threshold: FatigueThreshold
    confusion_matrix: ConceptConfusionMatrix

    # ── Per-topic confidence map (topic_id str → 0-1) ─────────────────
    topic_mastery_confidence: dict[str, float] = field(default_factory=dict)

    # ── Forgetting velocity per subject (subject_id str → rate/day) ───
    forgetting_velocity: dict[str, float] = field(default_factory=dict)

    # ── Mastery projections (subject_id str → days to reach 70%) ─────
    mastery_projections: dict[str, Optional[int]] = field(default_factory=dict)

    # ── Human-readable summary ────────────────────────────────────────
    cognitive_summary: str = ""

    def is_fresh(self, max_age_hours: int = 24) -> bool:
        """Profile is usable without recomputation."""
        age = (datetime.now(timezone.utc) - self.computed_at).total_seconds() / 3600
        return age < max_age_hours

    def as_roi_context(self) -> dict:
        """
        Lightweight dict for injection into ROI Engine context.
        Callers convert this to their own types — zero direct coupling.
        """
        return {
            "learning_speed_category": self.learning_speed.category,
            "preferred_format": self.preferred_format.primary,
            "fatigue_threshold_minutes": self.fatigue_threshold.threshold_minutes,
            "best_study_hour": self.preferred_sequence.best_hour,
            "retention_category": self.retention_strength.category,
            "review_efficiency_score": self.review_efficiency.efficiency_score,
            "confidence_overall": self.confidence.overall,
            "confidence_by_subject": dict(self.confidence.by_subject),
            "forgetting_velocity": dict(self.forgetting_velocity),
        }

    def as_decision_context(self) -> dict:
        """
        Lightweight dict for injection into Decision Engine context.
        """
        return {
            "fatigue_threshold_minutes": self.fatigue_threshold.threshold_minutes,
            "preferred_session_length_mins": self.preferred_sequence.best_session_length_mins,
            "best_study_hour": self.preferred_sequence.best_hour,
            "energy_pattern": self.preferred_sequence.energy_pattern,
            "retention_strength": self.retention_strength.stability_score,
            "learning_velocity": self.learning_speed.learning_velocity,
            "review_efficiency": self.review_efficiency.efficiency_score,
            "confused_topics": list(self.confusion_matrix.most_confused),
        }
