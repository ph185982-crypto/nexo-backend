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
        "podcast_episode_kind",
        "ALTER TABLE podcast_episodes ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'aula'",
    ),
    (
        "podcast_episode_part",
        "ALTER TABLE podcast_episodes ADD COLUMN IF NOT EXISTS part INTEGER DEFAULT 1",
    ),
    (
        "podcast_episode_total_parts",
        "ALTER TABLE podcast_episodes ADD COLUMN IF NOT EXISTS total_parts INTEGER DEFAULT 1",
    ),
    (
        # O drill da volta aponta para a aula da ida: é o mesmo conteúdo em
        # outro formato, e a missão precisa do par para montar o dia.
        "podcast_episode_parent",
        "ALTER TABLE podcast_episodes ADD COLUMN IF NOT EXISTS parent_episode_id "
        "UUID REFERENCES podcast_episodes(id) ON DELETE CASCADE",
    ),
    (
        # Unidade de aula: um tópico sozinho ou um agrupamento de tópicos
        # (TOPIC_CLUSTERS). topic_id continua sendo o tópico âncora.
        "podcast_episode_unit",
        "ALTER TABLE podcast_episodes ADD COLUMN IF NOT EXISTS unit_slug TEXT",
    ),
    (
        "idx_podcast_episodes_unit",
        "CREATE INDEX IF NOT EXISTS idx_podcast_episodes_unit "
        "ON podcast_episodes(unit_slug, part, kind)",
    ),
    (
        # block_type era um ENUM do Postgres e a etapa de aula em áudio não
        # cabia nele. Adicionar o valor não basta: o asyncpg introspecta e
        # guarda os valores do enum por conexão, então as conexões que já
        # estavam no pool continuam recusando o valor novo até reciclarem.
        # Virar TEXT resolve o caso de hoje e tira a necessidade de migração
        # (e de reciclar pool) a cada novo tipo de bloco.
        "block_type_to_text",
        "ALTER TABLE mission_blocks ALTER COLUMN block_type TYPE TEXT "
        "USING block_type::text",
    ),
    (
        # O corte varia por município (44-60 no último certame) e é a maior
        # alavanca isolada de decisão do candidato. estimate_approval já
        # aceita target_cutoff — faltava a coluna pra guardar o que o usuário
        # informa.
        "user_profiles_municipio",
        "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS municipio TEXT",
    ),
    (
        "user_profiles_target_cutoff",
        "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS target_cutoff_score REAL",
    ),
    (
        "taf_records",
        """CREATE TABLE IF NOT EXISTS taf_records (
               id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
               user_id             UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
               measured_at         DATE NOT NULL DEFAULT CURRENT_DATE,
               barra_reps          INTEGER,
               flexao_reps         INTEGER,
               abdominal_reps      INTEGER,
               corrida_12min_metros INTEGER,
               notes               TEXT,
               created_at          TIMESTAMPTZ DEFAULT NOW()
           )""",
    ),
    (
        "idx_taf_records_user",
        "CREATE INDEX IF NOT EXISTS idx_taf_records_user ON taf_records(user_id, measured_at)",
    ),
    (
        "user_checklist_status",
        """CREATE TABLE IF NOT EXISTS user_checklist_status (
               id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
               user_id     UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
               item_key    TEXT NOT NULL,
               is_done     BOOLEAN DEFAULT FALSE,
               due_date    DATE,
               notes       TEXT,
               updated_at  TIMESTAMPTZ DEFAULT NOW(),
               UNIQUE (user_id, item_key)
           )""",
    ),
    (
        "idx_user_checklist_status_user",
        "CREATE INDEX IF NOT EXISTS idx_user_checklist_status_user "
        "ON user_checklist_status(user_id)",
    ),
    (
        # Redação passa a suportar rubrica AOCP (0-10, sem fórmula NC-NE/TL)
        # além de CEBRASPE (0-20) — banca/max_score gravam qual foi usada.
        "essays_banca",
        "ALTER TABLE essays ADD COLUMN IF NOT EXISTS banca TEXT DEFAULT 'CEBRASPE'",
    ),
    (
        "essays_max_score",
        "ALTER TABLE essays ADD COLUMN IF NOT EXISTS max_score REAL DEFAULT 20",
    ),
    (
        # Temas de redação eram todos PRF (rodovias, patrulhamento federal) —
        # sem isso, candidato PMGO via tema de contexto errado ao destravar a tela.
        "essay_themes_exam_tag",
        "ALTER TABLE essay_themes ADD COLUMN IF NOT EXISTS exam_tag TEXT DEFAULT 'PRF'",
    ),
    (
        # Índice mínimo do TAF varia por edital/gênero e o próximo edital ainda
        # não saiu — em vez de cravar número que pode estar errado, o candidato
        # informa a própria meta (tirada do edital dele) e o app só projeta
        # tendência contra ela.
        "user_profiles_taf_targets",
        "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS taf_targets JSONB DEFAULT '{}'::jsonb",
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
