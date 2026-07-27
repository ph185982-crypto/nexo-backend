"""
Database seeder — populates initial data for the PRF platform.
"""
from __future__ import annotations
import json
import logging
from uuid import UUID

import asyncpg

from prf.seeds.seed_data import (
    SUBJECTS, TOPICS, LEGAL_DOCUMENTS,
    SAMPLE_LEGAL_ARTICLES, SAMPLE_QUESTIONS, ACHIEVEMENTS,
)

logger = logging.getLogger(__name__)


async def seed_prf_database(pool: asyncpg.Pool):
    """Run all seed operations. Idempotent — skips if data exists."""
    async with pool.acquire() as conn:
        count = await conn.fetchval("SELECT COUNT(*) FROM subjects")
        if count > 0:
            logger.info("[PRF] Seed data already exists, skipping.")
            return False

    logger.info("[PRF] Seeding database...")

    subject_map = await _seed_subjects(pool)
    topic_map = await _seed_topics(pool, subject_map)
    doc_map = await _seed_legal_documents(pool)
    await _seed_legal_articles(pool, doc_map, subject_map)
    await _seed_questions(pool, subject_map)
    await _seed_achievements(pool)

    logger.info("[PRF] Seed complete.")
    return True


async def _seed_subjects(pool: asyncpg.Pool) -> dict[str, UUID]:
    """Seed subjects and return slug→id map."""
    subject_map = {}
    async with pool.acquire() as conn:
        for s in SUBJECTS:
            row = await conn.fetchrow(
                """INSERT INTO subjects (name, slug, description, weight_prf, color, icon, display_order)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)
                   ON CONFLICT (slug) DO UPDATE SET name = $1
                   RETURNING id""",
                s["name"], s["slug"], s.get("description"),
                s.get("weight_prf", 1.0), s.get("color"), s.get("icon"),
                s.get("display_order", 0),
            )
            subject_map[s["slug"]] = row["id"]
    logger.info(f"[PRF] Seeded {len(subject_map)} subjects")
    return subject_map


async def _seed_topics(pool: asyncpg.Pool, subject_map: dict[str, UUID]) -> dict[str, UUID]:
    """Seed topics and return slug→id map."""
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
                topic_map[t["slug"]] = row["id"]
    logger.info(f"[PRF] Seeded {len(topic_map)} topics")
    return topic_map


async def _seed_legal_documents(pool: asyncpg.Pool) -> dict[str, UUID]:
    """Seed legal documents."""
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


async def _seed_legal_articles(
    pool: asyncpg.Pool, doc_map: dict[str, UUID], subject_map: dict[str, UUID]
):
    """Seed sample legal articles."""
    count = 0
    async with pool.acquire() as conn:
        for a in SAMPLE_LEGAL_ARTICLES:
            doc_id = doc_map.get(a["document_slug"])
            subject_id = subject_map.get(a.get("subject_slug"))
            if not doc_id:
                continue

            await conn.execute(
                """INSERT INTO legal_articles (document_id, subject_id, article_number,
                   chapter, official_text, simple_text, highlights, frequency_score, display_order)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
                doc_id, subject_id, a["article_number"],
                a.get("chapter"), a["official_text"],
                a.get("simple_text"), json.dumps(a.get("highlights", [])),
                a.get("frequency_score", 0), count,
            )
            count += 1
    logger.info(f"[PRF] Seeded {count} legal articles")


async def _seed_questions(pool: asyncpg.Pool, subject_map: dict[str, UUID]):
    """Seed sample questions."""
    count = 0
    async with pool.acquire() as conn:
        for q in SAMPLE_QUESTIONS:
            subject_id = subject_map.get(q["subject_slug"])
            if not subject_id:
                continue

            row = await conn.fetchrow(
                """INSERT INTO questions (subject_id, text, difficulty, source, year,
                   examiner, explanation, legal_basis)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                   RETURNING id""",
                subject_id, q["text"], q.get("difficulty", "medium"),
                q.get("source"), q.get("year"), q.get("examiner"),
                q.get("explanation"), q.get("legal_basis"),
            )
            question_id = row["id"]

            for i, alt in enumerate(q.get("alternatives", [])):
                await conn.execute(
                    """INSERT INTO question_alternatives (question_id, letter, text,
                       is_correct, explanation, display_order)
                       VALUES ($1, $2, $3, $4, $5, $6)""",
                    question_id, alt["letter"], alt["text"],
                    alt.get("is_correct", False), alt.get("explanation"),
                    i,
                )
            count += 1
    logger.info(f"[PRF] Seeded {count} questions")


async def _seed_achievements(pool: asyncpg.Pool):
    """Seed achievements."""
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
