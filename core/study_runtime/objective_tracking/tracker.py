"""
ObjectiveTracker — monitors and updates session objective progress.

Objectives are more important than time — the session continues until
objectives are met (within the time constraint).

Supported objective types and their update logic:
  MASTER_ARTICLE      — mastery_delta accumulation per step
  REACH_MASTERY       — cumulative mastery_gain vs target
  ELIMINATE_CONFUSION — accuracy improvement (mistake reduction)
  REDUCE_BACKLOG      — review steps completed (count-based)
  INCREASE_RETENTION  — retention_delta accumulation
  IMPROVE_CONFIDENCE  — confidence improvement vs baseline
  COMPLETE_MISSION    — all non-break/non-assessment steps completed
  REDUCE_ERRORS       — cumulative mistakes < target (inverse threshold)
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from ..interfaces.context import StepResult
from ..interfaces.events import ObjectiveReachedEvent, SessionEvent
from ..models.enums import ObjectiveType, StepType
from ..models.session import ObjectiveProgress, SessionObjective, StudySession


class ObjectiveTracker:
    """Pure domain logic for objective progress tracking."""

    def update(
        self,
        session: StudySession,
        result: StepResult,
    ) -> list[SessionEvent]:
        """
        Update all objective progress given the latest step result.
        Returns ObjectiveReachedEvent for any newly achieved objectives.
        """
        events: list[SessionEvent] = []

        for obj in session.objectives:
            prev = session.get_objective_progress(obj.objective_id)
            if prev and prev.is_achieved:
                continue  # already done

            new_value = self._compute_new_value(obj, session, result, prev)
            is_achieved = new_value >= obj.target_value
            achieved_at = datetime.now(timezone.utc) if is_achieved else None

            updated = ObjectiveProgress(
                objective_id=obj.objective_id,
                current_value=new_value,
                is_achieved=is_achieved,
                achieved_at=achieved_at,
            )
            session.update_objective_progress(updated)

            if is_achieved:
                events.append(
                    ObjectiveReachedEvent.create(
                        session_id=session.session_id,
                        objective_id=obj.objective_id,
                        description=obj.description,
                        final_value=new_value,
                        target_value=obj.target_value,
                    )
                )

        return events

    def completion_percentage(self, session: StudySession) -> float:
        """Average progress percentage across all objectives."""
        if not session.objectives:
            return 0.0
        total = 0.0
        for obj in session.objectives:
            progress = session.get_objective_progress(obj.objective_id)
            if progress:
                pct = min(progress.current_value / obj.target_value, 1.0) if obj.target_value > 0 else 1.0
                total += pct
        return total / len(session.objectives)

    def estimated_steps_remaining(self, session: StudySession) -> int:
        """Rough estimate of steps needed to complete remaining objectives."""
        incomplete = [
            obj for obj in session.objectives
            if not (session.get_objective_progress(obj.objective_id) or
                    ObjectiveProgress(obj.objective_id, 0, False, None)).is_achieved
        ]
        if not incomplete:
            return 0
        # Rough heuristic: each incomplete objective needs ~3 more steps
        return len(incomplete) * 3

    # ── Per-objective update logic ───────────────────────────────────────────

    def _compute_new_value(
        self,
        obj: SessionObjective,
        session: StudySession,
        result: StepResult,
        prev: ObjectiveProgress | None,
    ) -> float:
        current = prev.current_value if prev else 0.0

        t = obj.objective_type

        if t == ObjectiveType.MASTER_ARTICLE:
            # Target: cumulative mastery_delta reaches target_value (e.g. 0.20 gain)
            return current + max(result.mastery_delta, 0)

        elif t == ObjectiveType.REACH_MASTERY:
            # Target: session cumulative mastery_gain (same logic)
            return session.cumulative_mastery_gain

        elif t == ObjectiveType.ELIMINATE_CONFUSION:
            # Target: accuracy > target_value (0.80 = "reach 80% accuracy")
            if result.accuracy is not None:
                # Use rolling average of last 5 question steps
                q_steps = [r for r in session.step_history if r.accuracy is not None][-4:]
                q_steps_acc = [r.accuracy for r in q_steps] + [result.accuracy]
                return sum(q_steps_acc) / len(q_steps_acc)
            return current

        elif t == ObjectiveType.REDUCE_BACKLOG:
            # Target: N review steps completed
            if result.step_type == StepType.REVIEW:
                return current + 1.0
            return current

        elif t == ObjectiveType.INCREASE_RETENTION:
            # Target: cumulative retention_delta (record already in history)
            return session.cumulative_retention_gain

        elif t == ObjectiveType.IMPROVE_CONFIDENCE:
            # Target: avg confidence > target_value
            if result.confidence is not None:
                conf_steps = [r for r in session.step_history if r.confidence is not None][-4:]
                conf_vals = [r.confidence for r in conf_steps] + [result.confidence]
                return sum(conf_vals) / len(conf_vals)
            return current

        elif t == ObjectiveType.COMPLETE_MISSION:
            # Target: N steps completed (record already appended to history before this runs)
            productive = [r for r in session.step_history
                          if r.step_type not in (StepType.BREAK,)]
            return float(len(productive))

        elif t == ObjectiveType.REDUCE_ERRORS:
            # Target: total mistakes < target_value (inverse)
            # We flip: progress = target - current_mistakes (capped at 0)
            total_mistakes = session.total_mistakes + result.mistakes
            return max(obj.target_value - total_mistakes, 0.0)

        return current
