"""Analytics, dashboard, and approval estimate models."""
from __future__ import annotations
from datetime import date, datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field


class DailyStats(BaseModel):
    date: date
    study_minutes: float = 0
    questions_total: int = 0
    questions_correct: int = 0
    accuracy: float = 0
    reviews_done: int = 0
    reviews_due: int = 0
    mission_completed: bool = False
    commute_minutes: float = 0
    xp_earned: int = 0


class WeeklyStats(BaseModel):
    week_start: date
    study_hours: float = 0
    questions_total: int = 0
    accuracy: float = 0
    missions_completed: int = 0
    missions_total: int = 0
    streak_days: int = 0
    retention_score: float = 0
    approval_estimate: float = 0
    improvement_delta: float = 0


class SubjectProgress(BaseModel):
    subject_id: UUID
    subject_name: str
    accuracy: float = 0
    mastery_level: float = 0
    total_attempts: int = 0
    total_correct: int = 0
    study_time_mins: float = 0
    error_count: int = 0
    weight_prf: float = 1.0
    last_studied: Optional[datetime] = None
    impact_score: float = 0     # how much studying this subject would impact approval


class ApprovalEstimate(BaseModel):
    probability: float          # 0.0 to 1.0
    trend: str                  # 'improving', 'stable', 'declining'
    factors: list[SubjectFactor] = Field(default_factory=list)
    days_until_exam: Optional[int] = None
    study_hours_needed: Optional[float] = None
    highest_impact_subject: Optional[str] = None


class SubjectFactor(BaseModel):
    subject_name: str
    weight: float
    mastery: float
    contribution: float
    gap: float
    hours_to_improve: float


class SubjectRisk(BaseModel):
    """Matéria e quantos pontos da prova ela ameaça hoje."""
    subject_name: str
    points_at_risk: float


class DashboardResponse(BaseModel):
    greeting: str
    mission_status: str             # 'pending', 'in_progress', 'completed'
    mission_progress_pct: float = 0
    time_studied_today: float = 0   # minutes
    questions_today: int = 0
    accuracy_today: float = 0
    streak: int = 0
    reviews_due: int = 0
    weakest_subject: Optional[str] = None
    most_important_subject: Optional[str] = None
    weekly_progress: list[DailyStats] = Field(default_factory=list)
    approval_estimate: float = 0    # 0-100%
    weekly_goal_pct: float = 0
    level: int = 1
    xp_progress_pct: float = 0
    next_review_in: Optional[str] = None
    target_exam: str = "PMGO"
    # Pontos que a prova custaria hoje e onde eles estão. O serviço já
    # calculava isso a cada carregamento do dashboard, mas os campos não
    # existiam aqui e o FastAPI descartava tudo na serialização.
    expected_lost_points: float = 0
    exam_total_items: int = 50
    top_risks: list[SubjectRisk] = Field(default_factory=list)


class CommuteStats(BaseModel):
    total_commute_hours: float = 0
    lessons_completed: int = 0
    quiz_accuracy: float = 0
    topics_covered: int = 0


# Fix forward reference
ApprovalEstimate.model_rebuild()
