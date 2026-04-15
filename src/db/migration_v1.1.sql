-- ============================================================
-- v1.1 Migration: AI Article Generation Enhancement
-- ============================================================

-- 1. Topics table
CREATE TABLE IF NOT EXISTS topics (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(100) NOT NULL,
  keywords     JSONB NOT NULL DEFAULT '[]',
  icon         VARCHAR(50),
  sort_order   INT NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed 20 preset topics
INSERT INTO topics (name, keywords, icon, sort_order) VALUES
  ('科技创新', '["technology", "innovation", "AI"]', 'tech', 1),
  ('环境保护', '["environment", "climate", "nature"]', 'nature', 2),
  ('健康生活', '["health", "fitness", "wellness"]', 'health', 3),
  ('旅行探索', '["travel", "tourism", "adventure"]', 'travel', 4),
  ('美食文化', '["food", "cuisine", "cooking"]', 'food', 5),
  ('体育运动', '["sports", "exercise", "competition"]', 'sports', 6),
  ('音乐艺术', '["music", "art", "culture"]', 'music', 7),
  ('电影娱乐', '["movies", "entertainment", "celebrities"]', 'movie', 8),
  ('科学技术', '["science", "research", "discovery"]', 'science', 9),
  ('商业经济', '["business", "economy", "finance"]', 'business', 10),
  ('教育学习', '["education", "learning", "school"]', 'education', 11),
  ('社交媒体', '["social media", "internet", "digital"]', 'social', 12),
  ('时尚潮流', '["fashion", "style", "trends"]', 'fashion', 13),
  ('宠物动物', '["pets", "animals", "wildlife"]', 'pets', 14),
  ('节日庆典', '["festivals", "holidays", "celebrations"]', 'festival', 15),
  ('历史人物', '["history", "famous people", "events"]', 'history', 16),
  ('宇宙航天', '["space", "astronomy", "NASA"]', 'space', 17),
  ('金融投资', '["investment", "stocks", "wealth"]', 'finance', 18),
  ('职场发展', '["career", "jobs", "professional"]', 'career', 19),
  ('心理健康', '["mental health", "psychology"]', 'mental', 20)
ON CONFLICT DO NOTHING;

-- 2. Extend articles table
ALTER TABLE articles ADD COLUMN IF NOT EXISTS theme VARCHAR(100);
ALTER TABLE articles ADD COLUMN IF NOT EXISTS reference_url TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS reference_title VARCHAR(500);
ALTER TABLE articles ADD COLUMN IF NOT EXISTS search_content TEXT;

-- 3. AI article cache table
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

-- 4. TTS sentence cache table
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
