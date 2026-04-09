/**
 * Minimax API service for:
 *  1. AI article generation
 *  2. TTS (Text-to-Speech)
 */

const MINIMAX_BASE = 'https://api.minimax.chat/v1';

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
});

// ============================================================
// Article generation
// ============================================================

export async function generateArticle(targetWords: string[], level: string): Promise<string> {
  const wordList = targetWords.join(', ');

  const prompt = `Write a short English article (200-300 words) for a ${level} English learner.
Requirements:
- Naturally incorporate ALL of these vocabulary words: ${wordList}
- The article should be coherent, engaging, and thematically unified
- Use vocabulary and sentence structure appropriate for ${level} level
- Do not include a word list or explanation — just the article
- Format: Title on first line, then blank line, then article body`;

  const body = {
    model: 'abab6.5s-chat',
    messages: [
      { role: 'system', content: 'You are an expert English language teacher who writes engaging educational content.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 600,
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

  return data.choices[0].message.content.trim();
}

// ============================================================
// Grammar analysis for word detail
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
// TTS
// ============================================================

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const body = {
    model: 'speech-01',
    text,
    voice_setting: {
      voice_id: 'female-tianmei',
      speed: 1.0,
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
// Content safety filter
// ============================================================

const BLOCKED_KEYWORDS = [
  'violence', 'explicit', 'hate', 'suicide', 'drugs', 'weapon',
  '暴力', '色情', '仇恨',
];

export function isSafeContent(text: string): boolean {
  const lower = text.toLowerCase();
  return !BLOCKED_KEYWORDS.some((kw) => lower.includes(kw));
}
