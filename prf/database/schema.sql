-- PRF Adaptive Study Platform — Complete Database Schema
-- PostgreSQL 15+

-- ═══════════════════════════════════════════════════════════════════
-- EXTENSIONS
-- ═══════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ═══════════════════════════════════════════════════════════════════
-- ENUMS
-- ═══════════════════════════════════════════════════════════════════
CREATE TYPE study_mode AS ENUM ('focus', 'commute', 'micro', 'tired', 'high_energy');
CREATE TYPE content_format AS ENUM ('text', 'audio', 'flashcard', 'question', 'legal_article', 'simulated');
CREATE TYPE energy_level AS ENUM ('very_low', 'low', 'medium', 'high', 'very_high');
CREATE TYPE difficulty_level AS ENUM ('easy', 'medium', 'hard', 'expert');
CREATE TYPE review_quality AS ENUM ('blackout', 'wrong', 'hard', 'good', 'easy');
CREATE TYPE mission_status AS ENUM ('pending', 'in_progress', 'completed', 'skipped', 'partial');
CREATE TYPE block_type AS ENUM ('review', 'questions', 'legal_reading', 'flashcards', 'audio_lesson', 'simulated');
CREATE TYPE notification_type AS ENUM ('mission_start', 'commute_time', 'review_due', 'session_end', 'goal_reached', 'streak_warning', 'gentle_return', 'weekly_report');
CREATE TYPE achievement_category AS ENUM ('streak', 'mastery', 'consistency', 'milestone', 'exploration');

-- ═══════════════════════════════════════════════════════════════════
-- USERS & PROFILES
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE prf_users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    name            TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    last_login_at   TIMESTAMPTZ,
    is_active       BOOLEAN DEFAULT TRUE,
    timezone        TEXT DEFAULT 'America/Sao_Paulo'
);

CREATE TABLE user_profiles (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID UNIQUE NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    target_exam         TEXT DEFAULT 'PRF',
    exam_date           DATE,
    weekly_goal_hours   REAL DEFAULT 10.0,
    preferred_format    content_format DEFAULT 'text',
    audio_preference    BOOLEAN DEFAULT TRUE,
    onboarding_complete BOOLEAN DEFAULT FALSE,
    study_level         TEXT DEFAULT 'beginner',  -- beginner, intermediate, advanced
    priority_subjects   JSONB DEFAULT '[]',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_routines (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Monday
    available_from  TIME,
    available_to    TIME,
    study_minutes   INT DEFAULT 90,
    commute_start   TIME,
    commute_end     TIME,
    commute_minutes INT DEFAULT 0,
    work_start      TIME,
    work_end        TIME,
    typical_energy  energy_level DEFAULT 'medium',
    is_rest_day     BOOLEAN DEFAULT FALSE,
    UNIQUE(user_id, day_of_week)
);

CREATE TABLE user_energy_logs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    logged_at   TIMESTAMPTZ DEFAULT NOW(),
    energy      energy_level NOT NULL,
    context     TEXT,  -- 'morning', 'afternoon', 'evening', 'commute'
    hour_of_day SMALLINT
);

CREATE TABLE user_behavior_metrics (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                 UUID UNIQUE NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    best_study_hour         SMALLINT,           -- 0-23
    avg_session_minutes     REAL DEFAULT 0,
    avg_accuracy            REAL DEFAULT 0,
    avg_questions_per_day   REAL DEFAULT 0,
    preferred_block_size    INT DEFAULT 15,      -- minutes
    strongest_subject_id    UUID,
    weakest_subject_id      UUID,
    total_study_hours       REAL DEFAULT 0,
    total_questions         INT DEFAULT 0,
    total_correct           INT DEFAULT 0,
    consistency_score       REAL DEFAULT 0,      -- 0-100
    retention_score         REAL DEFAULT 0,      -- 0-100
    fatigue_threshold_mins  INT DEFAULT 45,
    days_active             INT DEFAULT 0,
    last_computed_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- SUBJECTS & TOPICS
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE subjects (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    slug            TEXT UNIQUE NOT NULL,
    description     TEXT,
    weight_prf      REAL DEFAULT 1.0,   -- peso no edital PRF
    color           TEXT,               -- hex color for UI
    icon            TEXT,               -- icon identifier
    display_order   INT DEFAULT 0,
    is_active       BOOLEAN DEFAULT TRUE
);

CREATE TABLE topics (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subject_id      UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL,
    description     TEXT,
    weight          REAL DEFAULT 1.0,
    display_order   INT DEFAULT 0,
    parent_topic_id UUID REFERENCES topics(id),
    is_active       BOOLEAN DEFAULT TRUE,
    UNIQUE(subject_id, slug)
);

CREATE INDEX idx_topics_subject ON topics(subject_id);

-- ═══════════════════════════════════════════════════════════════════
-- QUESTION BANK
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE questions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subject_id      UUID NOT NULL REFERENCES subjects(id),
    topic_id        UUID REFERENCES topics(id),
    text            TEXT NOT NULL,
    difficulty      difficulty_level DEFAULT 'medium',
    source          TEXT,               -- banca, ano
    year            INT,
    examiner        TEXT,               -- CESPE, FGV, etc.
    explanation     TEXT,
    legal_basis     TEXT,               -- artigo/lei referenciado
    legal_article_id UUID,
    tags            JSONB DEFAULT '[]',
    is_active       BOOLEAN DEFAULT TRUE,
    times_answered  INT DEFAULT 0,
    times_correct   INT DEFAULT 0,
    avg_time_secs   REAL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE question_alternatives (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    question_id     UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    letter          CHAR(1) NOT NULL,   -- A, B, C, D, E
    text            TEXT NOT NULL,
    is_correct      BOOLEAN DEFAULT FALSE,
    explanation     TEXT,               -- por que está certa/errada
    display_order   INT DEFAULT 0
);

CREATE INDEX idx_questions_subject ON questions(subject_id);
CREATE INDEX idx_questions_topic ON questions(topic_id);
CREATE INDEX idx_questions_difficulty ON questions(difficulty);
CREATE INDEX idx_alternatives_question ON question_alternatives(question_id);

-- ═══════════════════════════════════════════════════════════════════
-- LEGAL LIBRARY
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE legal_documents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,      -- "Constituição Federal", "CTB"
    slug            TEXT UNIQUE NOT NULL,
    abbreviation    TEXT,
    description     TEXT,
    display_order   INT DEFAULT 0
);

CREATE TABLE legal_articles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id     UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    subject_id      UUID REFERENCES subjects(id),
    topic_id        UUID REFERENCES topics(id),
    article_number  TEXT NOT NULL,       -- "Art. 5°", "Art. 144"
    title           TEXT,
    official_text   TEXT NOT NULL,
    simple_text     TEXT,               -- explicação em linguagem simples
    highlights      JSONB DEFAULT '[]', -- pontos mais cobrados
    frequency_score REAL DEFAULT 0,     -- quão cobrado é
    tags            JSONB DEFAULT '[]',
    display_order   INT DEFAULT 0,
    chapter         TEXT,
    section         TEXT
);

CREATE TABLE user_legal_bookmarks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    article_id      UUID NOT NULL REFERENCES legal_articles(id) ON DELETE CASCADE,
    note            TEXT,
    review_later    BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, article_id)
);

CREATE INDEX idx_legal_articles_document ON legal_articles(document_id);
CREATE INDEX idx_legal_articles_subject ON legal_articles(subject_id);

-- ═══════════════════════════════════════════════════════════════════
-- FLASHCARDS
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE flashcards (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES prf_users(id) ON DELETE CASCADE,  -- NULL = system card
    subject_id      UUID REFERENCES subjects(id),
    topic_id        UUID REFERENCES topics(id),
    question_id     UUID REFERENCES questions(id),
    article_id      UUID REFERENCES legal_articles(id),
    front           TEXT NOT NULL,
    back            TEXT NOT NULL,
    tags            JSONB DEFAULT '[]',
    source          TEXT DEFAULT 'system',   -- 'system', 'error', 'user', 'ai'
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_flashcards_user ON flashcards(user_id);
CREATE INDEX idx_flashcards_subject ON flashcards(subject_id);

-- ═══════════════════════════════════════════════════════════════════
-- STUDY SESSIONS & PROGRESS
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE study_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    ended_at        TIMESTAMPTZ,
    mode            study_mode DEFAULT 'focus',
    energy_at_start energy_level,
    energy_at_end   energy_level,
    duration_mins   REAL,
    questions_total INT DEFAULT 0,
    questions_correct INT DEFAULT 0,
    subjects_covered JSONB DEFAULT '[]',
    mission_id      UUID,
    is_completed    BOOLEAN DEFAULT FALSE
);

CREATE TABLE question_attempts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    question_id     UUID NOT NULL REFERENCES questions(id),
    session_id      UUID REFERENCES study_sessions(id),
    selected_alt_id UUID REFERENCES question_alternatives(id),
    is_correct      BOOLEAN NOT NULL,
    time_spent_secs INT,
    confidence      SMALLINT,           -- 1-5 self-assessment
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_attempts_user ON question_attempts(user_id);
CREATE INDEX idx_attempts_question ON question_attempts(question_id);
CREATE INDEX idx_attempts_session ON question_attempts(session_id);
CREATE INDEX idx_sessions_user ON study_sessions(user_id);

-- ═══════════════════════════════════════════════════════════════════
-- SPACED REPETITION (SM-2 based, upgradeable to FSRS)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE review_cards (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    -- polymorphic: one of these will be set
    question_id     UUID REFERENCES questions(id),
    flashcard_id    UUID REFERENCES flashcards(id),
    article_id      UUID REFERENCES legal_articles(id),
    -- SM-2 fields
    ease_factor     REAL DEFAULT 2.5,
    interval_days   REAL DEFAULT 0,
    repetitions     INT DEFAULT 0,
    next_review     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_review     TIMESTAMPTZ,
    last_quality    review_quality,
    -- tracking
    total_reviews   INT DEFAULT 0,
    total_correct   INT DEFAULT 0,
    streak          INT DEFAULT 0,
    lapsed          BOOLEAN DEFAULT FALSE,
    suspended       BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_review_cards_user_next ON review_cards(user_id, next_review);
CREATE INDEX idx_review_cards_user_question ON review_cards(user_id, question_id);

-- ═══════════════════════════════════════════════════════════════════
-- ERROR NOTEBOOK
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE error_notebook (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    question_id     UUID NOT NULL REFERENCES questions(id),
    attempt_id      UUID REFERENCES question_attempts(id),
    subject_id      UUID REFERENCES subjects(id),
    topic_id        UUID REFERENCES topics(id),
    error_summary   TEXT,
    error_type      TEXT,               -- 'conceptual', 'attention', 'interpretation', 'unknown'
    times_repeated  INT DEFAULT 1,
    flashcard_id    UUID REFERENCES flashcards(id),
    review_card_id  UUID REFERENCES review_cards(id),
    resolved        BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_error_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_errors_user ON error_notebook(user_id);
CREATE INDEX idx_errors_subject ON error_notebook(user_id, subject_id);

-- ═══════════════════════════════════════════════════════════════════
-- DAILY MISSIONS
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE daily_missions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    date            DATE NOT NULL,
    status          mission_status DEFAULT 'pending',
    estimated_mins  INT,
    actual_mins     INT,
    mode_suggested  study_mode DEFAULT 'focus',
    energy_detected energy_level,
    greeting        TEXT,
    blocks_total    INT DEFAULT 0,
    blocks_done     INT DEFAULT 0,
    xp_earned       INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    UNIQUE(user_id, date)
);

CREATE TABLE mission_blocks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mission_id      UUID NOT NULL REFERENCES daily_missions(id) ON DELETE CASCADE,
    block_type      block_type NOT NULL,
    subject_id      UUID REFERENCES subjects(id),
    topic_id        UUID REFERENCES topics(id),
    title           TEXT NOT NULL,
    description     TEXT,
    estimated_mins  INT DEFAULT 10,
    display_order   INT DEFAULT 0,
    content_ids     JSONB DEFAULT '[]',     -- question IDs, article IDs, etc.
    is_completed    BOOLEAN DEFAULT FALSE,
    is_optional     BOOLEAN DEFAULT FALSE,
    mode            study_mode DEFAULT 'focus',
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_missions_user_date ON daily_missions(user_id, date);
CREATE INDEX idx_blocks_mission ON mission_blocks(mission_id);

-- ═══════════════════════════════════════════════════════════════════
-- AUDIO CONTENT (Commute Mode)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE audio_lessons (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subject_id      UUID REFERENCES subjects(id),
    topic_id        UUID REFERENCES topics(id),
    title           TEXT NOT NULL,
    description     TEXT,
    script          TEXT NOT NULL,       -- texto para TTS
    duration_secs   INT,
    audio_url       TEXT,               -- URL do áudio gerado
    lesson_type     TEXT DEFAULT 'summary',  -- 'summary', 'quiz', 'review', 'deep_dive'
    difficulty      difficulty_level DEFAULT 'medium',
    display_order   INT DEFAULT 0,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE audio_quiz_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lesson_id       UUID NOT NULL REFERENCES audio_lessons(id) ON DELETE CASCADE,
    question_text   TEXT NOT NULL,
    correct_answer  TEXT NOT NULL,
    explanation     TEXT,
    pause_secs      INT DEFAULT 10,     -- tempo para pensar
    display_order   INT DEFAULT 0
);

-- ═══════════════════════════════════════════════════════════════════
-- GAMIFICATION
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE user_streaks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID UNIQUE NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    current_streak  INT DEFAULT 0,
    longest_streak  INT DEFAULT 0,
    last_active_date DATE,
    freeze_available INT DEFAULT 1,
    freeze_used_at  DATE
);

CREATE TABLE user_xp (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID UNIQUE NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    total_xp        INT DEFAULT 0,
    level           INT DEFAULT 1,
    xp_to_next      INT DEFAULT 100
);

CREATE TABLE xp_transactions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    amount          INT NOT NULL,
    reason          TEXT NOT NULL,
    source_type     TEXT,               -- 'question', 'mission', 'streak', 'review'
    source_id       UUID,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE achievements (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug            TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL,
    category        achievement_category NOT NULL,
    icon            TEXT,
    xp_reward       INT DEFAULT 0,
    condition_json  JSONB NOT NULL,     -- {"type": "streak", "threshold": 7}
    display_order   INT DEFAULT 0
);

CREATE TABLE user_achievements (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    achievement_id  UUID NOT NULL REFERENCES achievements(id),
    unlocked_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, achievement_id)
);

-- ═══════════════════════════════════════════════════════════════════
-- ANALYTICS & PROGRESS
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE daily_analytics (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    date                DATE NOT NULL,
    study_minutes       REAL DEFAULT 0,
    questions_total     INT DEFAULT 0,
    questions_correct   INT DEFAULT 0,
    reviews_done        INT DEFAULT 0,
    reviews_due         INT DEFAULT 0,
    new_cards_learned   INT DEFAULT 0,
    errors_made         INT DEFAULT 0,
    mission_completed   BOOLEAN DEFAULT FALSE,
    commute_minutes     REAL DEFAULT 0,
    audio_minutes       REAL DEFAULT 0,
    xp_earned           INT DEFAULT 0,
    subjects_studied    JSONB DEFAULT '{}',  -- {subject_id: {correct: X, total: Y}}
    accuracy_by_subject JSONB DEFAULT '{}',
    UNIQUE(user_id, date)
);

CREATE TABLE weekly_analytics (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    week_start          DATE NOT NULL,
    study_hours         REAL DEFAULT 0,
    questions_total     INT DEFAULT 0,
    accuracy            REAL DEFAULT 0,
    missions_completed  INT DEFAULT 0,
    missions_total      INT DEFAULT 0,
    streak_days         INT DEFAULT 0,
    weakest_subject_id  UUID,
    strongest_subject_id UUID,
    retention_score     REAL DEFAULT 0,
    approval_estimate   REAL DEFAULT 0,
    improvement_delta   REAL DEFAULT 0,
    UNIQUE(user_id, week_start)
);

CREATE TABLE approval_estimates (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    estimated_at    TIMESTAMPTZ DEFAULT NOW(),
    probability     REAL NOT NULL,      -- 0.0 to 1.0
    factors         JSONB NOT NULL,     -- breakdown by subject
    trend           TEXT,               -- 'improving', 'stable', 'declining'
    notes           TEXT
);

-- ═══════════════════════════════════════════════════════════════════
-- NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE notification_preferences (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID UNIQUE NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    mission_reminder    BOOLEAN DEFAULT TRUE,
    commute_reminder    BOOLEAN DEFAULT TRUE,
    review_due          BOOLEAN DEFAULT TRUE,
    streak_warning      BOOLEAN DEFAULT TRUE,
    weekly_report       BOOLEAN DEFAULT TRUE,
    quiet_start         TIME DEFAULT '22:00',
    quiet_end           TIME DEFAULT '07:00'
);

CREATE TABLE notification_queue (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    type            notification_type NOT NULL,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    data            JSONB DEFAULT '{}',
    scheduled_for   TIMESTAMPTZ,
    sent_at         TIMESTAMPTZ,
    read_at         TIMESTAMPTZ,
    is_sent         BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notification_queue(user_id, is_sent);

-- ═══════════════════════════════════════════════════════════════════
-- AI TUTOR CONVERSATIONS
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE tutor_conversations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    question_id     UUID REFERENCES questions(id),
    article_id      UUID REFERENCES legal_articles(id),
    context         TEXT,
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    ended_at        TIMESTAMPTZ,
    messages        JSONB DEFAULT '[]',  -- [{role, content, timestamp}]
    outcome         TEXT,               -- 'understood', 'needs_review', 'gave_up'
    error_type_identified TEXT
);

-- ═══════════════════════════════════════════════════════════════════
-- SUBJECT MASTERY (per-user per-subject tracking)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE subject_mastery (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    subject_id      UUID NOT NULL REFERENCES subjects(id),
    topic_id        UUID REFERENCES topics(id),
    total_attempts  INT DEFAULT 0,
    total_correct   INT DEFAULT 0,
    accuracy        REAL DEFAULT 0,
    mastery_level   REAL DEFAULT 0,     -- 0.0 to 1.0
    last_studied    TIMESTAMPTZ,
    study_time_mins REAL DEFAULT 0,
    error_count     INT DEFAULT 0,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, subject_id, topic_id)
);

CREATE INDEX idx_mastery_user ON subject_mastery(user_id);
CREATE INDEX idx_mastery_subject ON subject_mastery(user_id, subject_id);

-- ═══════════════════════════════════════════════════════════════════
-- SIMULATED EXAMS
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE simulated_exams (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES prf_users(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    total_questions INT NOT NULL,
    time_limit_mins INT,
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    ended_at        TIMESTAMPTZ,
    score           REAL,
    questions       JSONB NOT NULL,     -- ordered list of question IDs
    answers         JSONB DEFAULT '{}', -- {question_id: selected_alt_id}
    is_completed    BOOLEAN DEFAULT FALSE
);
