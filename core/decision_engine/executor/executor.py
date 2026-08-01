from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from ..interfaces.outputs import MissionPlan, MissionStep
from ..interfaces.execution import MissionExecution, StepExecution
from ..interfaces.enums import StepType


class MissionExecutor:
    """
    Tracks in-progress execution of a MissionPlan.
    Stateless: all state lives in MissionExecution, which callers persist.
    Does not talk to the database.
    """

    def start(self, mission_id: UUID, user_id: UUID, plan: MissionPlan) -> MissionExecution:
        return MissionExecution(
            mission_id=mission_id,
            user_id=user_id,
            started_at=datetime.now(timezone.utc),
            finished_at=None,
            step_executions=[],
        )

    def start_step(self, execution: MissionExecution, step_id: str) -> StepExecution:
        plan_step = self._find_step_type(execution, step_id)
        step_exec = StepExecution(
            step_id=step_id,
            step_type=plan_step,
            started_at=datetime.now(timezone.utc),
            finished_at=None,
            items_completed=0,
            items_correct=0,
        )
        execution.step_executions.append(step_exec)
        return step_exec

    def finish_step(
        self,
        step_exec: StepExecution,
        items_completed: int,
        items_correct: int,
    ) -> StepExecution:
        step_exec.finished_at = datetime.now(timezone.utc)
        step_exec.items_completed = items_completed
        step_exec.items_correct = items_correct
        return step_exec

    def skip_step(self, execution: MissionExecution, step_id: str, step_type: StepType) -> StepExecution:
        step_exec = StepExecution(
            step_id=step_id,
            step_type=step_type,
            started_at=datetime.now(timezone.utc),
            finished_at=datetime.now(timezone.utc),
            items_completed=0,
            items_correct=0,
            skipped=True,
        )
        execution.step_executions.append(step_exec)
        return step_exec

    def finish_mission(self, execution: MissionExecution) -> MissionExecution:
        execution.finished_at = datetime.now(timezone.utc)
        return execution

    @staticmethod
    def _find_step_type(execution: MissionExecution, step_id: str) -> StepType:
        # Callers can pass the step_type directly; this is a safe fallback
        return StepType.QUESTIONS
