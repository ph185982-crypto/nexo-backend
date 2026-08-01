from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from uuid import UUID

from .enums import StepType


@dataclass
class StepExecution:
    step_id: str
    step_type: StepType
    started_at: datetime
    finished_at: Optional[datetime]
    items_completed: int
    items_correct: int
    skipped: bool = False

    @property
    def duration_seconds(self) -> Optional[int]:
        if self.finished_at is None:
            return None
        return int((self.finished_at - self.started_at).total_seconds())


@dataclass
class MissionExecution:
    mission_id: UUID
    user_id: UUID
    started_at: datetime
    finished_at: Optional[datetime]
    step_executions: list[StepExecution] = field(default_factory=list)

    @property
    def is_complete(self) -> bool:
        return self.finished_at is not None

    @property
    def duration_minutes(self) -> int:
        if self.finished_at is None:
            return 0
        return int((self.finished_at - self.started_at).total_seconds() / 60)
