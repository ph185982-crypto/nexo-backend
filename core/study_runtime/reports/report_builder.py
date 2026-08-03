"""
ReportBuilder — assembles StudySessionReport from a completed StudySession.

Called once when a session ends (completed, interrupted, or failed).
Pure domain logic — no I/O.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from ..interfaces.context import StudySessionReport
from ..models.enums import FatigueLevel, SessionState, StepType
from ..models.session import StudySession


class ReportBuilder:
    """Assembles the final StudySessionReport from session data."""

    def build(self, session: StudySession) -> StudySessionReport:
        now = datetime.now(timezone.utc)
        completed_at = session.completed_at or now
        started_at = session.started_at

        actual_duration_mins = session.active_duration_mins

        # Step metrics
        q_steps = [r for r in session.step_history if r.accuracy is not None]
        total_questions = len(q_steps)
        overall_accuracy = (
            sum(r.accuracy for r in q_steps) / len(q_steps) if q_steps else 0.0
        )

        conf_steps = [r for r in session.step_history if r.confidence is not None]
        overall_confidence = (
            sum(r.confidence for r in conf_steps) / len(conf_steps) if conf_steps else 0.0
        )

        # Gains
        mastery_gain   = sum(max(r.mastery_delta, 0) for r in session.step_history)
        retention_gain = sum(max(r.retention_delta, 0) for r in session.step_history)
        knowledge_gain = sum(r.knowledge_gain for r in session.step_history)
        confidence_gain = max(overall_confidence - 3.0, 0.0) / 2.0  # delta from neutral (3)

        # Objectives details
        objectives_details = []
        for obj in session.objectives:
            prog = session.get_objective_progress(obj.objective_id)
            objectives_details.append({
                "id": str(obj.objective_id),
                "description": obj.description,
                "type": obj.objective_type.value,
                "target": obj.target_value,
                "final_value": round(prog.current_value, 4) if prog else 0.0,
                "achieved": prog.is_achieved if prog else False,
                "achieved_at": prog.achieved_at.isoformat() if (prog and prog.achieved_at) else None,
            })

        # Time distribution
        time_dist: dict[str, float] = defaultdict(float)
        for record in session.step_history:
            time_dist[record.step_type.value] += record.duration_secs / 60.0

        # Efficiency = (knowledge_gain + mastery_gain) / max(actual_duration_mins, 1)
        # normalized to 0-1
        raw_efficiency = (knowledge_gain + mastery_gain) / max(actual_duration_mins, 1.0)
        efficiency = min(raw_efficiency / 0.10, 1.0)  # 0.10 per min is "perfect"

        # Fatigue curve (fatigue contribution accumulation at each step)
        fatigue_curve: list[float] = []
        cumulative = 0.0
        for record in session.step_history:
            cumulative = min(max(cumulative + record.fatigue_contribution, 0.0), 1.0)
            fatigue_curve.append(round(cumulative, 3))

        final_fatigue = session.fatigue_level

        # Next session recommendation
        recommendation = self._next_recommendation(session, overall_accuracy, final_fatigue)

        return StudySessionReport(
            session_id=session.session_id,
            user_id=session.user_id,
            started_at=started_at,
            completed_at=completed_at,
            planned_duration_mins=session.planned_duration_mins,
            actual_duration_mins=round(actual_duration_mins, 2),
            objectives_achieved=session.objectives_achieved,
            objectives_total=len(session.objectives),
            objectives_completion_pct=round(
                session.objectives_achieved / max(len(session.objectives), 1) * 100, 1
            ),
            objectives_details=objectives_details,
            total_steps=session.total_steps,
            total_questions_answered=total_questions,
            overall_accuracy=round(overall_accuracy, 4),
            overall_confidence=round(overall_confidence, 4),
            knowledge_gain=round(knowledge_gain, 4),
            mastery_gain=round(mastery_gain, 4),
            retention_gain=round(retention_gain, 4),
            confidence_gain=round(confidence_gain, 4),
            total_mistakes=session.total_mistakes,
            total_adaptations=len(session.adaptation_history),
            time_distribution=dict(time_dist),
            efficiency=round(efficiency, 4),
            fatigue_curve=fatigue_curve,
            final_fatigue_level=final_fatigue,
            next_session_recommendation=recommendation,
            terminal_state=session.state,
        )

    def _next_recommendation(
        self,
        session: StudySession,
        accuracy: float,
        fatigue: FatigueLevel,
    ) -> str:
        parts: list[str] = []

        if session.state == SessionState.INTERRUPTED:
            parts.append("Sessão interrompida — retome de onde parou na próxima sessão.")

        if session.all_objectives_achieved:
            parts.append("Todos os objetivos foram alcançados — avance para novos conteúdos.")
        else:
            incomplete = len(session.objectives) - session.objectives_achieved
            parts.append(f"{incomplete} objetivo(s) não concluído(s) — continue na próxima sessão.")

        if accuracy < 0.60:
            parts.append("Acurácia abaixo de 60% — reforce os artigos de base antes de avançar.")
        elif accuracy >= 0.85:
            parts.append("Excelente acurácia — considere questões mais difíceis na próxima sessão.")

        if fatigue in (FatigueLevel.HIGH, FatigueLevel.EXHAUSTED):
            parts.append("Nível de fadiga elevado — descanse pelo menos 30 minutos antes de continuar.")

        if len(session.adaptation_history) >= 3:
            triggers = [a.trigger.value for a in session.adaptation_history]
            most_common = max(set(triggers), key=triggers.count)
            parts.append(f"Padrão frequente de adaptação: {most_common} — atenção especial na próxima sessão.")

        return " ".join(parts) if parts else "Bom trabalho — continue no mesmo ritmo."
