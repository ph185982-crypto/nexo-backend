"""
Core Study Orchestration Service — coordinates engines, repository, and user context
to deliver the optimal study experience.
"""
from __future__ import annotations
from datetime import date, datetime
from typing import Optional
from uuid import UUID
import json

from prf.database.repository import PRFRepository
from prf.engines.priority import (
    SubjectState, PriorityContext, compute_priorities,
)
from prf.engines.mission import build_mission, Mission
from prf.engines.spaced_review import (
    ReviewState, Quality, QUALITY_MAP,
    compute_review, xp_for_review,
)
from prf.engines.adaptive import (
    PerformanceWindow, Difficulty, adapt_difficulty, compute_questions_for_block,
)
from prf.engines.behavior import (
    SessionRecord, analyze_behavior, detect_study_mode, suggest_energy_level,
)
from prf.engines.approval import (
    SubjectMastery as ApprovalSubject, estimate_approval,
)
from prf.models.user import EnergyLevel, StudyMode


class StudyService:
    def __init__(self, repo: PRFRepository):
        self.repo = repo

    # ── Mission Generation ────────────────────────────────────────────────────

    async def generate_daily_mission(
        self, user_id: UUID, energy: EnergyLevel | None = None, mode: StudyMode | None = None,
    ) -> dict:
        """Generate or retrieve today's mission."""
        existing = await self.repo.get_todays_mission(user_id)
        if existing and existing["status"] not in ("pending",):
            return existing

        profile = await self.repo.get_profile(user_id)
        routine = await self.repo.get_routine_for_day(user_id, date.today().weekday())
        behavior = await self.repo.get_behavior_metrics(user_id)

        available_mins = routine["study_minutes"] if routine else 60
        if not energy and routine:
            energy = EnergyLevel(routine["typical_energy"])
        energy = energy or EnergyLevel.MEDIUM

        if not mode:
            hour = datetime.now().hour
            is_commuting = _is_commute_time(routine, hour) if routine else False
            mode_str = detect_study_mode(
                hour, is_commuting, energy.value, available_mins
            )
            mode = StudyMode(mode_str)

        subjects = await self.repo.get_subjects()
        mastery_list = await self.repo.get_subject_mastery(user_id)
        mastery_map = {m["subject_id"]: m for m in mastery_list}

        subject_states = []
        for s in subjects:
            m = mastery_map.get(s["id"], {})
            recurring = await self.repo.get_recurring_error_count(user_id, s["id"])
            reviews_due = 0  # will be counted below per-subject
            subject_states.append(SubjectState(
                subject_id=s["id"],
                subject_name=s["name"],
                weight_prf=s.get("weight_prf", 1.0),
                mastery=m.get("mastery_level", 0),
                accuracy=m.get("accuracy", 0),
                total_attempts=m.get("total_attempts", 0),
                error_count=m.get("error_count", 0),
                reviews_due=reviews_due,
                last_studied=m.get("last_studied"),
                study_time_mins=m.get("study_time_mins", 0),
                recurring_errors=recurring,
            ))

        days_until_exam = None
        if profile and profile.get("exam_date"):
            days_until_exam = (profile["exam_date"] - date.today()).days

        ctx = PriorityContext(
            energy=energy,
            mode=mode,
            available_minutes=available_mins,
            hour_of_day=datetime.now().hour,
            days_until_exam=days_until_exam,
            today=date.today(),
        )

        priorities = compute_priorities(subject_states, ctx)

        reviews_due_count = await self.repo.count_due_reviews(user_id)
        review_card_ids = await self.repo.get_due_review_card_ids(user_id)
        error_flashcard_ids = await self.repo.get_error_flashcard_ids(user_id)
        commute_lesson_ids = await self.repo.get_commute_lesson_ids()

        question_pool = {}
        legal_pool = {}
        for p in priorities[:5]:
            q_ids = await self.repo.get_question_ids_by_subject(p.subject_id)
            if q_ids:
                question_pool[p.subject_id] = q_ids
            a_ids = await self.repo.get_legal_article_ids_by_subject(p.subject_id)
            if a_ids:
                legal_pool[p.subject_id] = a_ids

        mission = build_mission(
            priorities=priorities,
            context=ctx,
            reviews_due=reviews_due_count,
            review_card_ids=review_card_ids,
            error_flashcard_ids=error_flashcard_ids,
            commute_lesson_ids=commute_lesson_ids,
            question_pool=question_pool,
            legal_article_ids=legal_pool,
        )

        db_mission = await self.repo.create_mission(user_id, {
            "estimated_mins": mission.estimated_mins,
            "mode_suggested": mission.mode_suggested,
            "energy_detected": mission.energy_detected,
            "greeting": mission.greeting,
            "blocks_total": len([b for b in mission.blocks if not b.is_optional]),
        })

        for block in mission.blocks:
            await self.repo.create_mission_block(db_mission["id"], {
                "block_type": block.block_type,
                "subject_id": block.subject_id,
                "topic_id": block.topic_id,
                "title": block.title,
                "description": block.description,
                "estimated_mins": block.estimated_mins,
                "display_order": block.display_order,
                "content_ids": [str(cid) for cid in block.content_ids],
                "is_optional": block.is_optional,
                "mode": block.mode,
            })

        return await self.repo.get_todays_mission(user_id)

    # ── Answer Processing ─────────────────────────────────────────────────────

    async def process_answer(
        self, user_id: UUID, question_id: UUID, selected_alt_id: UUID,
        session_id: UUID | None = None, time_spent: int | None = None,
        confidence: int | None = None,
    ) -> dict:
        """Process a question answer: record attempt, update mastery, handle errors."""
        question = await self.repo.get_question_with_alternatives(question_id)
        if not question:
            raise ValueError("Question not found")

        correct_alt = next(
            (a for a in question["alternatives"] if a["is_correct"]),
            None,
        )
        is_correct = correct_alt and str(correct_alt["id"]) == str(selected_alt_id)

        attempt = await self.repo.record_attempt(user_id, {
            "question_id": question_id,
            "session_id": session_id,
            "selected_alt_id": selected_alt_id,
            "is_correct": is_correct,
            "time_spent_secs": time_spent,
            "confidence": confidence,
        })

        xp = 10 if is_correct else 3
        await self.repo.add_xp(user_id, xp, "question_correct" if is_correct else "question_attempt")

        error_recorded = False
        if not is_correct:
            await self.repo.record_error(user_id, {
                "question_id": question_id,
                "attempt_id": attempt["id"],
                "subject_id": question.get("subject_id"),
                "topic_id": question.get("topic_id"),
            })
            error_recorded = True
            await self.repo.create_review_card_for_question(user_id, question_id)

        review_scheduled = not is_correct

        await self._update_mastery_for_question(user_id, question)

        selected_alt = next(
            (a for a in question["alternatives"] if str(a["id"]) == str(selected_alt_id)),
            None,
        )
        alt_explanations = {
            a["letter"]: a.get("explanation", "")
            for a in question["alternatives"]
            if a.get("explanation")
        }

        return {
            "is_correct": is_correct,
            "correct_alternative": correct_alt,
            "selected_alternative": selected_alt,
            "explanation": question.get("explanation"),
            "legal_basis": question.get("legal_basis"),
            "alternative_explanations": alt_explanations,
            "review_scheduled": review_scheduled,
            "xp_earned": xp,
            "error_recorded": error_recorded,
        }

    # ── Review Processing ─────────────────────────────────────────────────────

    async def process_review(
        self, user_id: UUID, card_id: UUID, quality_str: str
    ) -> dict:
        """Process a spaced repetition review."""
        card = await self.repo.get_review_card(card_id)
        if not card:
            raise ValueError("Review card not found")

        quality = QUALITY_MAP[quality_str]

        state = ReviewState(
            ease_factor=card["ease_factor"],
            interval_days=card["interval_days"],
            repetitions=card["repetitions"],
            streak=card["streak"],
            lapsed=card["lapsed"],
        )

        update = compute_review(state, quality)
        xp = xp_for_review(quality)

        await self.repo.update_review_card(card_id, {
            "ease_factor": update.ease_factor,
            "interval_days": update.interval_days,
            "repetitions": update.repetitions,
            "next_review": update.next_review,
            "last_quality": quality_str,
            "is_correct": quality >= Quality.GOOD,
            "streak": update.streak,
            "lapsed": update.lapsed,
        })

        await self.repo.add_xp(user_id, xp, "review")

        return {
            "card_id": card_id,
            "new_interval_days": update.interval_days,
            "new_ease_factor": update.ease_factor,
            "next_review": update.next_review.isoformat(),
            "xp_earned": xp,
        }

    # ── Dashboard ─────────────────────────────────────────────────────────────

    async def get_dashboard(self, user_id: UUID) -> dict:
        """Build the dashboard response."""
        today_analytics = await self.repo.get_today_analytics(user_id)
        mission = await self.repo.get_todays_mission(user_id)
        streak = await self.repo.get_streak(user_id)
        xp = await self.repo.get_xp(user_id)
        reviews_due = await self.repo.count_due_reviews(user_id)
        mastery = await self.repo.get_subject_mastery(user_id)
        profile = await self.repo.get_profile(user_id)
        weekly = await self.repo.get_daily_analytics(user_id, days=7)
        estimate = await self.repo.get_latest_approval_estimate(user_id)

        weakest = min(mastery, key=lambda m: m["mastery_level"]) if mastery else None
        strongest = max(mastery, key=lambda m: m["mastery_level"]) if mastery else None

        mission_status = "pending"
        mission_pct = 0
        if mission:
            mission_status = mission["status"]
            total = mission["blocks_total"] or 1
            mission_pct = (mission["blocks_done"] / total) * 100

        time_today = today_analytics["study_minutes"] if today_analytics else 0
        q_today = today_analytics["questions_total"] if today_analytics else 0
        correct_today = today_analytics["questions_correct"] if today_analytics else 0
        acc_today = (correct_today / q_today * 100) if q_today else 0

        weekly_mins = sum(d.get("study_minutes", 0) for d in weekly)
        goal_hours = profile["weekly_goal_hours"] if profile else 10
        weekly_goal_pct = min(100, (weekly_mins / 60) / goal_hours * 100)

        hour = datetime.now().hour
        if hour < 12:
            greeting = "Bom dia"
        elif hour < 18:
            greeting = "Boa tarde"
        else:
            greeting = "Boa noite"

        return {
            "greeting": greeting,
            "mission_status": mission_status,
            "mission_progress_pct": round(mission_pct, 1),
            "time_studied_today": round(time_today, 1),
            "questions_today": q_today,
            "accuracy_today": round(acc_today, 1),
            "streak": streak["current_streak"] if streak else 0,
            "reviews_due": reviews_due,
            "weakest_subject": weakest["subject_name"] if weakest else None,
            "most_important_subject": strongest["subject_name"] if strongest else None,
            "weekly_progress": weekly,
            "approval_estimate": round(estimate["probability"] * 100, 1) if estimate else 0,
            "weekly_goal_pct": round(weekly_goal_pct, 1),
            "level": xp["level"] if xp else 1,
            "xp_progress_pct": round(
                ((xp["total_xp"] % xp["xp_to_next"]) / max(xp["xp_to_next"], 1) * 100)
                if xp else 0, 1
            ),
            "next_review_in": _next_review_label(reviews_due),
        }

    # ── Approval Estimate ─────────────────────────────────────────────────────

    async def compute_approval_estimate(self, user_id: UUID) -> dict:
        mastery_rows = await self.repo.get_subject_mastery(user_id)
        profile = await self.repo.get_profile(user_id)
        behavior = await self.repo.get_behavior_metrics(user_id)

        subjects = []
        for m in mastery_rows:
            subjects.append(ApprovalSubject(
                subject_name=m["subject_name"],
                weight_prf=m.get("weight_prf", 1.0),
                mastery=m.get("mastery_level", 0),
                accuracy=m.get("accuracy", 0),
                total_attempts=m.get("total_attempts", 0),
                error_count=m.get("error_count", 0),
            ))

        consistency = behavior["consistency_score"] if behavior else 50
        retention = behavior["retention_score"] if behavior else 50
        exam_date = profile.get("exam_date") if profile else None

        prediction = estimate_approval(
            subjects=subjects,
            consistency_score=consistency,
            retention_score=retention,
            exam_date=exam_date,
        )

        factors_json = [
            {
                "subject_name": f.subject_name,
                "weight": f.weight,
                "mastery": f.mastery,
                "contribution": f.contribution,
                "gap": f.gap,
                "hours_to_improve": f.hours_to_improve,
            }
            for f in prediction.factors
        ]

        await self.repo.save_approval_estimate(user_id, {
            "probability": prediction.probability,
            "factors": json.dumps(factors_json),
            "trend": prediction.trend,
        })

        return {
            "probability": prediction.probability,
            "trend": prediction.trend,
            "factors": factors_json,
            "highest_impact_subject": prediction.highest_impact_subject,
            "study_hours_needed": prediction.study_hours_needed,
            "days_until_exam": prediction.days_until_exam,
        }

    # ── Behavior Update ───────────────────────────────────────────────────────

    async def update_behavior_metrics(self, user_id: UUID):
        """Recompute behavior metrics from session history."""
        sessions = await self.repo.get_sessions(user_id, limit=100)
        records = [
            SessionRecord(
                started_at=s["started_at"],
                duration_mins=s.get("duration_mins", 0) or 0,
                accuracy=(s.get("questions_correct", 0) / max(s.get("questions_total", 1), 1)),
                questions_answered=s.get("questions_total", 0),
                mode=s.get("mode", "focus"),
                energy_start=s.get("energy_at_start", "medium") or "medium",
                energy_end=s.get("energy_at_end"),
                completed=s.get("is_completed", False),
            )
            for s in sessions
        ]

        insights = analyze_behavior(records)

        total_q = sum(s.get("questions_total", 0) for s in sessions)
        total_c = sum(s.get("questions_correct", 0) for s in sessions)
        total_h = sum((s.get("duration_mins") or 0) for s in sessions) / 60
        unique_dates = set(s["started_at"].date() for s in sessions)

        await self.repo.upsert_behavior_metrics(user_id, {
            "best_study_hour": insights.best_study_hour,
            "avg_session_minutes": insights.avg_session_minutes,
            "avg_accuracy": total_c / max(total_q, 1),
            "avg_questions_per_day": total_q / max(len(unique_dates), 1),
            "preferred_block_size": insights.preferred_block_size,
            "total_study_hours": round(total_h, 2),
            "total_questions": total_q,
            "total_correct": total_c,
            "consistency_score": insights.consistency_score,
            "retention_score": insights.retention_score,
            "fatigue_threshold_mins": insights.fatigue_threshold_mins,
            "days_active": len(unique_dates),
        })

    # ── Internal helpers ──────────────────────────────────────────────────────

    async def _update_mastery_for_question(self, user_id: UUID, question: dict):
        subject_id = question.get("subject_id")
        if not subject_id:
            return

        attempts = await self.repo.get_user_attempts(user_id, limit=200, subject_id=subject_id)
        total = len(attempts)
        correct = sum(1 for a in attempts if a["is_correct"])
        accuracy = correct / max(total, 1)
        mastery = min(1.0, accuracy * min(total / 50, 1.0))  # ramp up with volume

        await self.repo.upsert_subject_mastery(user_id, subject_id, {
            "total_attempts": total,
            "total_correct": correct,
            "accuracy": round(accuracy, 3),
            "mastery_level": round(mastery, 3),
            "study_time_mins": 0,
            "error_count": total - correct,
        })


def _is_commute_time(routine: dict, hour: int) -> bool:
    cs = routine.get("commute_start")
    ce = routine.get("commute_end")
    if not cs or not ce:
        return False
    try:
        start_h = int(str(cs).split(":")[0])
        end_h = int(str(ce).split(":")[0])
        return start_h <= hour <= end_h
    except (ValueError, IndexError):
        return False


def _next_review_label(count: int) -> Optional[str]:
    if count == 0:
        return None
    if count == 1:
        return "1 revisão pendente"
    return f"{count} revisões pendentes"
