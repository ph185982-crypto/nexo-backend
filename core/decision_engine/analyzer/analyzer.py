from __future__ import annotations
from uuid import UUID

from ..interfaces.execution import MissionExecution
from ..interfaces.outputs import MissionPlan
from ..interfaces.metrics import MissionMetrics, MissionResult, StepMetrics
from ..interfaces.inputs import SubjectMasterySnapshot
from ..interfaces.enums import StepType

_XP_PER_CORRECT = 10
_XP_COMPLETION_BONUS = 50


class MissionAnalyzer:
    """
    Pure computation: derives MissionResult from execution + mastery snapshots.
    No I/O, no side effects. Safe to call in tests without DB.
    """

    def analyze(
        self,
        plan: MissionPlan,
        execution: MissionExecution,
        pre_mastery: list[SubjectMasterySnapshot],
        post_mastery: list[SubjectMasterySnapshot],
    ) -> MissionResult:
        step_metrics = self._build_step_metrics(plan, execution)
        total_items = sum(s.items_completed for s in step_metrics)
        total_correct = sum(s.items_correct for s in step_metrics)
        total_minutes = execution.duration_minutes

        metrics = MissionMetrics(
            total_items=total_items,
            correct_items=total_correct,
            total_minutes=total_minutes,
            steps=step_metrics,
        )

        mastery_delta = self._compute_mastery_delta(pre_mastery, post_mastery)
        approval_gain = self._estimate_approval_gain(mastery_delta, metrics)
        xp = self._compute_xp(metrics, execution.is_complete)
        completed = self._is_completed(plan, execution)
        feedback = self._generate_feedback(metrics, mastery_delta, completed)

        return MissionResult(
            mission_id=execution.mission_id,
            metrics=metrics,
            approval_gain=approval_gain,
            mastery_delta=mastery_delta,
            xp_earned=xp,
            completed=completed,
            feedback_summary=feedback,
        )

    # ------------------------------------------------------------------
    def _build_step_metrics(
        self, plan: MissionPlan, execution: MissionExecution
    ) -> list[StepMetrics]:
        plan_map = {s.step_id: s for s in plan.steps}
        metrics = []
        for se in execution.step_executions:
            plan_step = plan_map.get(se.step_id)
            metrics.append(
                StepMetrics(
                    step_id=se.step_id,
                    step_type=se.step_type,
                    subject_id=plan_step.subject_id if plan_step else None,
                    topic_id=plan_step.topic_id if plan_step else None,
                    planned_minutes=plan_step.estimated_minutes if plan_step else 0,
                    actual_minutes=se.duration_seconds // 60 if se.duration_seconds else 0,
                    items_completed=se.items_completed,
                    items_correct=se.items_correct,
                )
            )
        return metrics

    @staticmethod
    def _compute_mastery_delta(
        pre: list[SubjectMasterySnapshot],
        post: list[SubjectMasterySnapshot],
    ) -> dict[str, float]:
        pre_map = {s.subject_slug: s.mastery_score for s in pre}
        post_map = {s.subject_slug: s.mastery_score for s in post}
        delta: dict[str, float] = {}
        for slug, post_score in post_map.items():
            pre_score = pre_map.get(slug, post_score)
            d = round(post_score - pre_score, 2)
            if d != 0:
                delta[slug] = d
        return delta

    @staticmethod
    def _estimate_approval_gain(
        mastery_delta: dict[str, float],
        metrics: MissionMetrics,
    ) -> float:
        if not mastery_delta:
            return 0.0
        avg_delta = sum(mastery_delta.values()) / len(mastery_delta)
        accuracy_bonus = metrics.overall_accuracy * 0.5
        return round(max(0.0, avg_delta * 0.05 + accuracy_bonus * 0.2), 2)

    @staticmethod
    def _compute_xp(metrics: MissionMetrics, completed: bool) -> int:
        xp = metrics.correct_items * _XP_PER_CORRECT
        if completed:
            xp += _XP_COMPLETION_BONUS
        return xp

    @staticmethod
    def _is_completed(plan: MissionPlan, execution: MissionExecution) -> bool:
        non_break_steps = [s for s in plan.steps if s.step_type != StepType.BREAK]
        executed_ids = {se.step_id for se in execution.step_executions if not se.skipped}
        return all(s.step_id in executed_ids for s in non_break_steps)

    @staticmethod
    def _generate_feedback(
        metrics: MissionMetrics,
        mastery_delta: dict[str, float],
        completed: bool,
    ) -> str:
        accuracy_pct = int(metrics.overall_accuracy * 100)
        improved = [slug for slug, d in mastery_delta.items() if d > 0]

        parts = []
        if completed:
            parts.append("Missao completa!")
        parts.append(f"Acerto: {accuracy_pct}% ({metrics.correct_items}/{metrics.total_items})")
        if improved:
            parts.append(f"Melhora em: {', '.join(improved)}")
        return " — ".join(parts) if parts else "Sessao finalizada."
