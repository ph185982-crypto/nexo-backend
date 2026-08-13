"""
Core Study Orchestration Service — coordinates engines, repository, and user context
to deliver the optimal study experience.
"""
from __future__ import annotations
from datetime import date, datetime, timezone, timedelta
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
from prf.engines.exam_profile import exam_profile_for
from prf.models.user import EnergyLevel, StudyMode


class StudyService:
    def __init__(self, repo: PRFRepository):
        self.repo = repo

    # ── Mission Generation ────────────────────────────────────────────────────

    async def generate_daily_mission(
        self, user_id: UUID, energy: EnergyLevel | None = None, mode: StudyMode | None = None,
        force: bool = False,
    ) -> dict:
        """Generate or retrieve today's mission.

        Bug corrigido: a checagem antiga só pulava a regeneração quando
        status != 'pending', mas status só vira 'completed' ao fim da
        missão inteira — ou seja, toda vez que um bloco era concluído e o
        frontend recarregava a missão, essa função rodava de novo e
        empilhava um novo conjunto de blocos por cima dos antigos (sem
        nunca apagar os anteriores). Regra correta: se já existe missão
        hoje com blocos, é a missão do dia — só se regenera com force=True.
        """
        existing = await self.repo.get_todays_mission(user_id)
        if existing and existing.get("blocks") and not force:
            return existing

        profile = await self.repo.get_profile(user_id)
        routine = await self.repo.get_routine_for_day(user_id, date.today().weekday())
        behavior = await self.repo.get_behavior_metrics(user_id)

        is_rest_day = bool(routine and routine.get("is_rest_day"))
        commute_mins = (routine or {}).get("commute_minutes", 0) or 0

        if is_rest_day:
            available_mins = 0
        elif routine:
            available_mins = routine["study_minutes"]
        elif profile and profile.get("weekly_goal_hours"):
            available_mins = round(profile["weekly_goal_hours"] * 60 / 7)
        else:
            available_mins = 60
        if not energy and routine:
            energy = EnergyLevel(routine["typical_energy"])
        energy = energy or EnergyLevel.MEDIUM

        if not mode:
            hour = datetime.now(timezone(timedelta(hours=-3))).hour
            is_commuting = _is_commute_time(routine, hour) if routine else False
            mode_str = detect_study_mode(
                hour, is_commuting, energy.value, available_mins
            )
            mode = StudyMode(mode_str)

        subjects = await self.repo.get_subjects()
        mastery_list = await self.repo.get_subject_mastery(user_id)
        mastery_map = {m["subject_id"]: m for m in mastery_list}

        is_pm = (profile or {}).get("target_exam", "PMGO").upper().startswith("PM")
        weight_key = "weight_pm" if is_pm else "weight_prf"

        priority_slugs = set((profile or {}).get("priority_subjects") or [])

        # Itens por matéria no blueprint do edital — mesmo ExamProfile que
        # alimenta a estimativa de aprovação, pra ranking e projeção de
        # pontos nunca discordarem entre si. exam_items já pondera pelo peso
        # do bloco (pontos que a matéria vale); blueprint_item_count é a
        # contagem bruta, usada pela regra do zero.
        exam_profile = exam_profile_for(is_pm)
        exam_items_map = {
            slug: n * exam_profile.block_weight_of(slug)
            for slug, n in exam_profile.items_per_subject.items()
        }

        subject_states = []
        for s in subjects:
            exam_weight = s.get(weight_key, 0) or 0
            if exam_weight <= 0:
                continue
            m = mastery_map.get(s["id"], {})
            recurring = await self.repo.get_recurring_error_count(user_id, s["id"])
            reviews_due = 0  # will be counted below per-subject
            subject_states.append(SubjectState(
                subject_id=s["id"],
                subject_name=s["name"],
                weight_prf=exam_weight,
                mastery=m.get("mastery_level", 0),
                accuracy=m.get("accuracy", 0),
                total_attempts=m.get("total_attempts", 0),
                error_count=m.get("error_count", 0),
                reviews_due=reviews_due,
                last_studied=m.get("last_studied"),
                study_time_mins=m.get("study_time_mins", 0),
                recurring_errors=recurring,
                is_priority=s.get("slug") in priority_slugs,
                exam_items=exam_items_map.get(s.get("slug"), 0),
                blueprint_item_count=exam_profile.items_of(s.get("slug")),
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
            study_level=(profile or {}).get("study_level", "intermediate"),
            exam_total_items=50 if is_pm else 120,
        )

        # Fetch subjects studied in last 1 day to ensure rotation.
        # Matérias que apareceram na missão de ontem recebem penalidade forte.
        recently_studied = await self.repo.get_mission_subjects_last_days(user_id, days=1)

        priorities = compute_priorities(subject_states, ctx, recently_studied)

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
            a_ids = await self.repo.get_legal_article_ids_by_subject(
                p.subject_id, limit=15, user_id=user_id,
            )
            if a_ids:
                legal_pool[p.subject_id] = a_ids

        # Tópico do dia por matéria: é ele que amarra a aula em áudio do
        # deslocamento à lei seca e às questões da noite. Sem isso cada
        # etapa da missão caía num assunto diferente.
        # Formato das questões da prática diária.
        #
        # O simulado continua 100% no formato do certame (A-E na PMGO), porque
        # ele simula a prova. Mas a prática do dia a dia não precisa desse
        # filtro, e pagava caro por ele: das 2.204 questões do banco, 1.736 são
        # certo/errado e ficavam invisíveis para quem estuda PMGO — 79% do
        # acervo trancado. Direito Penal é Direito Penal nos dois formatos, e
        # C/E treina precisão de afirmação, que é exatamente o que a banca
        # cobra dentro de uma alternativa A-E.
        #
        # Vale também como proteção: a banca do próximo certame não está
        # definida (AOCP em 2022, CEBRASPE é candidata). Treinar nos dois
        # formatos cobre os dois cenários.
        qtype = None if is_pm else "certo_errado"
        topic_plan: dict = {}
        for p in priorities[:4]:
            topic = await self.repo.pick_study_topic(user_id, p.subject_id)
            if not topic:
                continue
            aula = await self.repo.get_next_aula_for_topic(topic["id"])
            episode_ids = [aula["id"]] if aula else []
            drill_id = await self.repo.get_drill_for_aula(aula["id"]) if aula else None
            article_ids = await self.repo.get_legal_article_ids_by_topic(
                topic["id"], limit=15, user_id=user_id,
            )
            topic_question_ids = await self.repo.get_question_ids_by_topic(
                topic["id"], subject_id=p.subject_id, limit=12, question_type=qtype,
            )
            flashcard_ids = await self.repo.get_flashcard_ids_for_topic(
                topic["id"], user_id=user_id, limit=12,
            )
            if not (episode_ids or article_ids):
                continue
            topic_plan[p.subject_id] = {
                "topic_id": topic["id"],
                "topic_name": topic["name"],
                "episode_ids": episode_ids,
                "episode_mins": round((aula or {}).get("duration_secs", 2400) / 60) or 40,
                "drill_ids": [drill_id] if drill_id else [],
                "article_ids": article_ids,
                "question_ids": topic_question_ids,
                "flashcard_ids": flashcard_ids,
            }

        mission = build_mission(
            priorities=priorities,
            context=ctx,
            reviews_due=reviews_due_count,
            review_card_ids=review_card_ids,
            error_flashcard_ids=error_flashcard_ids,
            commute_lesson_ids=commute_lesson_ids,
            question_pool=question_pool,
            legal_article_ids=legal_pool,
            is_pm=is_pm,
            topic_plan=topic_plan,
            is_rest_day=is_rest_day,
            commute_minutes=commute_mins,
        )

        db_mission = await self.repo.create_mission(user_id, {
            "estimated_mins": mission.estimated_mins,
            "mode_suggested": mission.mode_suggested,
            "energy_detected": mission.energy_detected,
            "greeting": mission.greeting,
            "blocks_total": len(mission.blocks),
        })
        if force:
            await self.repo.delete_mission_blocks(db_mission["id"])

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
        else:
            # Acertou o que já tinha errado: fecha o erro no caderno. É o que
            # faz a questão sair do pool de re-drill e o caderno parar de
            # crescer indefinidamente.
            await self.repo.resolve_error(user_id, question_id)

        review_scheduled = not is_correct

        await self._update_mastery_for_question(user_id, question)
        await self.repo.increment_daily_question(user_id, is_correct, time_spent or 0)

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
        await self.repo.increment_daily_review(user_id)

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

        def _mastery_of(m):
            return m.get("mastery_level") or 0

        weakest = min(mastery, key=_mastery_of) if mastery else None
        strongest = max(mastery, key=_mastery_of) if mastery else None

        # Pontos em risco — mesma projeção contra o blueprint do edital que
        # alimenta compute_approval_estimate, pra não ter dois números
        # diferentes de "quanto você perderia hoje" em telas diferentes.
        is_pm_dash = (profile or {}).get("target_exam", "PMGO").upper().startswith("PM")
        exam_profile_dash = exam_profile_for(is_pm_dash)
        dash_subjects = [
            ApprovalSubject(
                subject_slug=m["subject_slug"],
                subject_name=m["subject_name"],
                accuracy=m.get("accuracy", 0) or 0,
                total_attempts=m.get("total_attempts", 0) or 0,
            )
            for m in mastery
        ]
        dash_prediction = estimate_approval(profile=exam_profile_dash, subjects=dash_subjects)
        expected_lost_points = round(
            sum(f.points_at_risk for f in dash_prediction.factors), 1,
        )
        top_risks = [
            {"subject_name": f.subject_name, "points_at_risk": f.points_at_risk}
            for f in dash_prediction.factors if f.points_at_risk > 0
        ][:3]
        exam_items_dash = round(dash_prediction.max_points)

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

        hour = datetime.now(timezone(timedelta(hours=-3))).hour
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
            "target_exam": (profile or {}).get("target_exam", "PMGO"),
            "expected_lost_points": expected_lost_points,
            "exam_total_items": exam_items_dash,
            "top_risks": top_risks,
        }

    # ── Approval Estimate ─────────────────────────────────────────────────────

    async def compute_approval_estimate(self, user_id: UUID) -> dict:
        """Projeta pontos reais contra o blueprint do edital — não mais uma
        média de domínio comparada com um corte que ninguém lia."""
        mastery_rows = await self.repo.get_subject_mastery(user_id)
        profile = await self.repo.get_profile(user_id)

        is_pm = (profile or {}).get("target_exam", "PMGO").upper().startswith("PM")
        exam_profile = exam_profile_for(is_pm)

        subjects = [
            ApprovalSubject(
                subject_slug=m["subject_slug"],
                subject_name=m["subject_name"],
                accuracy=m.get("accuracy", 0) or 0,
                total_attempts=m.get("total_attempts", 0) or 0,
            )
            for m in mastery_rows
        ]

        exam_date = profile.get("exam_date") if profile else None
        target_cutoff = (profile or {}).get("target_cutoff_score")

        prediction = estimate_approval(
            profile=exam_profile,
            subjects=subjects,
            target_cutoff=target_cutoff,
            exam_date=exam_date,
        )

        factors_json = [
            {
                "subject_name": f.subject_name,
                "subject_slug": f.subject_slug,
                "items_in_blueprint": f.items_in_blueprint,
                "projected_correct": f.projected_correct,
                "max_points": f.max_points,
                "projected_points": f.projected_points,
                "points_at_risk": f.points_at_risk,
                "hours_to_close_gap": f.hours_to_close_gap,
                "points_per_hour": f.points_per_hour,
                "zero_risk": f.zero_risk,
            }
            for f in prediction.factors
        ]
        best_value_json = [
            {"subject_name": f.subject_name, "points_per_hour": f.points_per_hour,
             "hours_to_close_gap": f.hours_to_close_gap}
            for f in prediction.best_value
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
            "best_value": best_value_json,
            "projected_points": prediction.projected_points,
            "max_points": prediction.max_points,
            "survive_threshold": prediction.survive_threshold,
            "gap_to_survive": prediction.gap_to_survive,
            "eliminated_risk": prediction.eliminated_risk,
            "target_cutoff": prediction.target_cutoff,
            "gap_to_cutoff": prediction.gap_to_cutoff,
            "zero_risk_subjects": prediction.zero_risk_subjects,
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

    async def absorb_exam_answers(self, user_id: UUID, answers: dict) -> dict:
        """Transforma as respostas de um simulado em tentativas reais.

        Até aqui `finish_exam` calculava a nota, aplicava a regra de
        eliminação e terminava num `UPDATE simulated_exams`. Nada disso
        chegava ao resto do sistema: dez simulados completos não moviam
        domínio, caderno de erros, revisão nem estatística do dia. O sinal
        mais parecido com a prova real era o único que não contava.

        Args:
            answers: {question_id_str: {"selected": "A", "correct": bool}}
        """
        if not answers:
            return {"recorded": 0}

        q_ids = []
        for k in answers:
            try:
                q_ids.append(k if isinstance(k, UUID) else UUID(str(k)))
            except (ValueError, AttributeError):
                continue
        if not q_ids:
            return {"recorded": 0}

        questions = await self.repo.get_questions_by_ids(q_ids)
        alts_map = await self.repo.get_alternatives_batch([q["id"] for q in questions])

        recorded = 0
        subjects_touched: set[UUID] = set()
        for q in questions:
            ans = answers.get(str(q["id"])) or answers.get(q["id"])
            if not ans:
                continue
            letter = (ans.get("selected") or "").upper()
            selected_alt = next(
                (a for a in alts_map.get(q["id"], []) if a["letter"] == letter), None
            )
            if not selected_alt:
                continue

            is_correct = bool(ans.get("correct"))
            attempt = await self.repo.record_attempt(user_id, {
                "question_id": q["id"],
                "session_id": None,
                "selected_alt_id": selected_alt["id"],
                "is_correct": is_correct,
                "time_spent_secs": None,
                "confidence": None,
            })
            if is_correct:
                await self.repo.resolve_error(user_id, q["id"])
            else:
                await self.repo.record_error(user_id, {
                    "question_id": q["id"],
                    "attempt_id": attempt["id"],
                    "subject_id": q.get("subject_id"),
                    "topic_id": q.get("topic_id"),
                })
                await self.repo.create_review_card_for_question(user_id, q["id"])

            await self.repo.increment_daily_question(user_id, is_correct, 0)
            if q.get("subject_id"):
                subjects_touched.add(q["subject_id"])
            recorded += 1

        for subject_id in subjects_touched:
            await self._update_mastery_for_question(user_id, {"subject_id": subject_id})

        return {"recorded": recorded, "subjects_updated": len(subjects_touched)}

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
