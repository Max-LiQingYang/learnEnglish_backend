-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_verified   BOOLEAN NOT NULL DEFAULT false,
  word_list_type VARCHAR(20) NOT NULL CHECK (word_list_type IN ('gaokao','cet4','cet6','kaoyan','toefl','ielts')),
  daily_word_goal   INT NOT NULL DEFAULT 20,
  daily_article_goal INT NOT NULL DEFAULT 1,
  push_enabled  BOOLEAN NOT NULL DEFAULT true,
  push_time     TIME NOT NULL DEFAULT '20:00:00',
  streak        INT NOT NULL DEFAULT 0,
  last_study_date DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Email Verification Tokens
-- ============================================================
CREATE TABLE IF NOT EXISTS verification_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Refresh Tokens
-- ============================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(512) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Words Vocabulary
-- ============================================================
CREATE TABLE IF NOT EXISTS words (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  word           VARCHAR(100) NOT NULL,
  phonetic_us    VARCHAR(200),
  phonetic_uk    VARCHAR(200),
  definitions    JSONB NOT NULL DEFAULT '[]',  -- [{pos, meaning}]
  examples       JSONB NOT NULL DEFAULT '[]',  -- [{sentence, translation}]
  word_list_type VARCHAR(20) NOT NULL CHECK (word_list_type IN ('gaokao','cet4','cet6','kaoyan','toefl','ielts')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(word, word_list_type)
);

CREATE INDEX IF NOT EXISTS idx_words_list_type ON words(word_list_type);

-- ============================================================
-- User Word Progress (SM-2)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_word_progress (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_id        UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  -- SM-2 fields
  ease_factor    FLOAT NOT NULL DEFAULT 2.5,
  interval_days  INT NOT NULL DEFAULT 0,
  repetitions    INT NOT NULL DEFAULT 0,
  next_review    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reviewed  TIMESTAMPTZ,
  -- Status
  status         VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new','learning','mastered','weak')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, word_id)
);

CREATE INDEX IF NOT EXISTS idx_uwp_user_review ON user_word_progress(user_id, next_review);
CREATE INDEX IF NOT EXISTS idx_uwp_user_status ON user_word_progress(user_id, status);

-- ============================================================
-- Articles
-- ============================================================
CREATE TABLE IF NOT EXISTS articles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           VARCHAR(500) NOT NULL,
  content         TEXT NOT NULL,
  source_url      VARCHAR(1000),
  source_name     VARCHAR(100),   -- 'VOA' | 'BBC' | 'AI'
  is_ai_generated BOOLEAN NOT NULL DEFAULT false,
  ai_target_words JSONB,          -- words used to generate (only for AI articles)
  theme           VARCHAR(100),
  reference_url   TEXT,
  reference_title VARCHAR(500),
  search_content  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at DESC);

-- ============================================================
-- User Article Reads
-- ============================================================
CREATE TABLE IF NOT EXISTS user_article_reads (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, article_id)
);

-- ============================================================
-- User Vocabulary Notes (生词本)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_vocabulary_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word       VARCHAR(100) NOT NULL,
  definition TEXT,
  article_id UUID REFERENCES articles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, word)
);

-- ============================================================
-- TTS Cache (legacy whole-article cache)
-- ============================================================
CREATE TABLE IF NOT EXISTS tts_cache (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL UNIQUE REFERENCES articles(id) ON DELETE CASCADE,
  audio_url  VARCHAR(1000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Topics
-- ============================================================
CREATE TABLE IF NOT EXISTS topics (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(100) NOT NULL,
  keywords     JSONB NOT NULL DEFAULT '[]',
  icon         VARCHAR(50),
  sort_order   INT NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- AI Article Cache
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_article_cache (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  theme           VARCHAR(100) NOT NULL,
  word_hash       VARCHAR(64) NOT NULL,
  word_count      INT NOT NULL,
  article_id      UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(theme, word_hash)
);

CREATE INDEX IF NOT EXISTS idx_cache_lookup ON ai_article_cache(theme, word_hash);

-- ============================================================
-- TTS Sentence Cache
-- ============================================================
CREATE TABLE IF NOT EXISTS tts_sentence_cache (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id   UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  sentence     TEXT NOT NULL,
  audio_data   TEXT NOT NULL,
  duration_ms  INT,
  sort_order   INT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(article_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_tts_sentence_article ON tts_sentence_cache(article_id, sort_order);

-- ============================================================
-- Study Sessions (for stats)
-- ============================================================
CREATE TABLE IF NOT EXISTS study_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  duration_seconds INT NOT NULL DEFAULT 0,
  words_studied    INT NOT NULL DEFAULT 0,
  articles_read    INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON study_sessions(user_id, date DESC);
