"""
Database seeder — populates initial data for the PRF platform.
Supports incremental loading from JSON files.
"""
from __future__ import annotations
import json
import logging
from uuid import UUID

import asyncpg

from prf.seeds.seed_data import (
    SUBJECTS, TOPICS, LEGAL_DOCUMENTS, ACHIEVEMENTS, ESSAY_THEMES,
)
from prf.seeds.audio_lessons import AUDIO_LESSONS
from prf.seeds.loader import load_questions, load_articles

logger = logging.getLogger(__name__)

# Shortest text that can still be a judgeable Certo/Errado item. Below this the
# entry is an orphaned multiple-choice alternative, not a question.
MIN_ITEM_CHARS = 80

# Quantos artigos um único boot pode gravar. O seed roda dentro do startup, que
# na Vercel segura a primeira requisição: escrever os 3.529 de uma vez estoura o
# tempo limite da função e derruba o boot inteiro. Com o teto, cada boot grava um
# pedaço e o acervo converge em poucas execuções — ou de uma vez, pelo endpoint
# de manutenção, que roda sem limite.
MAX_ARTICLE_WRITES_PER_BOOT = 400


async def seed_prf_database(pool: asyncpg.Pool):
    """Run all seed operations. Fully idempotent via ON CONFLICT."""
    logger.info("[PRF] Seeding database...")

    subject_map = await _seed_subjects(pool)
    topic_map = await _seed_topics(pool, subject_map)
    doc_map = await _seed_legal_documents(pool)
    await _seed_legal_articles_from_json(pool, doc_map, subject_map, topic_map)
    await _seed_questions_from_json(pool, subject_map, topic_map)
    await _seed_achievements(pool)
    await _seed_essay_themes(pool)
    await _seed_audio_lessons(pool, subject_map)

    logger.info("[PRF] Seed complete.")
    return True


async def _seed_subjects(pool: asyncpg.Pool) -> dict[str, UUID]:
    subject_map = {}
    async with pool.acquire() as conn:
        for s in SUBJECTS:
            is_active = s.get("is_active", True)
            row = await conn.fetchrow(
                """INSERT INTO subjects (name, slug, description, weight_prf, weight_pm, color, icon, display_order, is_active)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                   ON CONFLICT (slug) DO UPDATE SET
                     name = $1, weight_prf = $4, weight_pm = $5,
                     is_active = $9, display_order = $8
                   RETURNING id""",
                s["name"], s["slug"], s.get("description"),
                s.get("weight_prf", 1.0), s.get("weight_pm", 0.0),
                s.get("color"), s.get("icon"),
                s.get("display_order", 0), is_active,
            )
            subject_map[s["slug"]] = row["id"]
    logger.info(f"[PRF] Seeded {len(subject_map)} subjects")
    return subject_map


async def _seed_topics(pool: asyncpg.Pool, subject_map: dict[str, UUID]) -> dict[str, UUID]:
    topic_map = {}
    async with pool.acquire() as conn:
        for subject_slug, topics in TOPICS.items():
            subject_id = subject_map.get(subject_slug)
            if not subject_id:
                continue
            for i, t in enumerate(topics):
                row = await conn.fetchrow(
                    """INSERT INTO topics (subject_id, name, slug, weight, display_order)
                       VALUES ($1, $2, $3, $4, $5)
                       ON CONFLICT (subject_id, slug) DO UPDATE SET name = $2
                       RETURNING id""",
                    subject_id, t["name"], t["slug"],
                    t.get("weight", 1.0), i,
                )
                key = f"{subject_slug}:{t['slug']}"
                topic_map[key] = row["id"]
    logger.info(f"[PRF] Seeded {len(topic_map)} topics")
    return topic_map


async def _seed_legal_documents(pool: asyncpg.Pool) -> dict[str, UUID]:
    doc_map = {}
    async with pool.acquire() as conn:
        for d in LEGAL_DOCUMENTS:
            row = await conn.fetchrow(
                """INSERT INTO legal_documents (name, slug, abbreviation, display_order)
                   VALUES ($1, $2, $3, $4)
                   ON CONFLICT (slug) DO UPDATE SET name = $1
                   RETURNING id""",
                d["name"], d["slug"], d.get("abbreviation"),
                d.get("display_order", 0),
            )
            doc_map[d["slug"]] = row["id"]
    logger.info(f"[PRF] Seeded {len(doc_map)} legal documents")
    return doc_map


async def _seed_legal_articles_from_json(
    pool: asyncpg.Pool, doc_map: dict[str, UUID],
    subject_map: dict[str, UUID], topic_map: dict[str, UUID],
    max_writes: int | None = MAX_ARTICLE_WRITES_PER_BOOT,
):
    articles = load_articles()
    if not articles:
        logger.info("[PRF] No article JSON files found, skipping")
        return

    async with pool.acquire() as conn:
        # A lei seca passa de 3.500 artigos e o seeder roda em todo cold start.
        # Uma ida ao banco por artigo levaria a inicialização a estourar o tempo
        # limite da função, então o que já está gravado é carregado de uma vez e
        # só o que mudou de fato é reescrito — em regime normal, nada é.
        existing = {
            (r["document_id"], r["article_number"]): (r["len"], r["topic_id"])
            for r in await conn.fetch(
                "SELECT document_id, article_number, topic_id,"
                "       length(official_text) AS len"
                "  FROM legal_articles"
            )
        }

        rows = []
        for order, a in enumerate(articles):
            doc_id = doc_map.get(a["document_slug"])
            if not doc_id:
                continue
            text = a["official_text"]

            topic_key = (
                f"{a.get('subject_slug')}:{a.get('topic_slug')}"
                if a.get("topic_slug") else None
            )
            topic_id = topic_map.get(topic_key) if topic_key else None

            # O tópico entra na comparação junto com o texto. Conferir só o
            # tamanho fazia com que vincular um artigo já gravado a um tópico
            # do edital nunca chegasse ao banco — a trilha mostrava 15 dos 95
            # artigos de Infrações porque o texto deles não havia mudado.
            if existing.get((doc_id, a["article_number"])) == (len(text), topic_id):
                continue

            rows.append((
                doc_id, subject_map.get(a.get("subject_slug")), topic_id,
                a["article_number"], a.get("chapter"), text,
                a.get("simple_text"), a.get("highlights") or [],
                float(a.get("frequency_score") or 0), order,
            ))

        pending_total = len(rows)
        if max_writes is not None and len(rows) > max_writes:
            rows = rows[:max_writes]

        for start in range(0, len(rows), 200):
            async with conn.transaction():
                await conn.executemany(
                    """INSERT INTO legal_articles
                       (document_id, subject_id, topic_id, article_number, chapter,
                        official_text, simple_text, highlights, frequency_score, display_order)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                       ON CONFLICT (document_id, article_number) DO UPDATE SET
                         official_text = EXCLUDED.official_text,
                         chapter = EXCLUDED.chapter,
                         simple_text = COALESCE(EXCLUDED.simple_text, legal_articles.simple_text),
                         highlights = EXCLUDED.highlights,
                         frequency_score = EXCLUDED.frequency_score,
                         subject_id = EXCLUDED.subject_id,
                         topic_id = EXCLUDED.topic_id""",
                    rows[start:start + 200],
                )

    remaining = pending_total - len(rows)
    logger.info(
        f"[PRF] Legal articles: {len(rows)} gravados, {remaining} pendentes, "
        f"{len(articles) - pending_total} já em dia"
    )
    return {"written": len(rows), "remaining": remaining, "total": len(articles)}


async def _seed_questions_from_json(
    pool: asyncpg.Pool, subject_map: dict[str, UUID], topic_map: dict[str, UUID],
):
    questions = load_questions()
    if not questions:
        logger.info("[PRF] No question JSON files found, skipping")
        return

    count = 0
    skipped = 0
    async with pool.acquire() as conn:
        # Mesma razão dos artigos: consultar o banco uma vez por questão fazia o
        # cold start pagar 1.700 idas de rede antes de servir a primeira request.
        existing = {
            (r["subject_id"], r["text"]): r["context_text"]
            for r in await conn.fetch("SELECT subject_id, text, context_text FROM questions")
        }

        pending = []
        for q in questions:
            subject_id = subject_map.get(q["subject_slug"])
            if not subject_id:
                skipped += 1
                continue

            # A CEBRASPE item is a full assertion. Anything this short is
            # a leftover multiple-choice alternative that lost its stem,
            # and cannot be judged Certo or Errado — never seed one.
            text = q.get("text") or ""
            if len(text) < MIN_ITEM_CHARS:
                skipped += 1
                continue

            key = (subject_id, text)
            if key in existing:
                # Só reescreve quando o texto-base do seed realmente mudou.
                if q.get("context_text") and existing[key] != q.get("context_text"):
                    await conn.execute(
                        "UPDATE questions SET context_text = $1 WHERE subject_id = $2 AND text = $3",
                        q.get("context_text"), subject_id, text,
                    )
                skipped += 1
                continue

            topic_key = (
                f"{q['subject_slug']}:{q.get('topic_slug')}" if q.get("topic_slug") else None
            )
            pending.append((q, subject_id, topic_map.get(topic_key) if topic_key else None))

        for start in range(0, len(pending), 50):
            async with conn.transaction():
                for q, subject_id, topic_id in pending[start:start + 50]:
                    question_id = await conn.fetchval(
                        """INSERT INTO questions
                           (subject_id, topic_id, question_type, context_text,
                            text, difficulty, source, year,
                            examiner, explanation, legal_basis)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                           RETURNING id""",
                        subject_id, topic_id,
                        q.get("question_type", "certo_errado"),
                        q.get("context_text"),
                        q["text"],
                        q.get("difficulty", "medium"),
                        q.get("source"), q.get("year"), q.get("examiner"),
                        q.get("explanation"), q.get("legal_basis"),
                    )
                    alts = q.get("alternatives") or []
                    if alts:
                        await conn.executemany(
                            """INSERT INTO question_alternatives
                               (question_id, letter, text, is_correct, explanation, display_order)
                               VALUES ($1, $2, $3, $4, $5, $6)""",
                            [(question_id, a["letter"], a["text"], a.get("is_correct", False),
                              a.get("explanation"), i) for i, a in enumerate(alts)],
                        )
                    count += 1

    logger.info(f"[PRF] Seeded {count} questions ({skipped} skipped)")


async def _seed_achievements(pool: asyncpg.Pool):
    count = 0
    async with pool.acquire() as conn:
        for a in ACHIEVEMENTS:
            await conn.execute(
                """INSERT INTO achievements (slug, name, description, category,
                   xp_reward, condition_json, display_order)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)
                   ON CONFLICT (slug) DO NOTHING""",
                a["slug"], a["name"], a["description"],
                a["category"], a.get("xp_reward", 0),
                a["condition_json"], count,
            )
            count += 1
    logger.info(f"[PRF] Seeded {count} achievements")


async def _seed_essay_themes(pool: asyncpg.Pool):
    count = 0
    async with pool.acquire() as conn:
        for t in ESSAY_THEMES:
            existing = await conn.fetchval(
                "SELECT id FROM essay_themes WHERE title = $1", t["title"],
            )
            if existing:
                continue
            await conn.execute(
                """INSERT INTO essay_themes (title, description, context_text, subject_area, source, year)
                   VALUES ($1, $2, $3, $4, $5, $6)""",
                t["title"], t.get("description"), t["context_text"],
                t.get("subject_area"), t.get("source"), t.get("year"),
            )
            count += 1
    logger.info(f"[PRF] Seeded {count} essay themes")


async def _seed_audio_lessons(pool: asyncpg.Pool, subject_map: dict[str, UUID]):
    count = 0
    async with pool.acquire() as conn:
        for lesson in AUDIO_LESSONS:
            existing = await conn.fetchval(
                "SELECT id FROM audio_lessons WHERE title = $1", lesson["title"],
            )
            if existing:
                continue
            await conn.execute(
                """INSERT INTO audio_lessons
                     (subject_id, title, description, script, duration_secs,
                      lesson_type, difficulty, display_order, is_active)
                   VALUES ($1, $2, $3, $4, $5, $6, $7::difficulty_level, $8, TRUE)""",
                subject_map.get(lesson["subject_slug"]),
                lesson["title"], lesson.get("description"), lesson["script"],
                lesson.get("duration_secs"), lesson.get("lesson_type", "summary"),
                lesson.get("difficulty", "medium"), lesson.get("display_order", 0),
            )
            count += 1
    logger.info(f"[PRF] Seeded {count} audio lessons")
