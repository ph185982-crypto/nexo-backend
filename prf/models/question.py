"""Question bank and attempt models."""
from __future__ import annotations
from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field


class DifficultyLevel(str, Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"
    EXPERT = "expert"


class QuestionType(str, Enum):
    CERTO_ERRADO = "certo_errado"
    MULTIPLA_ESCOLHA = "multipla_escolha"


class QuestionOut(BaseModel):
    id: UUID
    subject_id: UUID
    topic_id: Optional[UUID] = None
    question_type: QuestionType = QuestionType.CERTO_ERRADO
    context_text: Optional[str] = None
    text: str
    difficulty: DifficultyLevel
    source: Optional[str] = None
    year: Optional[int] = None
    examiner: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    alternatives: list[AlternativeOut] = Field(default_factory=list)


class AlternativeOut(BaseModel):
    id: UUID
    letter: str
    text: str
    display_order: int = 0


class QuestionWithAnswer(QuestionOut):
    correct_alternative_id: UUID
    explanation: Optional[str] = None
    legal_basis: Optional[str] = None


class AnswerSubmission(BaseModel):
    question_id: UUID
    selected_alternative_id: UUID
    time_spent_secs: Optional[int] = None
    confidence: Optional[int] = Field(default=None, ge=1, le=5)


class AnswerResult(BaseModel):
    is_correct: bool
    correct_alternative: AlternativeOut
    selected_alternative: AlternativeOut
    explanation: Optional[str] = None
    legal_basis: Optional[str] = None
    alternative_explanations: dict[str, str] = Field(default_factory=dict)
    review_scheduled: bool = False
    xp_earned: int = 0
    error_recorded: bool = False


class QuestionAttemptOut(BaseModel):
    id: UUID
    question_id: UUID
    is_correct: bool
    time_spent_secs: Optional[int] = None
    created_at: datetime


class QuestionFilter(BaseModel):
    subject_id: Optional[UUID] = None
    topic_id: Optional[UUID] = None
    question_type: Optional[QuestionType] = None
    difficulty: Optional[DifficultyLevel] = None
    examiner: Optional[str] = None
    year_min: Optional[int] = None
    year_max: Optional[int] = None
    exclude_answered: bool = False
    only_errors: bool = False
    limit: int = Field(default=10, ge=1, le=100)


class ErrorNotebookEntry(BaseModel):
    id: UUID
    question_id: UUID
    question_text: str
    subject_name: str
    topic_name: Optional[str] = None
    error_summary: Optional[str] = None
    error_type: Optional[str] = None
    times_repeated: int
    resolved: bool
    created_at: datetime
    last_error_at: datetime


# Fix forward reference
QuestionOut.model_rebuild()
