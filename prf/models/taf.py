"""TAF (Teste de Aptidão Física) — registro de medições e projeção até a prova."""
from __future__ import annotations
from datetime import date, datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel


class TAFRecordIn(BaseModel):
    measured_at: Optional[date] = None
    barra_reps: Optional[int] = None
    flexao_reps: Optional[int] = None
    abdominal_reps: Optional[int] = None
    corrida_12min_metros: Optional[int] = None
    notes: Optional[str] = None


class TAFRecordOut(BaseModel):
    id: UUID
    measured_at: date
    barra_reps: Optional[int] = None
    flexao_reps: Optional[int] = None
    abdominal_reps: Optional[int] = None
    corrida_12min_metros: Optional[int] = None
    notes: Optional[str] = None
    created_at: datetime


class TAFExerciseProjection(BaseModel):
    exercise: str
    latest_value: Optional[float] = None
    target: Optional[float] = None
    trend_per_week: float = 0.0
    projected_at_exam: Optional[float] = None
    gap_to_target: Optional[float] = None
    on_track: Optional[bool] = None


class TAFTargetsIn(BaseModel):
    barra_reps: Optional[int] = None
    flexao_reps: Optional[int] = None
    abdominal_reps: Optional[int] = None
    corrida_12min_metros: Optional[int] = None
