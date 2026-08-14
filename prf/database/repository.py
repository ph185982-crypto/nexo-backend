"""
Database repository — async PostgreSQL queries via asyncpg.
Central data access layer for the PRF module.
"""
from __future__ import annotations
from datetime import date, datetime, timedelta, timezone
from typing import Optional, Any
from uuid import UUID

import asyncpg
import json


class PRFRepository:
    """Thin query layer over asyncpg. All methods are async."""

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    # ── helpers ───────────────────────────────────────────────────────────────

    async def _fetchrow(self, query: str, *args) -> Optional[dict]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(query, *args)
            return dict(row) if row else None

    async def _fetch(self, query: str, *args) -> list[dict]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(query, *args)
            return [dict(r) for r in rows]

    async def _execute(self, query: str, *args) -> str:
        async with self._pool.acquire() as conn:
            return await conn.execute(query, *args)

    async def _fetchval(self, query: str, *args) -> Any:
        async with self._pool.acquire() as conn:
            return await conn.fetchval(query, *args)

    # ── Users ─────────────────────────────────────────────────────────────────

    async def create_user(self, email: str, password_hash: str, name: str) -> dict:
        return await self._fetchrow(
            """INSERT INTO prf_users (email, password_hash, name)
               VALUES ($1, $2, $3)
               RETURNING id, email, name, created_at, last_login_at""",
            email, password_hash, name,
        )

    async def get_user_by_email(self, email: str) -> Optional[dict]:
        return await self._fetchrow(
            "SELECT * FROM prf_users WHERE email = $1 AND is_active = TRUE", email
        )

    async def get_user_by_id(self, user_id: UUID) -> Optional[dict]:
        return await self._fetchrow(
            "SELECT * FROM prf_users WHERE id = $1 AND is_active = TRUE", user_id
        )

    async def update_last_login(self, user_id: UUID):
        await self._execute(
            "UPDATE prf_users SET last_login_at = NOW() WHERE id = $1", user_id
        )

    # ── Profile ───────────────────────────────────────────────────────────────

    async def upsert_profile(self, user_id: UUID, data: dict) -> dict:
        return await self._fetchrow(
            """INSERT INTO user_profiles (user_id, target_exam, exam_date, weekly_goal_hours,
               preferred_format, audio_preference, study_level, priority_subjects, onboarding_complete)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
               ON CONFLICT (user_id) DO UPDATE SET
                   target_exam = $2, exam_date = $3, weekly_goal_hours = $4,
                   preferred_format = $5, audio_preference = $6, study_level = $7,
                   priority_subjects = $8, onboarding_complete = TRUE, updated_at = NOW()
               RETURNING *""",
            user_id, data["target_exam"], data.get("exam_date"),
            data["weekly_goal_hours"], data["preferred_format"],
            data["audio_preference"], data["study_level"],
            data["priority_subjects"],
        )

    async def get_profile(self, user_id: UUID) -> Optional[dict]:
        return await self._fetchrow(
            "SELECT * FROM user_profiles WHERE user_id = $1", user_id
        )

    # ── Routines ──────────────────────────────────────────────────────────────

    async def upsert_routine(self, user_id: UUID, day: dict) -> dict:
        return await self._fetchrow(
            """INSERT INTO user_routines (user_id, day_of_week, available_from, available_to,
               study_minutes, commute_start, commute_end, commute_minutes,
               work_start, work_end, typical_energy, is_rest_day)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
               ON CONFLICT (user_id, day_of_week) DO UPDATE SET
                   available_from = $3, available_to = $4, study_minutes = $5,
                   commute_start = $6, commute_end = $7, commute_minutes = $8,
                   work_start = $9, work_end = $10, typical_energy = $11, is_rest_day = $12
               RETURNING *""",
            user_id, day["day_of_week"],
            day.get("available_from"), day.get("available_to"),
            day.get("study_minutes", 90),
            day.get("commute_start"), day.get("commute_end"),
            day.get("commute_minutes", 0),
            day.get("work_start"), day.get("work_end"),
            day.get("typical_energy", "medium"),
            day.get("is_rest_day", False),
        )

    async def get_routines(self, user_id: UUID) -> list[dict]:
        return await self._fetch(
            "SELECT * FROM user_routines WHERE user_id = $1 ORDER BY day_of_week", user_id
        )

    async def get_routine_for_day(self, user_id: UUID, day_of_week: int) -> Optional[dict]:
        return await self._fetchrow(
            "SELECT * FROM user_routines WHERE user_id = $1 AND day_of_week = $2",
            user_id, day_of_week,
        )

    # ── TAF ───────────────────────────────────────────────────────────────────

    async def add_taf_record(self, user_id: UUID, data: dict) -> dict:
        return await self._fetchrow(
            """INSERT INTO taf_records (user_id, measured_at, barra_reps, flexao_reps,
               abdominal_reps, corrida_12min_metros, notes)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING *""",
            user_id, data.get("measured_at") or date.today(),
            data.get("barra_reps"), data.get("flexao_reps"),
            data.get("abdominal_reps"), data.get("corrida_12min_metros"),
            data.get("notes"),
        )

    async def get_taf_records(self, user_id: UUID) -> list[dict]:
        return await self._fetch(
            "SELECT * FROM taf_records WHERE user_id = $1 ORDER BY measured_at", user_id
        )

    async def update_taf_targets(self, user_id: UUID, targets: dict) -> None:
        await self._execute(
            """UPDATE user_profiles SET taf_targets = $2, updated_at = NOW()
               WHERE user_id = $1""",
            user_id, targets,
        )

    # ── Checklist ─────────────────────────────────────────────────────────────

    async def get_checklist_status(self, user_id: UUID) -> list[dict]:
        return await self._fetch(
            "SELECT item_key, is_done, due_date, notes FROM user_checklist_status WHERE user_id = $1",
            user_id,
        )

    async def upsert_checklist_status(self, user_id: UUID, item_key: str, data: dict) -> dict:
        return await self._fetchrow(
            """INSERT INTO user_checklist_status (user_id, item_key, is_done, due_date, notes)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (user_id, item_key) DO UPDATE SET
                   is_done = $3, due_date = $4, notes = $5, updated_at = NOW()
               RETURNING *""",
            user_id, item_key, data.get("is_done", False),
            data.get("due_date"), data.get("notes"),
        )

    # ── Behavior Metrics ──────────────────────────────────────────────────────

    async def upsert_behavior_metrics(self, user_id: UUID, data: dict) -> dict:
        return await self._fetchrow(
            """INSERT INTO user_behavior_metrics (user_id, best_study_hour, avg_session_minutes,
               avg_accuracy, avg_questions_per_day, preferred_block_size,
               total_study_hours, total_questions, total_correct,
               consistency_score, retention_score, fatigue_threshold_mins, days_active)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
               ON CONFLICT (user_id) DO UPDATE SET
                   best_study_hour = $2, avg_session_minutes = $3,
                   avg_accuracy = $4, avg_questions_per_day = $5,
                   preferred_block_size = $6, total_study_hours = $7,
                   total_questions = $8, total_correct = $9,
                   consistency_score = $10, retention_score = $11,
                   fatigue_threshold_mins = $12, days_active = $13,
                   last_computed_at = NOW(), updated_at = NOW()
               RETURNING *""",
            user_id, data.get("best_study_hour"), data.get("avg_session_minutes", 0),
            data.get("avg_accuracy", 0), data.get("avg_questions_per_day", 0),
            data.get("preferred_block_size", 15), data.get("total_study_hours", 0),
            data.get("total_questions", 0), data.get("total_correct", 0),
            data.get("consistency_score", 0), data.get("retention_score", 0),
            data.get("fatigue_threshold_mins", 45), data.get("days_active", 0),
        )

    async def get_behavior_metrics(self, user_id: UUID) -> Optional[dict]:
        return await self._fetchrow(
            "SELECT * FROM user_behavior_metrics WHERE user_id = $1", user_id
        )

    # ── Subjects & Topics ─────────────────────────────────────────────────────

    async def get_subjects(self) -> list[dict]:
        return await self._fetch(
            "SELECT * FROM subjects WHERE is_active = TRUE ORDER BY display_order"
        )

    async def get_subject(self, subject_id: UUID) -> Optional[dict]:
        return await self._fetchrow("SELECT * FROM subjects WHERE id = $1", subject_id)

    async def get_topics(self, subject_id: UUID) -> list[dict]:
        return await self._fetch(
            "SELECT * FROM topics WHERE subject_id = $1 AND is_active = TRUE ORDER BY display_order",
            subject_id,
        )

    # ── Questions ─────────────────────────────────────────────────────────────

    async def get_questions(
        self,
        subject_id: UUID | None = None,
        topic_id: UUID | None = None,
        difficulty: str | None = None,
        question_type: str | None = None,
        limit: int = 10,
        exclude_ids: list[UUID] | None = None,
    ) -> list[dict]:
        conditions = ["q.is_active = TRUE"]
        params: list = []
        idx = 1

        if subject_id:
            conditions.append(f"q.subject_id = ${idx}")
            params.append(subject_id)
            idx += 1
        if topic_id:
            conditions.append(f"q.topic_id = ${idx}")
            params.append(topic_id)
            idx += 1
        if difficulty:
            conditions.append(f"q.difficulty = ${idx}")
            params.append(difficulty)
            idx += 1
        if question_type:
            conditions.append(f"q.question_type = ${idx}")
            params.append(question_type)
            idx += 1
        if exclude_ids:
            conditions.append(f"q.id != ALL(${idx})")
            params.append(exclude_ids)
            idx += 1

        where = " AND ".join(conditions)
        params.append(limit)

        return await self._fetch(
            f"""SELECT q.*, s.name as subject_name
                FROM questions q
                JOIN subjects s ON s.id = q.subject_id
                WHERE {where}
                ORDER BY RANDOM()
                LIMIT ${idx}""",
            *params,
        )

    async def get_questions_by_ids(self, question_ids: list) -> list[dict]:
        """Busca um conjunto de questões numa query só, preservando a ordem
        pedida — o re-drill do caderno de erros vem ordenado por repetição."""
        if not question_ids:
            return []
        rows = await self._fetch(
            """SELECT q.*, s.name as subject_name
               FROM questions q
               JOIN subjects s ON s.id = q.subject_id
               WHERE q.id = ANY($1::uuid[])""",
            question_ids,
        )
        by_id = {r["id"]: r for r in rows}
        return [by_id[qid] for qid in question_ids if qid in by_id]

    async def get_question_with_alternatives(self, question_id: UUID) -> Optional[dict]:
        q = await self._fetchrow(
            """SELECT q.*, s.name as subject_name
               FROM questions q
               JOIN subjects s ON s.id = q.subject_id
               WHERE q.id = $1""",
            question_id,
        )
        if not q:
            return None
        alts = await self._fetch(
            """SELECT * FROM question_alternatives
               WHERE question_id = $1 ORDER BY display_order""",
            question_id,
        )
        q["alternatives"] = alts
        return q

    async def get_alternatives_batch(self, question_ids: list) -> dict:
        """Fetch alternatives for multiple questions in one query. Returns {question_id: [alts]}."""
        if not question_ids:
            return {}
        rows = await self._fetch(
            """SELECT id, question_id, letter, text, display_order
               FROM question_alternatives
               WHERE question_id = ANY($1)
               ORDER BY question_id, display_order""",
            question_ids,
        )
        result: dict = {}
        for r in rows:
            qid = r["question_id"]
            if qid not in result:
                result[qid] = []
            result[qid].append(dict(r))
        return result

    async def get_questions_for_coverage(self) -> list[dict]:
        """Return minimal question data for coverage analysis (subject, topic, difficulty)."""
        rows = await self._fetch(
            """SELECT s.slug AS subject_slug, t.slug AS topic_slug, q.difficulty
               FROM questions q
               JOIN subjects s ON s.id = q.subject_id
               LEFT JOIN topics t ON t.id = q.topic_id
               WHERE q.is_active = TRUE"""
        )
        return [dict(r) for r in rows]

    async def get_question_ids_by_subject(self, subject_id: UUID, limit: int = 20) -> list[UUID]:
        rows = await self._fetch(
            "SELECT id FROM questions WHERE subject_id = $1 AND is_active = TRUE ORDER BY RANDOM() LIMIT $2",
            subject_id, limit,
        )
        return [r["id"] for r in rows]

    async def get_question_ids_by_topic(
        self, topic_id: UUID, subject_id: UUID | None = None,
        limit: int = 20, question_type: str | None = None,
    ) -> list[UUID]:
        """Questões do tópico. Cai para a matéria inteira quando o tópico não
        tem questões suficientes, porque a missão não pode ficar sem prática
        só porque um recorte do edital está pouco povoado."""
        rows = await self._fetch(
            """SELECT id FROM questions
                WHERE topic_id = $1 AND is_active = TRUE
                  AND ($2::text IS NULL OR question_type = $2)
                ORDER BY RANDOM() LIMIT $3""",
            topic_id, question_type, limit,
        )
        ids = [r["id"] for r in rows]
        if len(ids) >= 3 or subject_id is None:
            return ids

        extra = await self._fetch(
            """SELECT id FROM questions
                WHERE subject_id = $1 AND is_active = TRUE
                  AND ($2::text IS NULL OR question_type = $2)
                  AND NOT (id = ANY($3::uuid[]))
                ORDER BY RANDOM() LIMIT $4""",
            subject_id, question_type, ids, limit - len(ids),
        )
        return ids + [r["id"] for r in extra]

    # ── Question Attempts ─────────────────────────────────────────────────────

    async def record_attempt(self, user_id: UUID, data: dict) -> dict:
        return await self._fetchrow(
            """INSERT INTO question_attempts (user_id, question_id, session_id,
               selected_alt_id, is_correct, time_spent_secs, confidence)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING *""",
            user_id, data["question_id"], data.get("session_id"),
            data["selected_alt_id"], data["is_correct"],
            data.get("time_spent_secs"), data.get("confidence"),
        )

    async def get_user_attempts(
        self, user_id: UUID, limit: int = 50, subject_id: UUID | None = None
    ) -> list[dict]:
        if subject_id:
            return await self._fetch(
                """SELECT qa.*, q.subject_id FROM question_attempts qa
                   JOIN questions q ON q.id = qa.question_id
                   WHERE qa.user_id = $1 AND q.subject_id = $2
                   ORDER BY qa.created_at DESC LIMIT $3""",
                user_id, subject_id, limit,
            )
        return await self._fetch(
            """SELECT * FROM question_attempts
               WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2""",
            user_id, limit,
        )

    async def get_answered_question_ids(self, user_id: UUID) -> list[UUID]:
        """Questões que saem do sorteio — só as que o usuário já ACERTOU.

        A versão anterior excluía tudo que tinha sido respondido, certo ou
        errado, e isso tinha duas consequências ruins. A primeira: questão
        errada nunca mais voltava, quando refazer erro é justamente a
        atividade de maior retorno na preparação. A segunda: com o banco de
        múltipla escolha da PMGO em 468 itens, respondendo ~30 por dia o
        acervo se esgotava em duas semanas e a missão passava a servir
        repetição de conteúdo já dominado.

        Agora a questão errada continua no pool até ser acertada, e sai
        sozinha quando o acerto acontece.
        """
        rows = await self._fetch(
            """SELECT DISTINCT question_id FROM question_attempts
               WHERE user_id = $1 AND is_correct = TRUE""",
            user_id,
        )
        return [r["question_id"] for r in rows]

    # ── Study Sessions ────────────────────────────────────────────────────────

    async def create_session(self, user_id: UUID, mode: str, energy: str | None = None) -> dict:
        return await self._fetchrow(
            """INSERT INTO study_sessions (user_id, mode, energy_at_start)
               VALUES ($1, $2, $3) RETURNING *""",
            user_id, mode, energy,
        )

    async def close_dangling_sessions(self, user_id: UUID) -> str:
        """Encerra sessões que ficaram abertas (aba fechada, app morto).

        A duração vira o intervalo até a ÚLTIMA resposta daquela sessão, não
        até agora: uma sessão esquecida durante a noite viraria oito horas de
        estudo e envenenaria a média de tempo, o limiar de fadiga e a
        consistência — exatamente as métricas que ela deveria alimentar.
        Sessão sem resposta nenhuma é descartada, porque não houve estudo.
        """
        return await self._execute(
            """WITH ultimas AS (
                   SELECT s.id,
                          MAX(a.created_at) AS fim,
                          COUNT(a.id)       AS total,
                          COUNT(a.id) FILTER (WHERE a.is_correct) AS acertos
                     FROM study_sessions s
                     LEFT JOIN question_attempts a ON a.session_id = s.id
                    WHERE s.user_id = $1 AND s.ended_at IS NULL
                    GROUP BY s.id
               )
               UPDATE study_sessions s
                  SET ended_at        = COALESCE(u.fim, s.started_at),
                      duration_mins   = GREATEST(
                          ROUND(EXTRACT(EPOCH FROM (COALESCE(u.fim, s.started_at) - s.started_at)) / 60.0)::int,
                          0),
                      questions_total = u.total,
                      questions_correct = u.acertos,
                      is_completed    = (u.total > 0)
                 FROM ultimas u
                WHERE s.id = u.id AND s.ended_at IS NULL""",
            user_id,
        )

    async def end_session(self, session_id: UUID, data: dict) -> dict:
        return await self._fetchrow(
            """UPDATE study_sessions SET
                   ended_at = NOW(),
                   energy_at_end = $2,
                   duration_mins = $3,
                   questions_total = $4,
                   questions_correct = $5,
                   is_completed = TRUE
               WHERE id = $1 RETURNING *""",
            session_id, data.get("energy_at_end"),
            data.get("duration_mins"), data.get("questions_total", 0),
            data.get("questions_correct", 0),
        )

    async def get_sessions(self, user_id: UUID, limit: int = 30) -> list[dict]:
        return await self._fetch(
            """SELECT * FROM study_sessions
               WHERE user_id = $1 ORDER BY started_at DESC LIMIT $2""",
            user_id, limit,
        )

    async def get_sessions_in_range(
        self, user_id: UUID, start: datetime, end: datetime
    ) -> list[dict]:
        return await self._fetch(
            """SELECT * FROM study_sessions
               WHERE user_id = $1 AND started_at >= $2 AND started_at <= $3
               ORDER BY started_at""",
            user_id, start, end,
        )

    # ── Review Cards (Spaced Repetition) ──────────────────────────────────────

    async def upsert_review_card(self, user_id: UUID, data: dict) -> dict:
        return await self._fetchrow(
            """INSERT INTO review_cards (user_id, question_id, flashcard_id, article_id,
               ease_factor, interval_days, repetitions, next_review, last_review,
               last_quality, total_reviews, total_correct, streak, lapsed)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
               ON CONFLICT (id) DO UPDATE SET
                   ease_factor = $5, interval_days = $6, repetitions = $7,
                   next_review = $8, last_review = $9, last_quality = $10,
                   total_reviews = $11, total_correct = $12, streak = $13,
                   lapsed = $14, updated_at = NOW()
               RETURNING *""",
            user_id, data.get("question_id"), data.get("flashcard_id"),
            data.get("article_id"), data.get("ease_factor", 2.5),
            data.get("interval_days", 0), data.get("repetitions", 0),
            data.get("next_review", datetime.utcnow()),
            data.get("last_review"), data.get("last_quality"),
            data.get("total_reviews", 0), data.get("total_correct", 0),
            data.get("streak", 0), data.get("lapsed", False),
        )

    async def get_due_review_cards(self, user_id: UUID, limit: int = 30) -> list[dict]:
        return await self._fetch(
            """SELECT rc.*, q.text as question_text, q.subject_id,
                      s.name as subject_name, f.front as flashcard_front
               FROM review_cards rc
               LEFT JOIN questions q ON q.id = rc.question_id
               LEFT JOIN subjects s ON s.id = q.subject_id
               LEFT JOIN flashcards f ON f.id = rc.flashcard_id
               WHERE rc.user_id = $1 AND rc.next_review <= NOW()
                 AND rc.suspended = FALSE
               ORDER BY rc.next_review ASC
               LIMIT $2""",
            user_id, limit,
        )

    async def get_review_cards_by_ids(self, user_id: UUID, ids: list[UUID]) -> list[dict]:
        """Cartões exatos de um bloco de missão, vencidos ou não.

        A revisão do dia anterior entra na missão antes de o intervalo do SM-2
        vencer — buscar só o que já venceu (get_due_review_cards) faria o bloco
        montado pela missão abrir vazio e se autoconcluir.
        """
        if not ids:
            return []
        return await self._fetch(
            """SELECT rc.*, q.text as question_text, q.subject_id,
                      s.name as subject_name, f.front as flashcard_front
                 FROM review_cards rc
                 LEFT JOIN questions q ON q.id = rc.question_id
                 LEFT JOIN subjects s ON s.id = q.subject_id
                 LEFT JOIN flashcards f ON f.id = rc.flashcard_id
                WHERE rc.user_id = $1 AND rc.id = ANY($2::uuid[])
                  AND rc.suspended = FALSE
                ORDER BY rc.next_review ASC""",
            user_id, ids,
        )

    async def get_review_card(self, card_id: UUID) -> Optional[dict]:
        return await self._fetchrow("SELECT * FROM review_cards WHERE id = $1", card_id)

    async def update_review_card(self, card_id: UUID, data: dict):
        await self._execute(
            """UPDATE review_cards SET
                   ease_factor = $2, interval_days = $3, repetitions = $4,
                   next_review = $5, last_review = NOW(), last_quality = $6,
                   total_reviews = total_reviews + 1,
                   total_correct = total_correct + $7,
                   streak = $8, lapsed = $9, updated_at = NOW()
               WHERE id = $1""",
            card_id, data["ease_factor"], data["interval_days"],
            data["repetitions"], data["next_review"], data["last_quality"],
            1 if data.get("is_correct") else 0,
            data["streak"], data["lapsed"],
        )

    async def count_due_reviews(self, user_id: UUID) -> int:
        return await self._fetchval(
            """SELECT COUNT(*) FROM review_cards
               WHERE user_id = $1 AND next_review <= NOW() AND suspended = FALSE""",
            user_id,
        ) or 0

    async def get_due_review_card_ids(self, user_id: UUID, limit: int = 20) -> list[UUID]:
        rows = await self._fetch(
            """SELECT id FROM review_cards
               WHERE user_id = $1 AND next_review <= NOW() AND suspended = FALSE
               ORDER BY next_review ASC LIMIT $2""",
            user_id, limit,
        )
        return [r["id"] for r in rows]

    async def create_review_card_for_question(self, user_id: UUID, question_id: UUID) -> dict:
        existing = await self._fetchrow(
            "SELECT id FROM review_cards WHERE user_id = $1 AND question_id = $2",
            user_id, question_id,
        )
        if existing:
            return existing
        return await self._fetchrow(
            """INSERT INTO review_cards (user_id, question_id, next_review)
               VALUES ($1, $2, NOW()) RETURNING *""",
            user_id, question_id,
        )

    # ── Error Notebook ────────────────────────────────────────────────────────

    async def record_error(self, user_id: UUID, data: dict) -> dict:
        existing = await self._fetchrow(
            "SELECT id, times_repeated FROM error_notebook WHERE user_id = $1 AND question_id = $2",
            user_id, data["question_id"],
        )
        if existing:
            await self._execute(
                """UPDATE error_notebook SET
                       times_repeated = times_repeated + 1,
                       last_error_at = NOW(), resolved = FALSE
                   WHERE id = $1""",
                existing["id"],
            )
            return {**existing, "times_repeated": existing["times_repeated"] + 1}

        return await self._fetchrow(
            """INSERT INTO error_notebook (user_id, question_id, attempt_id,
               subject_id, topic_id, error_summary, error_type)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING *""",
            user_id, data["question_id"], data.get("attempt_id"),
            data.get("subject_id"), data.get("topic_id"),
            data.get("error_summary"), data.get("error_type"),
        )

    async def resolve_error(self, user_id: UUID, question_id: UUID) -> None:
        """Fecha o erro quando o usuário acerta a questão que tinha errado.

        `resolved` existia no schema desde o início e nunca era escrito como
        TRUE por ninguém — só voltava para FALSE em `record_error`. O caderno
        de erros era append-only e crescia para sempre, sem jeito de saber o
        que já tinha sido superado.
        """
        await self._execute(
            """UPDATE error_notebook SET resolved = TRUE
               WHERE user_id = $1 AND question_id = $2""",
            user_id, question_id,
        )

    async def get_error_question_ids(
        self, user_id: UUID, limit: int = 20, subject_id: UUID | None = None
    ) -> list[UUID]:
        """Questões erradas e ainda não superadas, mais repetidas primeiro."""
        if subject_id:
            rows = await self._fetch(
                """SELECT question_id FROM error_notebook
                   WHERE user_id = $1 AND resolved = FALSE AND subject_id = $2
                   ORDER BY times_repeated DESC, last_error_at DESC LIMIT $3""",
                user_id, subject_id, limit,
            )
        else:
            rows = await self._fetch(
                """SELECT question_id FROM error_notebook
                   WHERE user_id = $1 AND resolved = FALSE
                   ORDER BY times_repeated DESC, last_error_at DESC LIMIT $2""",
                user_id, limit,
            )
        return [r["question_id"] for r in rows]

    async def get_error_notebook(
        self, user_id: UUID, limit: int = 50, subject_id: UUID | None = None
    ) -> list[dict]:
        if subject_id:
            return await self._fetch(
                """SELECT en.*, q.text as question_text, s.name as subject_name
                   FROM error_notebook en
                   JOIN questions q ON q.id = en.question_id
                   LEFT JOIN subjects s ON s.id = en.subject_id
                   WHERE en.user_id = $1 AND en.subject_id = $2
                   ORDER BY en.last_error_at DESC LIMIT $3""",
                user_id, subject_id, limit,
            )
        return await self._fetch(
            """SELECT en.*, q.text as question_text, s.name as subject_name
               FROM error_notebook en
               JOIN questions q ON q.id = en.question_id
               LEFT JOIN subjects s ON s.id = en.subject_id
               WHERE en.user_id = $1
               ORDER BY en.last_error_at DESC LIMIT $2""",
            user_id, limit,
        )

    async def get_recurring_error_count(self, user_id: UUID, subject_id: UUID) -> int:
        return await self._fetchval(
            """SELECT COUNT(*) FROM error_notebook
               WHERE user_id = $1 AND subject_id = $2 AND times_repeated >= 2""",
            user_id, subject_id,
        ) or 0

    # ── Daily Missions ────────────────────────────────────────────────────────

    async def get_todays_mission(self, user_id: UUID) -> Optional[dict]:
        mission = await self._fetchrow(
            f"SELECT * FROM daily_missions WHERE user_id = $1 AND date = {self._TODAY_BRT}",
            user_id,
        )
        if mission:
            mission["blocks"] = await self._fetch(
                """SELECT mb.*, s.name as subject_name
                   FROM mission_blocks mb
                   LEFT JOIN subjects s ON s.id = mb.subject_id
                   WHERE mb.mission_id = $1 ORDER BY mb.display_order""",
                mission["id"],
            )
        return mission

    async def get_mission_subjects_last_days(self, user_id: UUID, days: int = 1) -> set[UUID]:
        """Get subjects that appeared in missions over the last N days.

        Returns a set of subject IDs to help rotate daily missions and avoid
        repetition of the same subject on consecutive days.
        """
        cutoff_date = f"(NOW() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '{days} days'"
        rows = await self._fetch(
            f"""SELECT DISTINCT mb.subject_id
               FROM mission_blocks mb
               JOIN daily_missions dm ON dm.id = mb.mission_id
               WHERE dm.user_id = $1 AND dm.date >= {cutoff_date}
                 AND mb.subject_id IS NOT NULL""",
            user_id,
        )
        return {row["subject_id"] for row in rows if row["subject_id"]}

    async def create_mission(self, user_id: UUID, data: dict) -> dict:
        mission = await self._fetchrow(
            f"""INSERT INTO daily_missions (user_id, date, estimated_mins, mode_suggested,
               energy_detected, greeting, blocks_total, day_kind, topic_label, carried_over)
               VALUES ($1, {self._TODAY_BRT}, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (user_id, date) DO UPDATE SET
                   estimated_mins = $2, mode_suggested = $3,
                   energy_detected = $4, greeting = $5, blocks_total = $6,
                   day_kind = $7, topic_label = $8, carried_over = $9
               RETURNING *""",
            user_id, data["estimated_mins"], data["mode_suggested"],
            data.get("energy_detected"), data.get("greeting"), data.get("blocks_total", 0),
            data.get("day_kind", "conteudo"), data.get("topic_label"),
            data.get("carried_over", False),
        )
        return mission

    async def get_last_unfinished_mission(self, user_id: UUID) -> Optional[dict]:
        """Missão anterior a hoje que ficou com etapa em aberto.

        A missão só acaba quando concluída: enquanto existir uma assim, o dia
        de hoje começa terminando ela, e não com conteúdo novo por cima.
        """
        mission = await self._fetchrow(
            f"""SELECT * FROM daily_missions
                 WHERE user_id = $1 AND date < {self._TODAY_BRT}
                   AND status NOT IN ('completed', 'skipped', 'partial')
                   AND blocks_total > 0 AND blocks_done < blocks_total
                 ORDER BY date DESC LIMIT 1""",
            user_id,
        )
        if mission:
            mission["blocks"] = await self._fetch(
                """SELECT mb.*, s.name as subject_name
                     FROM mission_blocks mb
                     LEFT JOIN subjects s ON s.id = mb.subject_id
                    WHERE mb.mission_id = $1 AND mb.is_completed = FALSE
                    ORDER BY mb.display_order""",
                mission["id"],
            )
        return mission

    async def mark_mission_partial(self, mission_id: UUID) -> None:
        """Fecha a missão antiga depois que as pendências foram transferidas,
        para o mesmo bloco não ser herdado duas vezes."""
        await self._execute(
            "UPDATE daily_missions SET status = 'partial' WHERE id = $1", mission_id,
        )

    async def get_missions_range(
        self, user_id: UUID, start: "date", end: "date",
    ) -> list[dict]:
        """Missões de um intervalo, com contagem de etapas — alimenta o visto
        da tela de trajetória."""
        return await self._fetch(
            """SELECT id, date, status, day_kind, topic_label, blocks_total,
                      blocks_done, estimated_mins, actual_mins
                 FROM daily_missions
                WHERE user_id = $1 AND date BETWEEN $2 AND $3
                ORDER BY date""",
            user_id, start, end,
        )

    async def get_recent_mission_topic_ids(
        self, user_id: UUID, days: int = 7,
    ) -> list[UUID]:
        """Tópicos que passaram pelas missões dos últimos N dias."""
        cutoff = (
            f"(NOW() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '{days} days'"
        )
        rows = await self._fetch(
            f"""SELECT DISTINCT mb.topic_id
                  FROM mission_blocks mb
                  JOIN daily_missions dm ON dm.id = mb.mission_id
                 WHERE dm.user_id = $1 AND dm.date >= {cutoff}
                   AND mb.topic_id IS NOT NULL""",
            user_id,
        )
        return [r["topic_id"] for r in rows if r["topic_id"]]

    async def get_review_card_ids_for_topics(
        self, user_id: UUID, topic_ids: list[UUID], limit: int = 40,
    ) -> list[UUID]:
        """Cartões dos tópicos informados, vencidos ou não.

        get_due_review_card_ids só devolve o que já venceu. A revisão do dia
        anterior precisa vir mesmo com o intervalo ainda aberto — é justamente
        a recuperação precoce que impede o conteúdo de escorrer.
        """
        if not topic_ids:
            return []
        rows = await self._fetch(
            """SELECT rc.id
                 FROM review_cards rc
                 LEFT JOIN questions q ON q.id = rc.question_id
                 LEFT JOIN flashcards f ON f.id = rc.flashcard_id
                 LEFT JOIN legal_articles la ON la.id = rc.article_id
                WHERE rc.user_id = $1 AND rc.suspended = FALSE
                  AND COALESCE(q.topic_id, f.topic_id, la.topic_id) = ANY($2::uuid[])
                ORDER BY rc.next_review
                LIMIT $3""",
            user_id, topic_ids, limit,
        )
        return [r["id"] for r in rows]

    async def get_question_ids_for_topics(
        self, user_id: UUID, topic_ids: list[UUID], limit: int = 20,
    ) -> list[UUID]:
        """Questões dos tópicos da semana, priorizando as que ele errou."""
        if not topic_ids:
            return []
        rows = await self._fetch(
            """SELECT q.id
                 FROM questions q
                 LEFT JOIN error_notebook en
                        ON en.question_id = q.id AND en.user_id = $1
                          AND en.resolved = FALSE
                WHERE q.topic_id = ANY($2::uuid[]) AND q.is_active
                ORDER BY (en.id IS NOT NULL) DESC, RANDOM()
                LIMIT $3""",
            user_id, topic_ids, limit,
        )
        return [r["id"] for r in rows]

    async def delete_mission_blocks(self, mission_id: UUID) -> None:
        """Limpa os blocos de uma missão antes de regerar.

        create_mission faz upsert e devolve o MESMO mission_id em dias já
        existentes; sem isso, cada regeneração (todo bloco concluído chama
        generate_daily_mission de novo, já que status só vira 'completed'
        no fim) empilhava blocos duplicados por cima dos antigos.
        """
        await self._execute("DELETE FROM mission_blocks WHERE mission_id = $1", mission_id)
        # O contador vive na missão, não nos blocos: apagar as etapas sem
        # zerar blocks_done deixava a missão nova já nascendo "meio feita".
        await self._execute(
            "UPDATE daily_missions SET blocks_done = 0, status = 'pending' WHERE id = $1",
            mission_id,
        )

    async def create_mission_block(self, mission_id: UUID, block: dict) -> dict:
        return await self._fetchrow(
            """INSERT INTO mission_blocks (mission_id, block_type, subject_id, topic_id,
               title, description, estimated_mins, display_order, content_ids, is_optional,
               mode, payload, unit_key)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
               RETURNING *""",
            mission_id, block["block_type"], block.get("subject_id"),
            block.get("topic_id"), block["title"], block.get("description"),
            block.get("estimated_mins", 10), block.get("display_order", 0),
            block.get("content_ids", []), block.get("is_optional", False),
            block.get("mode", "focus"),
            # dict cru: o pool registra codec de jsonb (ver prf/app.py), então
            # serializar aqui gravaria a string dentro de um JSON.
            block.get("payload") or {},
            block.get("unit_key"),
        )

    async def complete_mission_block(self, block_id: UUID) -> dict:
        await self._execute(
            """UPDATE mission_blocks SET is_completed = TRUE, completed_at = NOW()
               WHERE id = $1""",
            block_id,
        )
        block = await self._fetchrow("SELECT * FROM mission_blocks WHERE id = $1", block_id)
        if block:
            await self._execute(
                """UPDATE daily_missions SET blocks_done = blocks_done + 1
                   WHERE id = $1""",
                block["mission_id"],
            )
        return block

    async def complete_mission(self, mission_id: UUID, actual_mins: int, xp: int):
        await self._execute(
            """UPDATE daily_missions SET
                   status = 'completed', actual_mins = $2,
                   xp_earned = $3, completed_at = NOW()
               WHERE id = $1""",
            mission_id, actual_mins, xp,
        )

    # ── Subject Mastery ───────────────────────────────────────────────────────

    async def get_subject_mastery(self, user_id: UUID) -> list[dict]:
        return await self._fetch(
            """SELECT sm.*, s.name as subject_name, s.slug as subject_slug,
                      s.weight_prf, s.weight_pm, s.color
               FROM subject_mastery sm
               JOIN subjects s ON s.id = sm.subject_id
               WHERE sm.user_id = $1 AND sm.topic_id IS NULL
               ORDER BY sm.mastery_level ASC""",
            user_id,
        )

    async def upsert_subject_mastery(self, user_id: UUID, subject_id: UUID, data: dict):
        await self._execute(
            """INSERT INTO subject_mastery (user_id, subject_id, total_attempts,
               total_correct, accuracy, mastery_level, last_studied, study_time_mins, error_count)
               VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8)
               ON CONFLICT (user_id, subject_id, topic_id) DO UPDATE SET
                   total_attempts = $3, total_correct = $4,
                   accuracy = $5, mastery_level = $6,
                   last_studied = NOW(), study_time_mins = $7,
                   error_count = $8, updated_at = NOW()""",
            user_id, subject_id,
            data.get("total_attempts", 0), data.get("total_correct", 0),
            data.get("accuracy", 0), data.get("mastery_level", 0),
            data.get("study_time_mins", 0), data.get("error_count", 0),
        )

    # ── Legal Library ─────────────────────────────────────────────────────────

    async def get_legal_documents(self) -> list[dict]:
        return await self._fetch(
            """SELECT ld.*, COUNT(la.id) as article_count
               FROM legal_documents ld
               LEFT JOIN legal_articles la ON la.document_id = ld.id
               GROUP BY ld.id ORDER BY ld.display_order"""
        )

    async def get_legal_articles(
        self, document_id: UUID | None = None, subject_id: UUID | None = None,
        search: str | None = None, limit: int = 50
    ) -> list[dict]:
        conditions = []
        params: list = []
        idx = 1

        if document_id:
            conditions.append(f"la.document_id = ${idx}")
            params.append(document_id)
            idx += 1
        if subject_id:
            conditions.append(f"la.subject_id = ${idx}")
            params.append(subject_id)
            idx += 1
        order_by = "la.display_order"

        if search:
            conditions.append(f"(la.official_text ILIKE ${idx} OR la.article_number ILIKE ${idx})")
            params.append(f"%{search}%")
            idx += 1

            # Com mais de 3.500 artigos, listar por ordem de exibição faz a busca
            # devolver o primeiro artigo que por acaso cita o termo, não o artigo
            # que trata dele: procurar "capacidade psicomotora alterada" trazia o
            # art. 303 do CTB, que só menciona a expressão num parágrafo, antes do
            # art. 306, que é o tipo penal. Ordenar por relevância de texto, e em
            # seguida por quão cedo o termo aparece, coloca o dispositivo certo no
            # topo — quanto mais perto do caput, mais o artigo é sobre aquilo.
            params.append(search)
            rank_idx = idx
            idx += 1
            params.append(search)
            pos_idx = idx
            idx += 1
            order_by = (
                f"ts_rank(to_tsvector('portuguese', la.official_text),"
                f"        plainto_tsquery('portuguese', ${rank_idx})) DESC,"
                f" NULLIF(position(lower(${pos_idx}) in lower(la.official_text)), 0)"
                f"        ASC NULLS LAST,"
                f" la.frequency_score DESC, la.display_order"
            )

        where = " AND ".join(conditions) if conditions else "TRUE"
        params.append(limit)

        return await self._fetch(
            f"""SELECT la.*, ld.name as document_name
                FROM legal_articles la
                JOIN legal_documents ld ON ld.id = la.document_id
                WHERE {where}
                ORDER BY {order_by} LIMIT ${idx}""",
            *params,
        )

    async def get_legal_article(self, article_id: UUID) -> Optional[dict]:
        return await self._fetchrow(
            """SELECT la.*, ld.name as document_name
               FROM legal_articles la
               JOIN legal_documents ld ON ld.id = la.document_id
               WHERE la.id = $1""",
            article_id,
        )

    async def get_legal_article_ids_by_subject(
        self, subject_id: UUID, limit: int = 5, user_id: UUID | None = None,
    ) -> list[UUID]:
        """Artigos de uma matéria para lei seca, priorizando cobertura.

        Sem isso a mesma dúzia de artigos de maior frequência era servida
        todo dia e o candidato nunca avançava pela lei — artigos ainda não
        lidos vêm primeiro; só volta a repetir os já lidos depois de
        esgotar os novos.
        """
        if user_id is not None:
            rows = await self._fetch(
                """SELECT la.id FROM legal_articles la
                   LEFT JOIN user_article_progress uap
                     ON uap.article_id = la.id AND uap.user_id = $3
                   WHERE la.subject_id = $1
                   ORDER BY (uap.read_count IS NULL OR uap.read_count = 0) DESC,
                            (la.simple_text IS NOT NULL AND la.simple_text != '') DESC,
                            COALESCE(uap.read_count, 0) ASC,
                            la.frequency_score DESC
                   LIMIT $2""",
                subject_id, limit, user_id,
            )
            return [r["id"] for r in rows]
        rows = await self._fetch(
            """SELECT id FROM legal_articles
               WHERE subject_id = $1
               ORDER BY (simple_text IS NOT NULL AND simple_text != '') DESC,
                        frequency_score DESC
               LIMIT $2""",
            subject_id, limit,
        )
        return [r["id"] for r in rows]

    async def get_legal_article_ids_by_topic(
        self, topic_id: UUID, limit: int = 15, user_id: UUID | None = None,
    ) -> list[UUID]:
        """Artigos de um tópico para a lei seca, na mesma lógica de cobertura
        usada por matéria: o que ainda não foi lido vem primeiro."""
        if user_id is not None:
            rows = await self._fetch(
                """SELECT la.id FROM legal_articles la
                   LEFT JOIN user_article_progress uap
                     ON uap.article_id = la.id AND uap.user_id = $3
                   WHERE la.topic_id = $1
                   ORDER BY (uap.read_count IS NULL OR uap.read_count = 0) DESC,
                            (la.simple_text IS NOT NULL AND la.simple_text != '') DESC,
                            COALESCE(uap.read_count, 0) ASC,
                            la.frequency_score DESC
                   LIMIT $2""",
                topic_id, limit, user_id,
            )
            return [r["id"] for r in rows]
        rows = await self._fetch(
            """SELECT id FROM legal_articles
                WHERE topic_id = $1
                ORDER BY (simple_text IS NOT NULL AND simple_text != '') DESC,
                         frequency_score DESC
                LIMIT $2""",
            topic_id, limit,
        )
        return [r["id"] for r in rows]

    async def pick_study_topic(self, user_id: UUID, subject_id: UUID) -> Optional[dict]:
        """Escolhe o tópico do dia dentro de uma matéria.

        Prioriza tópico que já tem episódio de áudio pronto e cujo material
        ainda não foi lido — é o que permite a missão encadear o mesmo
        assunto no áudio da ida, na lei seca da noite e nas questões
        seguintes, em vez de pular de tema a cada etapa.
        """
        return await self._fetchrow(
            """SELECT t.id, t.name, t.slug,
                      COALESCE(SUM(CASE WHEN uap.read_count > 0 THEN 1 ELSE 0 END), 0) AS lidos,
                      COUNT(la.id) AS total,
                      EXISTS (SELECT 1 FROM podcast_episodes pe
                               WHERE pe.topic_id = t.id AND pe.is_active = TRUE) AS tem_audio
                 FROM topics t
                 JOIN legal_articles la ON la.topic_id = t.id
                 LEFT JOIN user_article_progress uap
                        ON uap.article_id = la.id AND uap.user_id = $1
                WHERE t.subject_id = $2 AND t.is_active
                GROUP BY t.id, t.name, t.slug, t.weight, t.display_order
               HAVING COUNT(la.id) > 0
                ORDER BY tem_audio DESC,
                         (COALESCE(SUM(CASE WHEN uap.read_count > 0 THEN 1 ELSE 0 END), 0)::real
                          / GREATEST(COUNT(la.id), 1)) ASC,
                         t.weight DESC, t.display_order
                LIMIT 1""",
            user_id, subject_id,
        )

    async def get_topic_queue(
        self, user_id: UUID, subject_id: UUID, limit: int = 20,
    ) -> list[dict]:
        """Fila de tópicos de uma matéria, na mesma ordem que pick_study_topic
        escolheria — os menos lidos primeiro.

        É o que permite a tela de trajetória dizer "quarta é Crimes contra a
        Administração" sem chutar: o calendário projeta exatamente a fila que
        a missão vai consumir.
        """
        return await self._fetch(
            """SELECT t.id, t.name, t.slug,
                      COALESCE(SUM(CASE WHEN uap.read_count > 0 THEN 1 ELSE 0 END), 0) AS lidos,
                      COUNT(la.id) AS total,
                      EXISTS (SELECT 1 FROM podcast_episodes pe
                               WHERE pe.topic_id = t.id AND pe.is_active = TRUE) AS tem_audio
                 FROM topics t
                 JOIN legal_articles la ON la.topic_id = t.id
                 LEFT JOIN user_article_progress uap
                        ON uap.article_id = la.id AND uap.user_id = $1
                WHERE t.subject_id = $2 AND t.is_active
                GROUP BY t.id, t.name, t.slug, t.weight, t.display_order
               HAVING COUNT(la.id) > 0
                ORDER BY tem_audio DESC,
                         (COALESCE(SUM(CASE WHEN uap.read_count > 0 THEN 1 ELSE 0 END), 0)::real
                          / GREATEST(COUNT(la.id), 1)) ASC,
                         t.weight DESC, t.display_order
                LIMIT $3""",
            user_id, subject_id, limit,
        )

    async def toggle_bookmark(self, user_id: UUID, article_id: UUID, note: str | None = None) -> bool:
        existing = await self._fetchrow(
            "SELECT id FROM user_legal_bookmarks WHERE user_id = $1 AND article_id = $2",
            user_id, article_id,
        )
        if existing:
            await self._execute(
                "DELETE FROM user_legal_bookmarks WHERE id = $1", existing["id"]
            )
            return False
        await self._execute(
            """INSERT INTO user_legal_bookmarks (user_id, article_id, note)
               VALUES ($1, $2, $3)""",
            user_id, article_id, note,
        )
        return True

    # ── Law mastery ───────────────────────────────────────────────────────────

    async def record_article_read(self, user_id: UUID, article_id: UUID) -> dict:
        """Increment read count and update mastery score for an article."""
        row = await self._fetchrow(
            """INSERT INTO user_article_progress (user_id, article_id, read_count, last_read_at)
               VALUES ($1, $2, 1, NOW())
               ON CONFLICT (user_id, article_id) DO UPDATE
                 SET read_count   = user_article_progress.read_count + 1,
                     last_read_at = NOW(),
                     mastery_score = LEAST(1.0,
                         ROUND(
                             (user_article_progress.read_count + 1)::numeric / 5.0,
                             2
                         )
                     )
               RETURNING *""",
            user_id, article_id,
        )
        return dict(row) if row else {}

    async def record_article_error(self, user_id: UUID, article_id: UUID) -> dict:
        """Increment error count for an article (when user answers a related question wrong)."""
        row = await self._fetchrow(
            """INSERT INTO user_article_progress (user_id, article_id, error_count)
               VALUES ($1, $2, 1)
               ON CONFLICT (user_id, article_id) DO UPDATE
                 SET error_count = user_article_progress.error_count + 1
               RETURNING *""",
            user_id, article_id,
        )
        return dict(row) if row else {}

    async def get_article_progress(self, user_id: UUID, article_id: UUID) -> Optional[dict]:
        row = await self._fetchrow(
            "SELECT * FROM user_article_progress WHERE user_id = $1 AND article_id = $2",
            user_id, article_id,
        )
        return dict(row) if row else None

    async def get_user_article_mastery(self, user_id: UUID, limit: int = 50) -> list[dict]:
        """Return articles with the lowest mastery score (for focused review)."""
        rows = await self._fetch(
            """SELECT uap.*, la.article_number, la.official_text,
                      ld.name AS document_name, ld.slug AS document_slug
               FROM user_article_progress uap
               JOIN legal_articles la ON la.id = uap.article_id
               JOIN legal_documents ld ON ld.id = la.document_id
               WHERE uap.user_id = $1
               ORDER BY uap.mastery_score ASC, uap.error_count DESC
               LIMIT $2""",
            user_id, limit,
        )
        return [dict(r) for r in rows]

    async def get_weak_articles(self, user_id: UUID, limit: int = 10) -> list[dict]:
        """Articles with errors but low mastery — highest priority for review."""
        rows = await self._fetch(
            """SELECT uap.article_id, uap.mastery_score, uap.error_count, uap.read_count,
                      la.article_number, la.official_text,
                      ld.name AS document_name
               FROM user_article_progress uap
               JOIN legal_articles la ON la.id = uap.article_id
               JOIN legal_documents ld ON ld.id = la.document_id
               WHERE uap.user_id = $1 AND uap.error_count > 0
               ORDER BY (uap.error_count::real / GREATEST(uap.read_count, 1)) DESC,
                         uap.mastery_score ASC
               LIMIT $2""",
            user_id, limit,
        )
        return [dict(r) for r in rows]

    # ── Gamification ──────────────────────────────────────────────────────────

    async def get_streak(self, user_id: UUID) -> Optional[dict]:
        return await self._fetchrow(
            "SELECT * FROM user_streaks WHERE user_id = $1", user_id
        )

    async def update_streak(self, user_id: UUID) -> dict:
        _BRT = timezone(timedelta(hours=-3))
        today = datetime.now(_BRT).date()
        streak = await self.get_streak(user_id)
        if not streak:
            return await self._fetchrow(
                """INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_active_date)
                   VALUES ($1, 1, 1, $2) RETURNING *""",
                user_id, today,
            )

        last = streak["last_active_date"]
        if last == today:
            return streak

        if last == today - timedelta(days=1):
            new_current = streak["current_streak"] + 1
        else:
            new_current = 1

        new_longest = max(streak["longest_streak"], new_current)
        return await self._fetchrow(
            """UPDATE user_streaks SET
                   current_streak = $2, longest_streak = $3, last_active_date = $4
               WHERE user_id = $1 RETURNING *""",
            user_id, new_current, new_longest, today,
        )

    async def get_xp(self, user_id: UUID) -> Optional[dict]:
        return await self._fetchrow("SELECT * FROM user_xp WHERE user_id = $1", user_id)

    async def add_xp(self, user_id: UUID, amount: int, reason: str) -> dict:
        xp = await self.get_xp(user_id)
        if not xp:
            xp = await self._fetchrow(
                """INSERT INTO user_xp (user_id, total_xp, level, xp_to_next)
                   VALUES ($1, $2, 1, 100) RETURNING *""",
                user_id, amount,
            )
        else:
            new_total = xp["total_xp"] + amount
            level, xp_to_next = _compute_level(new_total)
            xp = await self._fetchrow(
                """UPDATE user_xp SET total_xp = $2, level = $3, xp_to_next = $4
                   WHERE user_id = $1 RETURNING *""",
                user_id, new_total, level, xp_to_next,
            )

        await self._execute(
            """INSERT INTO xp_transactions (user_id, amount, reason)
               VALUES ($1, $2, $3)""",
            user_id, amount, reason,
        )
        return xp

    async def get_achievements(self, user_id: UUID) -> list[dict]:
        return await self._fetch(
            """SELECT a.*, ua.unlocked_at,
                      CASE WHEN ua.id IS NOT NULL THEN TRUE ELSE FALSE END as unlocked
               FROM achievements a
               LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = $1
               ORDER BY a.display_order""",
            user_id,
        )

    # ── Analytics ─────────────────────────────────────────────────────────────

    _TODAY_BRT = "(NOW() AT TIME ZONE 'America/Sao_Paulo')::date"

    async def upsert_daily_analytics(self, user_id: UUID, data: dict):
        await self._execute(
            f"""INSERT INTO daily_analytics (user_id, date, study_minutes, questions_total,
               questions_correct, reviews_done, reviews_due, mission_completed,
               commute_minutes, xp_earned, subjects_studied, accuracy_by_subject)
               VALUES ($1, {self._TODAY_BRT}, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
               ON CONFLICT (user_id, date) DO UPDATE SET
                   study_minutes = $2, questions_total = $3, questions_correct = $4,
                   reviews_done = $5, reviews_due = $6, mission_completed = $7,
                   commute_minutes = $8, xp_earned = $9,
                   subjects_studied = $10, accuracy_by_subject = $11""",
            user_id, data.get("study_minutes", 0), data.get("questions_total", 0),
            data.get("questions_correct", 0), data.get("reviews_done", 0),
            data.get("reviews_due", 0), data.get("mission_completed", False),
            data.get("commute_minutes", 0), data.get("xp_earned", 0),
            data.get("subjects_studied", {}), data.get("accuracy_by_subject", {}),
        )

    async def increment_daily_question(self, user_id: UUID, is_correct: bool, time_secs: int = 0):
        """Atomically increment today's question count and study time."""
        await self._execute(
            f"""INSERT INTO daily_analytics
                    (user_id, date, questions_total, questions_correct, study_minutes)
                VALUES ($1, {self._TODAY_BRT}, 1, $2::int, $3)
                ON CONFLICT (user_id, date) DO UPDATE SET
                    questions_total   = daily_analytics.questions_total + 1,
                    questions_correct = daily_analytics.questions_correct + $2::int,
                    study_minutes     = daily_analytics.study_minutes + $3""",
            user_id, int(is_correct), round(time_secs / 60, 2),
        )

    async def increment_daily_review(self, user_id: UUID):
        """Atomically increment today's review count."""
        await self._execute(
            f"""INSERT INTO daily_analytics (user_id, date, reviews_done)
                VALUES ($1, {self._TODAY_BRT}, 1)
                ON CONFLICT (user_id, date) DO UPDATE SET
                    reviews_done = daily_analytics.reviews_done + 1""",
            user_id,
        )

    async def get_daily_analytics(self, user_id: UUID, days: int = 7) -> list[dict]:
        return await self._fetch(
            f"""SELECT * FROM daily_analytics
               WHERE user_id = $1 AND date >= {self._TODAY_BRT} - ($2::int)
               ORDER BY date ASC""",
            user_id, days,
        )

    async def get_today_analytics(self, user_id: UUID) -> Optional[dict]:
        return await self._fetchrow(
            f"SELECT * FROM daily_analytics WHERE user_id = $1 AND date = {self._TODAY_BRT}",
            user_id,
        )

    # ── Flashcards ────────────────────────────────────────────────────────────

    async def get_articles_full_for_topic(self, topic_id: UUID, limit: int = 200) -> list[dict]:
        """Artigos completos de um tópico, com highlights — insumo dos cartões."""
        return await self._fetch(
            """SELECT la.id, la.article_number, la.official_text, la.simple_text,
                      la.highlights, la.subject_id, la.topic_id,
                      ld.name AS document_name
                 FROM legal_articles la
                 JOIN legal_documents ld ON ld.id = la.document_id
                WHERE la.topic_id = $1 AND la.official_text IS NOT NULL
                ORDER BY la.frequency_score DESC, la.display_order
                LIMIT $2""",
            topic_id, limit,
        )

    async def bulk_insert_flashcards(self, cards: list[dict]) -> int:
        """Grava cartões do sistema, ignorando os que já existem.

        A chave de unicidade é (article_id, front): regerar o mesmo artigo
        não pode duplicar cartão, senão a repetição espaçada devolve o mesmo
        conteúdo várias vezes no mesmo dia.
        """
        if not cards:
            return 0
        gravados = 0
        for c in cards:
            row = await self._fetchrow(
                """INSERT INTO flashcards
                       (subject_id, topic_id, article_id, question_id,
                        front, back, source, tags)
                   SELECT $1, $2, $3, $4, $5, $6, $7, $8::jsonb
                    WHERE NOT EXISTS (
                        SELECT 1 FROM flashcards f
                         WHERE f.front = $5 AND f.is_active
                           AND (f.article_id = $3 OR ($3 IS NULL AND f.article_id IS NULL)))
                   RETURNING id""",
                c.get("subject_id"), c.get("topic_id"), c.get("article_id"),
                c.get("question_id"), c["front"], c["back"],
                c.get("source", "system"), json.dumps(c.get("tags", [])),
            )
            if row:
                gravados += 1
        return gravados

    async def count_flashcards_for_topic(self, topic_id: UUID) -> int:
        return await self._fetchval(
            "SELECT COUNT(*) FROM flashcards WHERE topic_id = $1 AND is_active",
            topic_id,
        ) or 0

    async def get_flashcard_ids_for_topic(
        self, topic_id: UUID, user_id: UUID | None = None, limit: int = 12,
    ) -> list[UUID]:
        """Cartões do tópico, priorizando o que ainda não foi visto.

        Sem isso a mesma dúzia de cartões volta todo dia — o mesmo problema
        que a lei seca tinha antes de olhar o histórico de leitura.
        """
        if user_id is None:
            rows = await self._fetch(
                """SELECT id FROM flashcards
                    WHERE topic_id = $1 AND is_active
                    ORDER BY random() LIMIT $2""",
                topic_id, limit,
            )
            return [r["id"] for r in rows]
        rows = await self._fetch(
            """SELECT f.id FROM flashcards f
                LEFT JOIN review_cards rc
                       ON rc.flashcard_id = f.id AND rc.user_id = $2
               WHERE f.topic_id = $1 AND f.is_active
               ORDER BY (rc.id IS NULL) DESC,
                        rc.next_review NULLS FIRST
               LIMIT $3""",
            topic_id, user_id, limit,
        )
        return [r["id"] for r in rows]

    async def get_flashcards_by_ids(self, ids: list[UUID]) -> list[dict]:
        if not ids:
            return []
        return await self._fetch(
            """SELECT f.id, f.front, f.back, f.tags, f.source,
                      s.name AS subject_name
                 FROM flashcards f
                 LEFT JOIN subjects s ON s.id = f.subject_id
                WHERE f.id = ANY($1::uuid[]) AND f.is_active""",
            ids,
        )

    async def ensure_review_card_for_flashcard(
        self, user_id: UUID, flashcard_id: UUID
    ) -> dict:
        """Cartão de revisão do flashcard, criando na primeira vez que ele é
        estudado — é o que liga o flashcard à repetição espaçada."""
        existing = await self._fetchrow(
            "SELECT * FROM review_cards WHERE user_id = $1 AND flashcard_id = $2",
            user_id, flashcard_id,
        )
        if existing:
            return existing
        return await self._fetchrow(
            """INSERT INTO review_cards (user_id, flashcard_id, next_review)
               VALUES ($1, $2, NOW())
               RETURNING *""",
            user_id, flashcard_id,
        )

    async def get_error_flashcard_ids(self, user_id: UUID, limit: int = 10) -> list[UUID]:
        rows = await self._fetch(
            """SELECT f.id FROM flashcards f
               JOIN error_notebook en ON en.flashcard_id = f.id
               WHERE en.user_id = $1 AND en.resolved = FALSE
               ORDER BY en.last_error_at DESC LIMIT $2""",
            user_id, limit,
        )
        return [r["id"] for r in rows]

    # ── Audio Lessons ─────────────────────────────────────────────────────────

    async def get_audio_lessons(
        self, subject_id: UUID | None = None, limit: int = 10
    ) -> list[dict]:
        if subject_id:
            return await self._fetch(
                """SELECT * FROM audio_lessons
                   WHERE subject_id = $1 AND is_active = TRUE
                   ORDER BY display_order LIMIT $2""",
                subject_id, limit,
            )
        return await self._fetch(
            "SELECT * FROM audio_lessons WHERE is_active = TRUE ORDER BY display_order LIMIT $1",
            limit,
        )

    async def get_commute_lesson_ids(self, limit: int = 5) -> list[UUID]:
        rows = await self._fetch(
            "SELECT id FROM audio_lessons WHERE is_active = TRUE ORDER BY RANDOM() LIMIT $1",
            limit,
        )
        return [r["id"] for r in rows]

    # ── Podcast (episódios em diálogo) ────────────────────────────────────────

    async def create_podcast_episode(self, data: dict) -> dict:
        """Grava um episódio. `turns` vai como JSON string — asyncpg não
        converte list/dict de Python para jsonb sozinho."""
        row = await self._fetchrow(
            """INSERT INTO podcast_episodes
                   (subject_id, topic_id, title, topic, description, turns,
                    segment_count, duration_secs, word_count,
                    kind, part, total_parts, parent_episode_id, unit_slug)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9,
                       $10, $11, $12, $13, $14)
               RETURNING id, subject_id, topic_id, title, topic, kind, part,
                         total_parts, segment_count, duration_secs, word_count""",
            data.get("subject_id"), data.get("topic_id"), data["title"], data["topic"],
            data.get("description"), json.dumps(data.get("turns", [])),
            data.get("segment_count", 0), data.get("duration_secs", 0),
            data.get("word_count", 0),
            data.get("kind", "aula"), data.get("part", 1),
            data.get("total_parts", 1), data.get("parent_episode_id"),
            data.get("unit_slug"),
        )
        return dict(row) if row else {}

    async def get_next_topic_without_episode(self, is_pm: bool = True) -> Optional[dict]:
        """Próximo tópico do edital sem episódio, do mais pesado para o mais
        leve. O peso do tópico entra multiplicado pelo peso da matéria: um
        tópico forte de uma matéria fraca não deve passar na frente de um
        tópico forte da matéria que vale mais pontos na prova."""
        weight_col = "weight_pm" if is_pm else "weight_prf"
        return await self._fetchrow(
            f"""SELECT t.id, t.name, t.slug, t.subject_id, s.name AS subject_name
                  FROM topics t
                  JOIN subjects s ON s.id = t.subject_id
                 WHERE t.is_active AND s.{weight_col} > 0
                   AND EXISTS (
                       SELECT 1 FROM legal_articles la WHERE la.topic_id = t.id)
                   AND NOT EXISTS (
                       SELECT 1 FROM podcast_episodes pe
                        WHERE pe.topic_id = t.id AND pe.is_active = TRUE)
                 ORDER BY (t.weight * s.{weight_col}) DESC, t.display_order
                 LIMIT 1"""
        )

    async def count_topics_without_episode(self, is_pm: bool = True) -> int:
        weight_col = "weight_pm" if is_pm else "weight_prf"
        return await self._fetchval(
            f"""SELECT COUNT(*) FROM topics t
                  JOIN subjects s ON s.id = t.subject_id
                 WHERE t.is_active AND s.{weight_col} > 0
                   AND EXISTS (
                       SELECT 1 FROM legal_articles la WHERE la.topic_id = t.id)
                   AND NOT EXISTS (
                       SELECT 1 FROM podcast_episodes pe
                        WHERE pe.topic_id = t.id AND pe.is_active = TRUE)"""
        ) or 0

    async def get_articles_for_topic(self, topic_id: UUID, limit: int = 22) -> list[dict]:
        """Artigos de um tópico para servir de base à aula, os mais cobrados
        primeiro. A aula lê o texto oficial, então ele vem junto."""
        return await self._fetch(
            """SELECT la.id, la.article_number, la.title, la.official_text,
                      la.simple_text, ld.name AS document_name
                 FROM legal_articles la
                 JOIN legal_documents ld ON ld.id = la.document_id
                WHERE la.topic_id = $1 AND la.official_text IS NOT NULL
                ORDER BY la.frequency_score DESC, la.display_order
                LIMIT $2""",
            topic_id, limit,
        )

    async def get_topics_for_podcast(self, is_pm: bool = True) -> list[dict]:
        """Tópicos com lei mapeada, com volume de material e slug da matéria.

        O volume é o insumo do plano de partes: quem decide a duração da aula
        é a quantidade de texto legal a ler e comentar, não o número de artigos.
        """
        weight_col = "weight_pm" if is_pm else "weight_prf"
        return await self._fetch(
            f"""SELECT t.id, t.name, t.slug, t.subject_id,
                       s.name AS subject_name, s.slug AS subject_slug,
                       s.{weight_col} AS peso,
                       COUNT(la.id) AS artigos,
                       COALESCE(SUM(length(la.official_text)), 0) AS chars
                  FROM topics t
                  JOIN subjects s ON s.id = t.subject_id
                  JOIN legal_articles la ON la.topic_id = t.id
                 WHERE t.is_active AND s.{weight_col} > 0
                 GROUP BY t.id, t.name, t.slug, t.subject_id, s.name, s.slug, s.{weight_col}
                 ORDER BY s.{weight_col} DESC, t.display_order"""
        )

    async def get_articles_for_topics(
        self, topic_ids: list[UUID], limit: int = 200
    ) -> list[dict]:
        """Artigos de uma unidade de aula, ordenados por incidência na prova.

        A ordem importa porque o plano de partes corta no teto: o que fica
        dentro das primeiras partes tem de ser o material mais cobrado. A
        contagem de questões que citam o artigo entra junto do
        frequency_score porque este último nem sempre está preenchido.
        """
        return await self._fetch(
            """SELECT la.id, la.article_number, la.title, la.official_text,
                      la.simple_text, la.frequency_score, ld.name AS document_name,
                      (SELECT COUNT(*) FROM questions q
                        WHERE q.legal_article_id = la.id AND q.is_active) AS n_questoes
                 FROM legal_articles la
                 JOIN legal_documents ld ON ld.id = la.document_id
                WHERE la.topic_id = ANY($1::uuid[])
                  AND la.official_text IS NOT NULL AND length(la.official_text) > 40
                ORDER BY (SELECT COUNT(*) FROM questions q
                           WHERE q.legal_article_id = la.id AND q.is_active) DESC,
                         la.frequency_score DESC,
                         la.display_order
                LIMIT $2""",
            topic_ids, limit,
        )

    async def get_existing_episode_units(self) -> list[dict]:
        return await self._fetch(
            """SELECT unit_slug, part, kind, id, topic_id
                 FROM podcast_episodes
                WHERE is_active = TRUE AND unit_slug IS NOT NULL"""
        )

    async def get_aula_without_drill(self) -> Optional[dict]:
        """Próxima aula que ainda não tem o drill da volta."""
        return await self._fetchrow(
            """SELECT pe.id, pe.title, pe.topic, pe.subject_id, pe.topic_id,
                      pe.unit_slug, pe.part, pe.total_parts,
                      s.name AS subject_name
                 FROM podcast_episodes pe
                 LEFT JOIN subjects s ON s.id = pe.subject_id
                WHERE pe.is_active AND pe.kind = 'aula'
                  AND NOT EXISTS (
                      SELECT 1 FROM podcast_episodes d
                       WHERE d.parent_episode_id = pe.id
                         AND d.kind = 'drill' AND d.is_active)
                ORDER BY pe.created_at
                LIMIT 1"""
        )

    async def get_drill_for_aula(self, aula_id: UUID) -> Optional[UUID]:
        return await self._fetchval(
            """SELECT id FROM podcast_episodes
                WHERE parent_episode_id = $1 AND kind = 'drill' AND is_active
                LIMIT 1""",
            aula_id,
        )

    async def get_next_aula_for_topic(
        self, topic_id: UUID, user_id: UUID | None = None
    ) -> Optional[dict]:
        """Próxima aula do tópico na ordem das partes."""
        return await self._fetchrow(
            """SELECT id, title, part, total_parts, duration_secs
                 FROM podcast_episodes
                WHERE topic_id = $1 AND kind = 'aula' AND is_active
                ORDER BY part
                LIMIT 1""",
            topic_id,
        )

    async def get_episode_ids_for_topic(self, topic_id: UUID, limit: int = 2) -> list[UUID]:
        rows = await self._fetch(
            """SELECT id FROM podcast_episodes
                WHERE topic_id = $1 AND is_active = TRUE
                ORDER BY created_at LIMIT $2""",
            topic_id, limit,
        )
        return [r["id"] for r in rows]

    async def get_podcast_episodes(
        self, subject_id: UUID | None = None, limit: int = 50
    ) -> list[dict]:
        """Lista episódios sem o campo `turns` — o roteiro inteiro é pesado
        e a listagem só precisa dos metadados."""
        if subject_id:
            return await self._fetch(
                """SELECT pe.id, pe.subject_id, pe.title, pe.topic, pe.description,
                          pe.segment_count, pe.duration_secs, pe.created_at,
                          s.name AS subject_name
                     FROM podcast_episodes pe
                     LEFT JOIN subjects s ON s.id = pe.subject_id
                    WHERE pe.is_active = TRUE AND pe.subject_id = $1
                    ORDER BY pe.created_at DESC LIMIT $2""",
                subject_id, limit,
            )
        return await self._fetch(
            """SELECT pe.id, pe.subject_id, pe.title, pe.topic, pe.description,
                      pe.segment_count, pe.duration_secs, pe.created_at,
                      s.name AS subject_name
                 FROM podcast_episodes pe
                 LEFT JOIN subjects s ON s.id = pe.subject_id
                WHERE pe.is_active = TRUE
                ORDER BY pe.created_at DESC LIMIT $1""",
            limit,
        )

    async def get_podcast_episode(self, episode_id: UUID) -> Optional[dict]:
        row = await self._fetchrow(
            "SELECT * FROM podcast_episodes WHERE id = $1", episode_id
        )
        if not row:
            return None
        ep = dict(row)
        turns = ep.get("turns")
        if isinstance(turns, str):
            ep["turns"] = json.loads(turns)
        return ep

    async def get_podcast_segment_audio(self, episode_id: UUID, seq: int) -> Optional[bytes]:
        return await self._fetchval(
            "SELECT audio FROM podcast_segments WHERE episode_id = $1 AND seq = $2",
            episode_id, seq,
        )

    async def save_podcast_segment_audio(
        self, episode_id: UUID, seq: int, audio: bytes, duration_secs: int = 0
    ) -> None:
        await self._execute(
            """INSERT INTO podcast_segments (episode_id, seq, audio, duration_secs)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (episode_id, seq) DO UPDATE
                 SET audio = $3, duration_secs = $4""",
            episode_id, seq, audio, duration_secs,
        )

    async def get_podcast_segments_cached(self, episode_id: UUID) -> dict[int, dict]:
        """Segmentos já sintetizados de um episódio, por seq.

        Usado para montar o episódio inteiro num arquivo só: o player não
        deve depender de o JS acordar no fim de cada parte pra buscar a
        próxima, porque a tela pode estar bloqueada nesse instante."""
        rows = await self._fetch(
            """SELECT seq, audio, duration_secs FROM podcast_segments
               WHERE episode_id = $1 ORDER BY seq""",
            episode_id,
        )
        return {r["seq"]: {"audio": r["audio"], "duration_secs": r["duration_secs"]} for r in rows}

    async def podcast_topic_exists(self, subject_id: UUID | None, topic: str) -> bool:
        return bool(await self._fetchval(
            """SELECT 1 FROM podcast_episodes
                WHERE is_active = TRUE AND topic = $1
                  AND (subject_id = $2 OR ($2 IS NULL AND subject_id IS NULL))
                LIMIT 1""",
            topic, subject_id,
        ))

    # ── Notifications ─────────────────────────────────────────────────────────

    async def get_notification_prefs(self, user_id: UUID) -> Optional[dict]:
        return await self._fetchrow(
            "SELECT * FROM notification_preferences WHERE user_id = $1", user_id
        )

    async def create_notification(self, user_id: UUID, data: dict) -> dict:
        return await self._fetchrow(
            """INSERT INTO notification_queue (user_id, type, title, body, data, scheduled_for)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING *""",
            user_id, data["type"], data["title"], data["body"],
            data.get("data", {}), data.get("scheduled_for"),
        )

    async def get_pending_notifications(self, user_id: UUID) -> list[dict]:
        return await self._fetch(
            """SELECT * FROM notification_queue
               WHERE user_id = $1 AND is_sent = FALSE
               ORDER BY scheduled_for ASC NULLS LAST""",
            user_id,
        )

    # ── Tutor Conversations ──────────────────────────────────────────────────

    async def create_tutor_conversation(self, user_id: UUID, data: dict) -> dict:
        return await self._fetchrow(
            """INSERT INTO tutor_conversations (user_id, question_id, article_id, context)
               VALUES ($1, $2::uuid, $3::uuid, $4) RETURNING *""",
            user_id, data.get("question_id"), data.get("article_id"), data.get("context"),
        )

    async def update_tutor_conversation(self, conv_id: UUID, messages: list, outcome: str | None = None):
        await self._execute(
            """UPDATE tutor_conversations SET
                   messages = $2::jsonb,
                   outcome = $3::text,
                   ended_at = CASE WHEN $3::text IS NOT NULL THEN NOW() ELSE ended_at END
               WHERE id = $1""",
            conv_id, messages, outcome,
        )

    # ── Approval Estimates ────────────────────────────────────────────────────

    async def save_approval_estimate(self, user_id: UUID, data: dict):
        await self._execute(
            """INSERT INTO approval_estimates (user_id, probability, factors, trend, notes)
               VALUES ($1, $2, $3, $4, $5)""",
            user_id, data["probability"], data["factors"],
            data.get("trend"), data.get("notes"),
        )

    async def get_latest_approval_estimate(self, user_id: UUID) -> Optional[dict]:
        return await self._fetchrow(
            """SELECT * FROM approval_estimates
               WHERE user_id = $1 ORDER BY estimated_at DESC LIMIT 1""",
            user_id,
        )


def _compute_level(total_xp: int) -> tuple[int, int]:
    """Compute level and XP needed for next level."""
    level = 1
    threshold = 100
    remaining = total_xp
    while remaining >= threshold:
        remaining -= threshold
        level += 1
        threshold = int(threshold * 1.3)
    return level, threshold - remaining
