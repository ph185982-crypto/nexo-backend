from __future__ import annotations

from ..interfaces.enums import StepType, DecisionReason
from ..models.context import MissionContext
from .base import BaseStrategy, StepRecommendation

# Non-negotiable: overdue SM-2 cards always fire first
_BASE_SCORE = 1000.0
_PER_OVERDUE_DAY = 10.0
_STEP_MINUTES = 10


class SpacedReviewStrategy(BaseStrategy):
    def is_applicable(self, context: MissionContext) -> bool:
        return bool(context.overdue_cards)

    def recommend(self, context: MissionContext) -> list[StepRecommendation]:
        # Group by subject so we produce one step per subject, not per card
        by_subject: dict = {}
        for card in context.overdue_cards:
            sid = card.subject_id
            if sid not in by_subject:
                by_subject[sid] = {"cards": [], "max_overdue": 0}
            by_subject[sid]["cards"].append(card)
            by_subject[sid]["max_overdue"] = max(
                by_subject[sid]["max_overdue"], card.overdue_days
            )

        recs = []
        for subject_id, data in by_subject.items():
            score = _BASE_SCORE + data["max_overdue"] * _PER_OVERDUE_DAY
            n = len(data["cards"])
            minutes = max(_STEP_MINUTES, min(n * 2, 20))
            recs.append(
                StepRecommendation(
                    step_type=StepType.REVIEW,
                    reason=DecisionReason.SPACED_REVIEW,
                    priority_score=score,
                    estimated_minutes=minutes,
                    subject_id=subject_id,
                    topic_id=None,
                    justification=f"{n} card(s) overdue (max {data['max_overdue']}d late)",
                    payload={"card_ids": [str(c.card_id) for c in data["cards"]]},
                )
            )

        recs.sort(key=lambda r: r.priority_score, reverse=True)
        return recs
