"""
Input types for the Question Selection engine.

QuestionSnapshot — lightweight question projection the caller fetches from DB.
QuestionSelectionContext — everything the engine needs; assembled by the caller
from outputs of KGE, Learning Engine, Error Intelligence, Study Runtime, etc.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from uuid import UUID

from ..models.enums import DifficultyLevel, SelectionMode


@dataclass(frozen=True)
class QuestionSnapshot:
    """
    Lightweight projection of a question, provided by the caller from DB.

    The engine does not read the database. The caller fetches snapshots
    (via QuestionSelectionPort) and passes them in the context.
    """
    question_id: UUID
    subject_id: UUID
    topic_id: Optional[UUID] = None
    article_id: Optional[UUID] = None
    difficulty: DifficultyLevel = DifficultyLevel.MEDIUM
    exam_frequency: float = 0.50        # 0–1: how often it appears in real exams
    is_true_false: bool = True          # C/E format
    is_exception_type: bool = False     # phrased with "exceto / salvo"
    tags: tuple = field(default_factory=tuple)          # concept tag strings
    estimated_time_secs: int = 90
    times_answered: int = 0             # by this user (0 = unseen)
    times_wrong: int = 0
    last_answered_at: Optional[datetime] = None


@dataclass(frozen=True)
class QuestionSelectionContext:
    """
    Complete context required to select the next question.

    Assembled by the caller from multiple engine outputs:
      - available_questions   → DB / QuestionSelectionPort
      - knowledge_gaps        → Knowledge Graph Engine
      - subject_mastery       → Learning Engine
      - recent_errors, error_concept_tags → Error Intelligence Engine
      - review_backlog        → Learning Engine (spaced repetition)
      - approval_probability  → Approval Engine
      - fatigue_level, difficulty_target, remaining_time_secs → Study Runtime
    """
    # ── Required ─────────────────────────────────────────────────────────────
    user_id: UUID
    available_questions: tuple          # tuple[QuestionSnapshot, ...]

    # ── Exam & session ────────────────────────────────────────────────────────
    current_exam: str = ""
    session_questions: tuple = field(default_factory=tuple)   # UUID ids already used

    # ── Study Runtime ─────────────────────────────────────────────────────────
    fatigue_level: str = "FRESH"                              # FatigueLevel.value
    difficulty_target: DifficultyLevel = DifficultyLevel.MEDIUM
    remaining_time_secs: int = 3_600

    # ── Objective (Study Runtime / Mission Builder) ───────────────────────────
    current_objective: Optional[str] = None                   # ObjectiveType.value
    objective_subject_id: Optional[UUID] = None
    objective_topic_id: Optional[UUID] = None
    objective_article_id: Optional[UUID] = None

    # ── Knowledge Graph Engine / Learning Engine ──────────────────────────────
    knowledge_gaps: tuple = field(default_factory=tuple)      # concept tag strings
    subject_mastery: dict = field(default_factory=dict)       # str(UUID) → 0–1

    # ── Error Intelligence Engine ─────────────────────────────────────────────
    recent_errors: tuple = field(default_factory=tuple)           # question UUIDs
    error_concept_tags: tuple = field(default_factory=tuple)      # concept tags

    # ── Spaced repetition ─────────────────────────────────────────────────────
    review_backlog: tuple = field(default_factory=tuple)          # question UUIDs

    # ── Approval Engine ───────────────────────────────────────────────────────
    approval_probability: float = 0.50

    # ── Recent exposure (last 24 h, not just session) ─────────────────────────
    recent_questions: tuple = field(default_factory=tuple)        # question UUIDs
    recent_article_ids: tuple = field(default_factory=tuple)      # article UUIDs (may repeat)

    # ── Selection mode ────────────────────────────────────────────────────────
    mode: SelectionMode = SelectionMode.NORMAL

    # ── Reinforcement context (from Error Intelligence) ───────────────────────
    reinforcement_concept_tags: tuple = field(default_factory=tuple)
    reinforcement_article_id: Optional[UUID] = None
