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
from prf.seeds.loader import load_questions, load_articles

logger = logging.getLogger(__name__)


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

    logger.info("[PRF] Seed complete.")
    return True


async def _seed_subjects(pool: asyncpg.Pool) -> dict[str, UUID]:
    subject_map = {}
    async with pool.acquire() as conn:
        for s in SUBJECTS:
            row = await conn.fetchrow(
                """INSERT INTO subjects (name, slug, description, weight_prf, color, icon, display_order)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)
                   ON CONFLICT (slug) DO UPDATE SET name = $1, weight_prf = $4
                   RETURNING id""",
                s["name"], s["slug"], s.get("description"),
                s.get("weight_prf", 1.0), s.get("color"), s.get("icon"),
                s.get("display_order", 0),
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
):
    articles = load_articles()
    if not articles:
        logger.info("[PRF] No article JSON files found, skipping")
        return

    count = 0
    async with pool.acquire() as conn:
        for batch_start in range(0, len(articles), 50):
            batch = articles[batch_start:batch_start + 50]
            async with conn.transaction():
                for a in batch:
                    doc_id = doc_map.get(a["document_slug"])
                    subject_id = subject_map.get(a.get("subject_slug"))
                    topic_key = f"{a.get('subject_slug')}:{a.get('topic_slug')}" if a.get("topic_slug") else None
                    topic_id = topic_map.get(topic_key) if topic_key else None
                    if not doc_id:
                        continue

                    await conn.execute(
                        """INSERT INTO legal_articles
                           (document_id, subject_id, topic_id, article_number, chapter,
                            official_text, simple_text, highlights, frequency_score, display_order)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                           ON CONFLICT (document_id, article_number) DO UPDATE SET
                             official_text = EXCLUDED.official_text,
                             simple_text = EXCLUDED.simple_text,
                             highlights = EXCLUDED.highlights,
                             frequency_score = EXCLUDED.frequency_score,
                             subject_id = EXCLUDED.subject_id,
                             topic_id = EXCLUDED.topic_id""",
                        doc_id, subject_id, topic_id, a["article_number"],
                        a.get("chapter"), a["official_text"],
                        a.get("simple_text"), json.dumps(a.get("highlights", [])),
                        a.get("frequency_score", 0), count,
                    )
                    count += 1
    logger.info(f"[PRF] Seeded {count} legal articles")


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
        for batch_start in range(0, len(questions), 50):
            batch = questions[batch_start:batch_start + 50]
            async with conn.transaction():
                for q in batch:
                    subject_id = subject_map.get(q["subject_slug"])
                    if not subject_id:
                        skipped += 1
                        continue

                    topic_key = f"{q['subject_slug']}:{q.get('topic_slug')}" if q.get("topic_slug") else None
                    topic_id = topic_map.get(topic_key) if topic_key else None

                    existing = await conn.fetchval(
                        "SELECT id FROM questions WHERE subject_id = $1 AND text = $2",
                        subject_id, q["text"],
                    )
                    if existing:
                        skipped += 1
                        continue

                    row = await conn.fetchrow(
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
                    question_id = row["id"]

                    for i, alt in enumerate(q.get("alternatives", [])):
                        await conn.execute(
                            """INSERT INTO question_alternatives
                               (question_id, letter, text, is_correct, explanation, display_order)
                               VALUES ($1, $2, $3, $4, $5, $6)""",
                            question_id, alt["letter"], alt["text"],
                            alt.get("is_correct", False), alt.get("explanation"), i,
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
                json.dumps(a["condition_json"]), count,
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
