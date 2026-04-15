import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { generateArticle, isSafeContent, computeWordHash, splitIntoSentences } from '../services/minimax.js';
import { validateTheme } from '../services/contentFilter.js';
import { WordListType } from '../types.js';

const LEVEL_MAP: Record<WordListType, string> = {
  gaokao: 'intermediate',
  cet4: 'intermediate',
  cet6: 'upper-intermediate',
  kaoyan: 'upper-intermediate',
  toefl: 'advanced',
  ielts: 'advanced',
};

const MAX_RETRIES = 3;

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === retries - 1) throw e;
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Retry exhausted');
}

export default async function articleRoutes(fastify: FastifyInstance) {
  // GET /api/articles — Article list with pagination
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const page = Math.max(1, Number((req.query as any).page) || 1);
      const limit = Math.min(50, Math.max(1, Number((req.query as any).limit) || 20));
      const offset = (page - 1) * limit;
      const userId = req.user.sub;

      let whereClause = '';
      const queryParams: (string | number)[] = [userId, limit, offset];

      if ((req.query as any).source === 'ai') {
        whereClause = 'WHERE a.is_ai_generated = true';
      } else if ((req.query as any).source === 'crawled') {
        whereClause = 'WHERE a.is_ai_generated = false';
      }

      const result = await fastify.db.query(
        `SELECT a.id, a.title, a.source_name, a.is_ai_generated,
                a.created_at, LEFT(a.content, 200) as excerpt,
                a.theme, a.reference_url,
                uar.read_at IS NOT NULL as is_read
         FROM articles a
         LEFT JOIN user_article_reads uar ON uar.article_id = a.id AND uar.user_id = $1
         ${whereClause}
         ORDER BY a.created_at DESC
         LIMIT $2 OFFSET $3`,
        queryParams
      );

      const countResult = await fastify.db.query(
        `SELECT COUNT(*) FROM articles a ${whereClause}`
      );

      return {
        articles: result.rows,
        total: Number(countResult.rows[0].count),
        page,
        limit,
      };
    }
  );

  // GET /api/articles/:id
  fastify.get(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as any;
      const userId = req.user.sub;

      const result = await fastify.db.query(
        `SELECT a.*, uar.read_at IS NOT NULL as is_read,
                tc.audio_url
         FROM articles a
         LEFT JOIN user_article_reads uar ON uar.article_id = a.id AND uar.user_id = $1
         LEFT JOIN tts_cache tc ON tc.article_id = a.id
         WHERE a.id = $2`,
        [userId, id]
      );

      if (result.rows.length === 0) return reply.status(404).send({ error: 'Article not found' });

      const article = result.rows[0];

      // Also return sentences
      const sentences = splitIntoSentences(article.content);

      return { ...article, sentences };
    }
  );

  // POST /api/articles/:id/read — Mark article as read
  fastify.post(
    '/:id/read',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as any;
      const userId = req.user.sub;

      await fastify.db.query(
        `INSERT INTO user_article_reads (user_id, article_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, article_id) DO NOTHING`,
        [userId, id]
      );

      const today = new Date().toISOString().split('T')[0];
      await fastify.db.query(
        `INSERT INTO study_sessions (user_id, date, articles_read)
         VALUES ($1, $2, 1)
         ON CONFLICT (user_id, date) DO UPDATE SET
           articles_read = study_sessions.articles_read + 1`,
        [userId, today]
      );

      return { message: 'Marked as read' };
    }
  );

  // POST /api/articles/generate (v1.1)
  // AI-generate a personalized article from selected words + theme
  fastify.post(
    '/generate',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = req.user.sub;
      const GenerateBody = z.object({
        wordIds: z.array(z.string().uuid()).min(10).max(20),
        theme: z.string().min(1).max(100),
        customTheme: z.string().max(50).nullable().optional(),
      });

      const parsed = GenerateBody.parse(req.body);
      const { wordIds } = parsed;
      const theme = parsed.customTheme || parsed.theme;

      // Validate theme for sensitive content
      const themeCheck = validateTheme(theme);
      if (!themeCheck.valid) {
        return reply.status(400).send({
          error: themeCheck.suggestion || '主题不合规',
          code: 1003,
        });
      }

      // Check cache first
      const wordHash = computeWordHash(wordIds);
      fastify.log.info({ userId, theme, wordHash, wordCount: wordIds.length }, '[articles] 检查缓存');

      const cached = await fastify.db.query(
        `SELECT ac.article_id, a.id, a.title, a.content, a.theme,
                a.reference_url, a.reference_title, a.created_at,
                a.source_name, a.is_ai_generated
         FROM ai_article_cache ac
         JOIN articles a ON a.id = ac.article_id
         WHERE ac.theme = $1 AND ac.word_hash = $2`,
        [theme, wordHash]
      );

      if (cached.rows.length > 0) {
        fastify.log.info({ userId, articleId: cached.rows[0].id }, '[articles] 缓存命中');
        const article = cached.rows[0];
        const sentences = splitIntoSentences(article.content);
        return {
          article: { ...article, sentences },
          cached: true,
        };
      }

      // Fetch target words
      const wordsRes = await fastify.db.query(
        `SELECT word FROM words WHERE id = ANY($1::uuid[])`,
        [wordIds]
      );
      const targetWords = wordsRes.rows.map((r: { word: string }) => r.word);

      if (targetWords.length < 10) {
        return reply.status(400).send({ error: '有效单词数不足', code: 1001 });
      }

      // Get user level
      const userRes = await fastify.db.query(
        `SELECT word_list_type FROM users WHERE id = $1`,
        [userId]
      );
      const level = LEVEL_MAP[userRes.rows[0].word_list_type as WordListType] || 'intermediate';

      // Get theme keywords (if from preset)
      let themeKeywords: string[] = [];
      const topicRes = await fastify.db.query(
        `SELECT keywords FROM topics WHERE name = $1 AND is_active = true`,
        [theme]
      );
      if (topicRes.rows.length > 0) {
        themeKeywords = topicRes.rows[0].keywords || [];
      }

      // Generate article with retry
      fastify.log.info({ userId, wordCount: targetWords.length, level, theme }, '[articles] 开始 AI 生成文章');

      let result: Awaited<ReturnType<typeof generateArticle>>;
      try {
        result = await withRetry(() => generateArticle({
          targetWords,
          level,
          theme,
          themeKeywords,
        }));
      } catch (e) {
        fastify.log.error({ err: (e as Error).message }, '[articles] AI 生成失败（重试已耗尽）');
        return reply.status(500).send({
          error: '多次尝试失败，请稍后再试',
          code: 2003,
        });
      }

      // Safety check
      if (!isSafeContent(result.content)) {
        return reply.status(422).send({
          error: '生成失败，请尝试其他主题',
          code: 2002,
        });
      }

      // Save to DB
      const articleRes = await fastify.db.query(
        `INSERT INTO articles (title, content, source_name, is_ai_generated, ai_target_words, theme)
         VALUES ($1, $2, 'AI', true, $3, $4)
         RETURNING *`,
        [result.title, result.content, JSON.stringify(targetWords), theme]
      );

      const article = articleRes.rows[0];

      // Save to cache
      await fastify.db.query(
        `INSERT INTO ai_article_cache (theme, word_hash, word_count, article_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (theme, word_hash) DO NOTHING`,
        [theme, wordHash, wordIds.length, article.id]
      );

      fastify.log.info({ userId, articleId: article.id, title: result.title }, '[articles] AI 文章生成完成');

      return {
        article: {
          ...article,
          sentences: result.sentences,
        },
        cached: false,
      };
    }
  );

  // GET /api/articles/weak-words (keep for backward compatibility)
  fastify.get(
    '/weak-words',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = req.user.sub;

      const result = await fastify.db.query(
        `SELECT w.id, w.word, w.definitions
         FROM user_word_progress uwp
         JOIN words w ON w.id = uwp.word_id
         WHERE uwp.user_id = $1 AND uwp.status IN ('weak', 'learning')
         ORDER BY uwp.ease_factor ASC
         LIMIT 50`,
        [userId]
      );

      return { words: result.rows };
    }
  );

  // POST /api/articles/vocabulary-note
  fastify.post(
    '/vocabulary-note',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = req.user.sub;
      const NoteBody = z.object({
        word: z.string().min(1).max(100),
        definition: z.string().optional(),
        article_id: z.string().uuid().optional(),
      });
      const { word, definition, article_id } = NoteBody.parse(req.body);

      await fastify.db.query(
        `INSERT INTO user_vocabulary_notes (user_id, word, definition, article_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, word) DO UPDATE SET definition = EXCLUDED.definition`,
        [userId, word.toLowerCase(), definition, article_id || null]
      );

      return { message: 'Word saved to vocabulary notebook' };
    }
  );

  // GET /api/articles/vocabulary-notes
  fastify.get(
    '/vocabulary-notes',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = req.user.sub;

      const result = await fastify.db.query(
        `SELECT id, word, definition, article_id, created_at
         FROM user_vocabulary_notes
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      );

      return { notes: result.rows };
    }
  );
}
