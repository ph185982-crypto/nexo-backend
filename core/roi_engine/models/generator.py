from __future__ import annotations
import uuid
from collections import defaultdict
from typing import Optional
from uuid import UUID

from ..interfaces.context import GapInfo, MasteryInfo, ROIContext
from ..interfaces.opportunity import OpportunityType, StudyOpportunity

# Estimated minutes per opportunity type
_MINUTES = {
    OpportunityType.STUDY_ARTICLE: 10,
    OpportunityType.SOLVE_QUESTIONS: 15,
    OpportunityType.REVIEW_QUESTIONS: 10,
    OpportunityType.FLASHCARDS: 8,
    OpportunityType.AUDIO_REVIEW: 15,
    OpportunityType.SIMULATION: 30,
    OpportunityType.WEAK_TOPIC_REVIEW: 15,
    OpportunityType.LAW_READING: 10,
}

# Expected gain per type (baseline, scaled by gap/retention at score time)
_BASE_GAIN = {
    OpportunityType.STUDY_ARTICLE: 0.30,
    OpportunityType.SOLVE_QUESTIONS: 0.50,
    OpportunityType.REVIEW_QUESTIONS: 0.35,
    OpportunityType.FLASHCARDS: 0.20,
    OpportunityType.AUDIO_REVIEW: 0.15,
    OpportunityType.SIMULATION: 0.25,
    OpportunityType.WEAK_TOPIC_REVIEW: 0.55,
    OpportunityType.LAW_READING: 0.30,
}


class OpportunityGenerator:
    """
    Generates all candidate StudyOpportunity objects from an ROIContext.
    Does NOT score them — scoring is the engine's job.
    Deduplicates by (type, subject_id, topic_id) so strategies receive clean candidates.
    """

    def generate(self, context: ROIContext) -> list[StudyOpportunity]:
        seen: set[tuple] = set()
        opportunities: list[StudyOpportunity] = []

        def add(op: StudyOpportunity) -> None:
            key = (op.opportunity_type, op.subject_id, op.topic_id)
            if key not in seen:
                seen.add(key)
                opportunities.append(op)

        # ── From KGE gaps (highest-signal source) ─────────────────────
        for gap in context.gaps:
            op_type = _step_to_type(gap.recommended_step)
            add(self._from_gap(gap, op_type, context))

            # Always also generate a complementary practice opportunity
            if op_type != OpportunityType.SOLVE_QUESTIONS:
                add(self._from_gap(gap, OpportunityType.SOLVE_QUESTIONS, context))

        # ── From overdue review queue ──────────────────────────────────
        overdue_by_subject: dict[UUID, int] = defaultdict(int)
        for r in context.overdue_reviews:
            overdue_by_subject[r.subject_id] += 1

        for subject_id, count in overdue_by_subject.items():
            mastery = self._mastery_for(context, subject_id)
            label = f"Revisão atrasada — {mastery.subject_name if mastery else subject_id}"
            add(self._make(
                op_type=OpportunityType.REVIEW_QUESTIONS,
                subject_id=subject_id,
                topic_id=None,
                label=label,
                expected_gain=min(count * 0.06, 0.40),
                context=context,
                metadata={"overdue_count": count, "source": "review_queue"},
            ))

        # ── From recent errors (clustered by subject) ──────────────────
        error_by_subject: dict[UUID, int] = defaultdict(int)
        for e in context.recent_errors:
            error_by_subject[e.subject_id] += e.times_wrong

        for subject_id, error_count in error_by_subject.items():
            mastery = self._mastery_for(context, subject_id)
            name = mastery.subject_name if mastery else str(subject_id)
            add(self._make(
                op_type=OpportunityType.REVIEW_QUESTIONS,
                subject_id=subject_id,
                topic_id=None,
                label=f"Rever erros — {name}",
                expected_gain=min(error_count * 0.07, 0.45),
                context=context,
                metadata={"error_count": error_count, "source": "error_notebook"},
            ))
            add(self._make(
                op_type=OpportunityType.FLASHCARDS,
                subject_id=subject_id,
                topic_id=None,
                label=f"Flashcards de reforço — {name}",
                expected_gain=min(error_count * 0.04, 0.25),
                context=context,
                metadata={"error_count": error_count, "source": "error_notebook"},
            ))

        # ── Weak topics (mastery < 40%, high weight) ──────────────────
        for m in context.mastery:
            if m.mastery_score < 40.0 and m.exam_weight > 1.0:
                add(self._make(
                    op_type=OpportunityType.WEAK_TOPIC_REVIEW,
                    subject_id=m.subject_id,
                    topic_id=None,
                    label=f"Revisão fraca — {m.subject_name}",
                    expected_gain=(1.0 - m.mastery_score / 100) * 0.55,
                    context=context,
                    metadata={"mastery_score": m.mastery_score, "source": "mastery"},
                ))

        # ── Low coverage → law reading ─────────────────────────────────
        for m in context.mastery:
            if m.coverage_ratio < 0.30 and m.exam_weight > 0.5:
                add(self._make(
                    op_type=OpportunityType.LAW_READING,
                    subject_id=m.subject_id,
                    topic_id=None,
                    label=f"Leitura legal — {m.subject_name}",
                    expected_gain=(1.0 - m.coverage_ratio) * 0.28,
                    context=context,
                    metadata={"coverage_ratio": m.coverage_ratio, "source": "coverage"},
                ))

        # ── Simulation if exam approaching ─────────────────────────────
        if context.exam_approaching and context.avg_mastery >= 50.0:
            add(self._make(
                op_type=OpportunityType.SIMULATION,
                subject_id=None,
                topic_id=None,
                label=f"Simulado — {context.target_exam}",
                expected_gain=context.exam_pressure * 0.30,
                context=context,
                metadata={
                    "days_until_exam": context.days_until_exam,
                    "avg_mastery": context.avg_mastery,
                    "source": "exam_pressure",
                },
            ))

        # ── Audio review for commute hours ─────────────────────────────
        if context.is_commute_hour:
            for m in sorted(context.mastery, key=lambda x: x.exam_weight, reverse=True)[:2]:
                add(self._make(
                    op_type=OpportunityType.AUDIO_REVIEW,
                    subject_id=m.subject_id,
                    topic_id=None,
                    label=f"Áudio — {m.subject_name}",
                    expected_gain=(1.0 - m.mastery_score / 100) * 0.15,
                    context=context,
                    metadata={"source": "commute"},
                ))

        return opportunities

    # ── Private helpers ───────────────────────────────────────────────

    def _from_gap(
        self, gap: GapInfo, op_type: OpportunityType, context: ROIContext
    ) -> StudyOpportunity:
        gain = gap.impact_score * _BASE_GAIN[op_type]
        return self._make(
            op_type=op_type,
            subject_id=gap.subject_id,
            topic_id=gap.topic_id,
            label=f"{op_type.value.replace('_', ' ').title()} — {gap.label}",
            expected_gain=round(gain, 4),
            context=context,
            metadata={
                "node_id": gap.node_id,
                "gap_score": gap.gap_score,
                "importance": gap.importance,
                "impact_score": gap.impact_score,
                "source": "knowledge_gap",
            },
        )

    @staticmethod
    def _make(
        op_type: OpportunityType,
        subject_id: Optional[UUID],
        topic_id: Optional[UUID],
        label: str,
        expected_gain: float,
        context: ROIContext,
        metadata: dict,
    ) -> StudyOpportunity:
        minutes = _MINUTES[op_type]
        # Cap at available_minutes when caller requests a short session
        if context.available_minutes < minutes:
            minutes = max(context.available_minutes, 5)

        node_ids: list[str] = []
        if subject_id:
            node_ids.append(f"subject:{subject_id}")
        if topic_id:
            node_ids.append(f"topic:{topic_id}")

        op_id = f"{op_type.value}_{subject_id or 'global'}_{topic_id or 'all'}"
        return StudyOpportunity(
            id=op_id,
            opportunity_type=op_type,
            estimated_minutes=minutes,
            knowledge_node_ids=node_ids,
            subject_id=subject_id,
            topic_id=topic_id,
            label=label,
            expected_gain=max(0.0, min(expected_gain, 1.0)),
            metadata=metadata,
        )

    @staticmethod
    def _mastery_for(context: ROIContext, subject_id: UUID) -> Optional[MasteryInfo]:
        for m in context.mastery:
            if m.subject_id == subject_id:
                return m
        return None


def _step_to_type(recommended_step: str) -> OpportunityType:
    return {
        "questions": OpportunityType.SOLVE_QUESTIONS,
        "review": OpportunityType.REVIEW_QUESTIONS,
        "flashcards": OpportunityType.FLASHCARDS,
        "law": OpportunityType.LAW_READING,
    }.get(recommended_step, OpportunityType.SOLVE_QUESTIONS)
