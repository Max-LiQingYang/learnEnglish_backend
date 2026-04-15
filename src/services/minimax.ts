/**
 * Minimax API service for:
 *  1. AI article generation (with theme + search context)
 *  2. TTS (Text-to-Speech) — whole article & per-sentence
 */

import crypto from 'crypto';

const MINIMAX_BASE = 'https://api.minimax.chat/v1';

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
});

// ============================================================
// Article generation (v1.1 — with theme support)
// ============================================================

export interface GenerateArticleOptions {
  targetWords: string[];
  level: string;
  theme: string;
  themeKeywords?: string[];
}

export async function generateArticle(opts: GenerateArticleOptions): Promise<{
  title: string;
  content: string;
  sentences: { index: number; text: string }[];
}> {
  const { targetWords, level, theme, themeKeywords } = opts;
  const wordList = targetWords.join(', ');
  const keywordsHint = themeKeywords?.length ? ` (related keywords: ${themeKeywords.join(', ')})` : '';

  const prompt = `Write a short English article (200-300 words) for a ${level} English learner.

Topic/Theme: ${theme}${keywordsHint}

Requirements:
- Naturally incorporate ALL of these vocabulary words: ${wordList}
- The article should be about the given topic, coherent, engaging, and informative
- Use vocabulary and sentence structure appropriate for ${level} level
- Reference recent real-world events or facts related to the topic when possible
- Do not include a word list or explanation — just the article
- Format: Title on first line, then blank line, then article body
- Each paragraph should be separated by a blank line`;

  const body = {
    model: 'abab6.5s-chat',
    messages: [
      { role: 'system', content: 'You are an expert English language teacher who writes engaging educational content based on real-world news and topics.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 800,
  };

  const res = await fetch(`${MINIMAX_BASE}/text/chatcompletion_v2`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Minimax API error: ${res.status} ${err}`);
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  if (!data.choices || data.choices.length === 0) { throw new Error("Minimax API returned no choices: " + JSON.stringify(data).slice(0, 200)); }
  const rawContent = data.choices[0].message.content.trim();

  // Parse title and content
  const lines = rawContent.split('\n').filter(Boolean);
  const title = lines[0].replace(/^#+\s*/, '').trim() || 'AI Generated Article';
  const content = lines.slice(1).join('\n').trim();

  // Split content into sentences
  const sentences = splitIntoSentences(content);

  return { title, content, sentences };
}

// ============================================================
// Legacy generate (for backward compatibility)
// ============================================================

export async function generateArticleLegacy(targetWords: string[], level: string): Promise<string> {
  const result = await generateArticle({ targetWords, level, theme: 'general' });
  return `${result.title}\n\n${result.content}`;
}

// ============================================================
// Grammar analysis
// ============================================================

export async function analyzeGrammar(word: string, sentence: string): Promise<string> {
  const body = {
    model: 'abab6.5s-chat',
    messages: [
      { role: 'system', content: 'You are an English grammar expert. Provide concise, clear grammar explanations.' },
      {
        role: 'user',
        content: `Explain the grammar usage of the word "${word}" in this sentence: "${sentence}"
Keep the explanation under 80 words. Focus on part of speech, function, and any notable grammar patterns.`,
      },
    ],
    temperature: 0.3,
    max_tokens: 150,
  };

  const res = await fetch(`${MINIMAX_BASE}/text/chatcompletion_v2`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Minimax grammar API error: ${res.status}`);
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0].message.content.trim();
}

// ============================================================
// TTS — single sentence
// ============================================================

export async function synthesizeSpeech(text: string, speed = 1.0): Promise<Buffer> {
  const body = {
    model: 'speech-01',
    text,
    voice_setting: {
      voice_id: 'female-tianmei',
      speed,
      vol: 1.0,
      pitch: 0,
    },
    audio_setting: {
      audio_sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
    },
  };

  const res = await fetch(
    `${MINIMAX_BASE}/text_to_speech?GroupId=${process.env.MINIMAX_GROUP_ID}`,
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Minimax TTS error: ${res.status} ${err}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ============================================================
// Content safety filter (enhanced)
// ============================================================

import { containsSensitiveContent, isArticleSafe } from './contentFilter.js';

export function isSafeContent(text: string): boolean {
  return isArticleSafe(text);
}

// ============================================================
// Utilities
// ============================================================

/**
 * Split text into sentences
 */
export function splitIntoSentences(text: string): { index: number; text: string }[] {
  // Split on sentence-ending punctuation followed by space or newline
  const raw = text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return raw.map((text, index) => ({ index, text }));
}

/**
 * Compute MD5 hash for a sorted list of word IDs (for cache key)
 */
export function computeWordHash(wordIds: string[]): string {
  const sorted = [...wordIds].sort().join(',');
  return crypto.createHash('md5').update(sorted).digest('hex');
}
