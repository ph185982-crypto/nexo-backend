"""
ErrorContext and all input snapshot types.

Callers (infrastructure / routers) are responsible for mapping data
from their persistence layer into these types.

This keeps the Error Intelligence Engine decoupled from:
  - Database schema (sqlalchemy, asyncpg queries)
  - Other engine internals (LearningProfile, KnowledgeGraph, ApprovalEstimate)

All types are plain dataclasses — no business logic.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional
from uuid import UUID


@dataclass
class QuestionSnapshot:
    """Projected from the questions table and its computed stats."""
    question_id: UUID
    subject_id: UUID
    topic_id: Optional[UUID]

    question_type: str          # "certo_errado" | "multipla_escolha"
    # Inferred by callers from tags/legal_basis — guides classification heuristics
    content_type: str           # "lei_seca" | "interpretacao" | "excecao" | "regra_geral" | "unknown"
    difficulty: str             # "easy" | "medium" | "hard"

    legal_basis: Optional[str]  # article/law string referenced in the question
    legal_article_id: Optional[UUID]
    tags: list[str] = field(default_factory=list)  # free-form tags from the question bank

    # Aggregate stats from the question bank (used to compute question difficulty signal)
    times_answered: int = 0
    times_correct: int = 0
    avg_time_secs: Optional[float] = None

    @property
    def global_accuracy(self) -> float:
        """How hard is this question for all users?"""
        if self.times_answered == 0:
            return 0.5
        return self.times_correct / self.times_answered

    @property
    def is_exception_type(self) -> bool:
        """True when the question tests an exception rule ('salvo', 'exceto', 'exceto se')."""
        exception_tags = {"excecao", "exceto", "salvo", "excecoes"}
        return (
            self.content_type == "excecao"
            or bool(exception_tags & {t.lower() for t in self.tags})
        )

    @property
    def is_interpretation_type(self) -> bool:
        return self.content_type == "interpretacao"

    @property
    def has_multiple_legal_refs(self) -> bool:
        """More than one law/article reference — increases LAW_CONFUSION risk."""
        if not self.legal_basis:
            return False
        separators = [";", ",", " e ", "/"]
        return any(sep in self.legal_basis for sep in separators)


@dataclass
class PreviousAttemptSnapshot:
    """One past attempt by this user on this same question."""
    answered_at: datetime
    is_correct: bool
    confidence: Optional[int]   # 1-5 self-assessment
    time_spent_secs: Optional[int]


@dataclass
class ErrorEntrySnapshot:
    """
    Projected from error_notebook.
    Present when the user has previously made an error on this question.
    """
    times_repeated: int                 # how many times this error has recurred
    resolved: bool                      # marked as resolved by student or system
    last_error_at: datetime
    error_type: Optional[str]           # existing 'conceptual' | 'attention' | 'interpretation' | 'unknown'
    error_summary: Optional[str]        # free text summary from previous analysis


@dataclass
class ReviewCardSnapshot:
    """
    Projected from review_cards (SM-2 state for this question).
    None when the question has no review card yet.
    """
    ease_factor: float          # 2.5 default; higher = well retained
    interval_days: float        # scheduled review interval
    repetitions: int            # total SM-2 repetition count
    is_overdue: bool
    last_quality: Optional[int] # SM-2 quality rating of last review (0-5)
    total_reviews: int
    total_correct: int
    streak: int                 # consecutive correct reviews
    lapsed: bool                # card reset to learning phase (SM-2 lapse)


@dataclass
class MasterySnapshot:
    """
    Projected from subject_mastery for this user × subject × topic.
    None when no mastery record exists (never studied).
    """
    mastery_level: float        # 0-1 computed mastery
    total_attempts: int
    accuracy: float             # 0-1 historical accuracy
    error_count: int
    last_studied: Optional[datetime]


@dataclass
class SessionSnapshot:
    """
    Context about the study session in which this error occurred.
    Used to detect fatigue, distraction, and time-pressure patterns.
    """
    session_id: UUID
    position_in_session: int        # ordinal position of this question (1-based)
    total_questions_so_far: int
    accuracy_so_far: float          # 0-1 accuracy across session up to this point
    energy_level: Optional[str]     # "high" | "medium" | "low" | None
    duration_so_far_mins: float


@dataclass
class LearningContextSnapshot:
    """
    Projected from LearningProfile.as_roi_context() + extra fields.
    Callers extract what the EIE needs without coupling to LearningProfile's structure.
    """
    forgetting_velocity_subject: float  # 0-1 daily forgetting rate for this subject
    confidence_calibration: float       # 0-1; 1 = perfect alignment confidence/accuracy
    confidence_for_subject: float       # 0-1 confidence in this specific subject
    learning_speed: str                 # "fast" | "medium" | "slow"
    fatigue_threshold_mins: int         # minutes before accuracy starts to drop
    confused_topics: list[str]          # topic_ids most confused
    confusion_pairs: list[tuple[str, str, float]]  # (topic_a_id, topic_b_id, score 0-1)
    retention_category: str             # "strong" | "medium" | "weak"
    review_efficiency: float            # 0-1


@dataclass
class ApprovalContextSnapshot:
    """
    Minimal slice of ApprovalEstimate for severity calibration.
    Does not duplicate the Approval Engine — just the fields needed here.
    """
    approval_probability: float         # 0-1 current estimate
    subject_weight: float               # this subject's absolute exam weight (e.g. 2.5 for PRF)
    risk_level: str                     # "low" | "medium" | "high"


@dataclass
class ErrorContext:
    """
    Complete input context for error analysis.

    Assembled by callers from data across DB queries and other engines.
    The Error Intelligence Engine never fetches data — it only diagnoses.
    """
    user_id: UUID
    question: QuestionSnapshot
    user_answer: str                    # "C" | "E" or multiple-choice letter
    correct_answer: str
    response_time_secs: Optional[int]   # None when timing was not captured

    # 1-5 self-assessment; None when the interface didn't collect it
    confidence: Optional[int]

    # ── Per-question history ───────────────────────────────────────────
    previous_attempts: list[PreviousAttemptSnapshot] = field(default_factory=list)
    error_entry: Optional[ErrorEntrySnapshot] = None  # from error_notebook
    review_card: Optional[ReviewCardSnapshot] = None  # from review_cards
    mastery: Optional[MasterySnapshot] = None         # from subject_mastery

    # ── Session context ───────────────────────────────────────────────
    session: Optional[SessionSnapshot] = None

    # ── Cognitive context (from LearningProfile) ──────────────────────
    learning: Optional[LearningContextSnapshot] = None

    # ── Approval context (from ApprovalEstimate) ──────────────────────
    approval: Optional[ApprovalContextSnapshot] = None

    # ── KGE result (caller runs KGE, passes OriginResult here) ────────
    # Accepted as Any to avoid coupling to KGE internals.
    # The engine uses duck-typed attribute access: .article, .topic, .sibling_questions, etc.
    origin_result: Optional[Any] = None

    # ── Convenience accessors ─────────────────────────────────────────

    @property
    def is_first_attempt(self) -> bool:
        return len(self.previous_attempts) == 0

    @property
    def is_recurring_error(self) -> bool:
        return self.error_entry is not None and self.error_entry.times_repeated > 1

    @property
    def prev_correct_count(self) -> int:
        return sum(1 for a in self.previous_attempts if a.is_correct)

    @property
    def prev_accuracy(self) -> Optional[float]:
        if not self.previous_attempts:
            return None
        return self.prev_correct_count / len(self.previous_attempts)

    @property
    def avg_past_time(self) -> Optional[float]:
        times = [a.time_spent_secs for a in self.previous_attempts if a.time_spent_secs is not None]
        return sum(times) / len(times) if times else None

    @property
    def is_overdue_for_review(self) -> bool:
        return self.review_card is not None and self.review_card.is_overdue

    @property
    def topic_id_str(self) -> Optional[str]:
        return str(self.question.topic_id) if self.question.topic_id else None
