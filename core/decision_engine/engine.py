from __future__ import annotations
import uuid
from typing import Optional

from .interfaces.inputs import DecisionInput
from .interfaces.outputs import MissionPlan, MissionStep
from .interfaces.enums import MissionPriority, DecisionReason, StepType
from .models.context import ContextBuilder, MissionContext
from .strategies.base import BaseStrategy, StepRecommendation
from .strategies.spaced_review import SpacedReviewStrategy
from .strategies.recent_errors import RecentErrorsStrategy
from .strategies.weak_subject import WeakSubjectStrategy
from .strategies.retention_drop import RetentionDropStrategy
from .strategies.low_coverage import LowCoverageStrategy
from .strategies.simulation_ready import SimulationReadyStrategy
from .strategies.short_time import ShortTimeStrategy
from .strategies.knowledge_gap import KnowledgeGapStrategy

_BREAK_THRESHOLD_MINUTES = 45
_BREAK_MINUTES = 5
_DEFAULT_STRATEGIES: list[BaseStrategy] = [
    SpacedReviewStrategy(),        # 1000+ — SM-2 overdue (non-negotiable)
    RecentErrorsStrategy(),        # 900+  — retry recent wrong answers
    KnowledgeGapStrategy(),        # 800+  — KGE-ranked gaps (topic-level precision)
    WeakSubjectStrategy(),         # 700-900 — low mastery × high weight
    RetentionDropStrategy(),       # 700+  — correct_rate drop
    LowCoverageStrategy(),         # 600+  — untouched topics
    SimulationReadyStrategy(),     # 300+  — exam approaching
    ShortTimeStrategy(),           # 500   — < 15 min available
]


class DecisionEngine:
    """
    Single entry point for all study decisions.
    Accepts a DecisionInput, runs strategies, returns a MissionPlan.
    Does not talk to the database directly — callers supply all data.
    """

    def __init__(self, strategies: Optional[list[BaseStrategy]] = None) -> None:
        self._strategies = strategies if strategies is not None else _DEFAULT_STRATEGIES
        self._context_builder = ContextBuilder()

    def decide(self, inp: DecisionInput) -> MissionPlan:
        ctx = self._context_builder.build(inp)
        recommendations = self._collect_recommendations(ctx)
        steps, trace = self._build_steps(recommendations, ctx)
        priority = self._determine_priority(ctx)
        approval_gain = self._estimate_approval_gain(steps, ctx)

        return MissionPlan(
            steps=steps,
            priority=priority,
            estimated_duration_minutes=sum(s.estimated_minutes for s in steps),
            expected_approval_gain=approval_gain,
            decision_trace=trace,
        )

    # ------------------------------------------------------------------
    def _collect_recommendations(self, ctx: MissionContext) -> list[StepRecommendation]:
        all_recs: list[StepRecommendation] = []
        for strategy in self._strategies:
            if strategy.is_applicable(ctx):
                recs = strategy.recommend(ctx)
                all_recs.extend(recs)
        all_recs.sort(key=lambda r: r.priority_score, reverse=True)
        return all_recs

    def _build_steps(
        self, recs: list[StepRecommendation], ctx: MissionContext
    ) -> tuple[list[MissionStep], list[str]]:
        budget = ctx.input.available_minutes
        steps: list[MissionStep] = []
        trace: list[str] = []
        seen_subjects: set = set()
        time_used = 0

        for rec in recs:
            if time_used + rec.estimated_minutes > budget:
                trace.append(
                    f"Skipped {rec.step_type}/{rec.reason} — no time "
                    f"({rec.estimated_minutes}m needed, {budget - time_used}m left)"
                )
                continue

            # Deduplicate: only one step per (subject, step_type) pair
            key = (rec.subject_id, rec.step_type)
            if key in seen_subjects:
                continue
            seen_subjects.add(key)

            step_id = f"step_{len(steps) + 1}_{uuid.uuid4().hex[:6]}"
            steps.append(
                MissionStep(
                    step_id=step_id,
                    step_type=rec.step_type,
                    estimated_minutes=rec.estimated_minutes,
                    reason=rec.reason,
                    subject_id=rec.subject_id,
                    topic_id=rec.topic_id,
                    priority_score=rec.priority_score,
                    justification=rec.justification,
                    payload=rec.payload,
                )
            )
            time_used += rec.estimated_minutes
            trace.append(
                f"+{rec.step_type} ({rec.estimated_minutes}m) — {rec.justification}"
            )

            # Insert break after 45 minutes of content
            if time_used >= _BREAK_THRESHOLD_MINUTES and time_used + _BREAK_MINUTES <= budget:
                if not steps or steps[-1].step_type != StepType.BREAK:
                    steps.append(self._make_break(len(steps) + 1))
                    time_used += _BREAK_MINUTES
                    trace.append(f"+BREAK ({_BREAK_MINUTES}m) — session length management")

        if not steps:
            trace.append("No recommendations matched — returning empty plan")

        return steps, trace

    def _determine_priority(self, ctx: MissionContext) -> MissionPriority:
        if ctx.critical_subjects or (
            ctx.input.days_until_exam is not None and ctx.input.days_until_exam <= 7
        ):
            return MissionPriority.CRITICAL
        if ctx.overdue_cards or ctx.weak_subjects:
            return MissionPriority.HIGH
        if ctx.low_coverage_subjects:
            return MissionPriority.NORMAL
        return MissionPriority.LOW

    def _estimate_approval_gain(
        self, steps: list[MissionStep], ctx: MissionContext
    ) -> float:
        # Heuristic: each step on a critical/weak subject contributes proportionally
        gain = 0.0
        for step in steps:
            if step.step_type == StepType.BREAK:
                continue
            if step.reason in (DecisionReason.WEAK_SUBJECT, DecisionReason.LOW_RETENTION):
                gain += 0.3
            elif step.reason == DecisionReason.SPACED_REVIEW:
                gain += 0.2
            elif step.reason == DecisionReason.RECENT_ERRORS:
                gain += 0.25
            else:
                gain += 0.1
        return round(min(gain, 5.0), 2)   # cap at +5% per session

    @staticmethod
    def _make_break(index: int) -> MissionStep:
        return MissionStep(
            step_id=f"step_{index}_break",
            step_type=StepType.BREAK,
            estimated_minutes=_BREAK_MINUTES,
            reason=DecisionReason.OPTIMAL_ENERGY,
            subject_id=None,
            topic_id=None,
            priority_score=0.0,
            justification="Scheduled break for sustained focus",
        )
