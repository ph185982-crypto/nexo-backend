"""Alterações de esquema aplicadas depois do schema inicial.

O schema.sql roda como um lote único e suas tabelas não usam IF NOT EXISTS, de
modo que num banco já povoado o primeiro CREATE TABLE falha por duplicidade e
aborta o lote inteiro — o erro é engolido e registrado como aviso. Na prática
isso significa que nada acrescentado ao schema.sql chega a existir em produção.

Cada instrução aqui é idempotente e roda isolada, então uma que falhe não
impede as demais. É por aqui que passa toda mudança de esquema nova.
"""
from __future__ import annotations

import logging

import asyncpg

logger = logging.getLogger(__name__)

MIGRATIONS: list[tuple[str, str]] = [
    (
        "user_topic_progress",
        """CREATE TABLE IF NOT EXISTS user_topic_progress (
               id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
               user_id         UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
               topic_id        UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
               law_read        BOOLEAN DEFAULT FALSE,
               audio_done      BOOLEAN DEFAULT FALSE,
               notes           TEXT,
               last_studied_at TIMESTAMPTZ,
               created_at      TIMESTAMPTZ DEFAULT NOW(),
               UNIQUE (user_id, topic_id)
           )""",
    ),
    (
        "idx_user_topic_progress_user",
        "CREATE INDEX IF NOT EXISTS idx_user_topic_progress_user "
        "ON user_topic_progress(user_id)",
    ),
    (
        "idx_legal_articles_topic",
        "CREATE INDEX IF NOT EXISTS idx_legal_articles_topic "
        "ON legal_articles(topic_id)",
    ),
    (
        "idx_questions_topic",
        "CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions(topic_id)",
    ),
    (
        "push_subscriptions",
        """CREATE TABLE IF NOT EXISTS push_subscriptions (
               id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
               user_id     UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
               endpoint    TEXT NOT NULL,
               p256dh      TEXT NOT NULL,
               auth        TEXT NOT NULL,
               user_agent  TEXT,
               created_at  TIMESTAMPTZ DEFAULT NOW(),
               last_ok_at  TIMESTAMPTZ,
               UNIQUE (endpoint)
           )""",
    ),
    (
        "idx_push_subscriptions_user",
        "CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user "
        "ON push_subscriptions(user_id)",
    ),
    (
        "idx_legal_articles_fts",
        "CREATE INDEX IF NOT EXISTS idx_legal_articles_fts "
        "ON legal_articles USING GIN (to_tsvector('portuguese', official_text))",
    ),
    (
        "add_weight_pm_column",
        "ALTER TABLE subjects ADD COLUMN IF NOT EXISTS weight_pm REAL DEFAULT 0.0",
    ),
    (
        "user_article_progress",
        """CREATE TABLE IF NOT EXISTS user_article_progress (
               id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
               user_id         UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
               article_id      UUID NOT NULL REFERENCES legal_articles(id) ON DELETE CASCADE,
               read_count      INTEGER DEFAULT 0,
               mastery_score   REAL DEFAULT 0.0,
               last_read_at    TIMESTAMPTZ,
               error_count     INTEGER DEFAULT 0,
               created_at      TIMESTAMPTZ DEFAULT NOW(),
               UNIQUE (user_id, article_id)
           )""",
    ),
    (
        "idx_user_article_progress_user",
        "CREATE INDEX IF NOT EXISTS idx_user_article_progress_user "
        "ON user_article_progress(user_id)",
    ),
    (
        "idx_user_article_progress_article",
        "CREATE INDEX IF NOT EXISTS idx_user_article_progress_article "
        "ON user_article_progress(article_id)",
    ),
    (
        "podcast_episodes",
        """CREATE TABLE IF NOT EXISTS podcast_episodes (
               id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
               subject_id      UUID REFERENCES subjects(id) ON DELETE SET NULL,
               title           TEXT NOT NULL,
               topic           TEXT NOT NULL,
               description     TEXT,
               turns           JSONB NOT NULL DEFAULT '[]'::jsonb,
               segment_count   INTEGER DEFAULT 0,
               duration_secs   INTEGER DEFAULT 0,
               word_count      INTEGER DEFAULT 0,
               is_active       BOOLEAN DEFAULT TRUE,
               created_at      TIMESTAMPTZ DEFAULT NOW()
           )""",
    ),
    (
        "podcast_segments",
        """CREATE TABLE IF NOT EXISTS podcast_segments (
               id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
               episode_id      UUID NOT NULL REFERENCES podcast_episodes(id) ON DELETE CASCADE,
               seq             INTEGER NOT NULL,
               audio           BYTEA,
               duration_secs   INTEGER DEFAULT 0,
               created_at      TIMESTAMPTZ DEFAULT NOW(),
               UNIQUE (episode_id, seq)
           )""",
    ),
    (
        "idx_podcast_episodes_subject",
        "CREATE INDEX IF NOT EXISTS idx_podcast_episodes_subject "
        "ON podcast_episodes(subject_id)",
    ),
    (
        "podcast_episodes_topic_id",
        "ALTER TABLE podcast_episodes ADD COLUMN IF NOT EXISTS topic_id "
        "UUID REFERENCES topics(id) ON DELETE SET NULL",
    ),
    (
        "idx_podcast_episodes_topic",
        "CREATE INDEX IF NOT EXISTS idx_podcast_episodes_topic "
        "ON podcast_episodes(topic_id)",
    ),
    (
        # block_type é ENUM: sem este valor, gravar a etapa de aula em áudio
        # da missão estoura com InvalidTextRepresentation e derruba a
        # geração inteira da missão.
        "block_type_podcast",
        "ALTER TYPE block_type ADD VALUE IF NOT EXISTS 'podcast'",
    ),
]


async def apply_migrations(pool: asyncpg.Pool) -> int:
    applied = 0
    async with pool.acquire() as conn:
        for name, sql in MIGRATIONS:
            try:
                await conn.execute(sql)
                applied += 1
            except Exception as e:
                logger.warning(f"[PRF] Migração '{name}' falhou: {e}")
    logger.info(f"[PRF] Migrações aplicadas: {applied}/{len(MIGRATIONS)}")
    return applied
