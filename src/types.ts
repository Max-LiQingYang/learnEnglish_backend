export type WordListType = 'gaokao' | 'cet4' | 'cet6' | 'kaoyan' | 'toefl' | 'ielts';

export interface User {
  id: string;
  email: string;
  is_verified: boolean;
  word_list_type: WordListType;
  daily_word_goal: number;
  daily_article_goal: number;
  push_enabled: boolean;
  push_time: string;
  streak: number;
  last_study_date: string | null;
  created_at: string;
}

export interface Word {
  id: string;
  word: string;
  phonetic_us: string | null;
  phonetic_uk: string | null;
  definitions: Array<{ pos: string; meaning: string }>;
  examples: Array<{ sentence: string; translation: string }>;
  word_list_type: WordListType;
}

export interface UserWordProgress {
  id: string;
  user_id: string;
  word_id: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review: string;
  last_reviewed: string | null;
  status: 'new' | 'learning' | 'mastered' | 'weak';
}

export interface Article {
  id: string;
  title: string;
  content: string;
  source_url: string | null;
  source_name: string | null;
  is_ai_generated: boolean;
  ai_target_words: string[] | null;
  created_at: string;
}

// SM-2 quality rating 0-5
export type SM2Quality = 0 | 1 | 2 | 3 | 4 | 5;

// Fastify JWT payload
export interface JwtPayload {
  sub: string; // user id
  email: string;
  type: 'access' | 'refresh';
}
