import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { generateArticle, isSafeContent } from '../services/minimax.js';
import { WordListType } from '../types.js';

const LEVEL_MAP: Record<WordListType, string> = {
  gaokao: 'intermediate',
  cet4: 'intermediate',
  cet6: 'upper-intermediate',
  kaoyan: 'upper-intermediate',
  toefl: 'advanced',
  ielts: 'advanced',
};

export default async function articleRoutes(fastify: FastifyInstance) {
  // GET /api/articles
  // Article list with pagination
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest<{ Querystring: { page?: string; limit?: string; source?: string } }>, reply: FastifyReply) => {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const offset = (page - 1) * limit;
      const userId = req.user.sub;

      let whereClause = '';
      const queryParams: (string | number)[] = [userId, limit, offset];

      if (req.query.source === 'ai') {
        whereClause = 'WHERE a.is_ai_generated = true';
      } else if (req.query.source === 'crawled') {
        whereClause = 'WHERE a.is_ai_generated = false';
      }

      const result = await fastify.db.query(
        `SELECT a.id, a.title, a.source_name, a.is_ai_generated,
                a.created_at, LEFT(a.content, 200) as excerpt,
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
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = req.params;
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
      return result.rows[0];
    }
  );

  // POST /api/articles/:id/read
  // Mark article as read
  fastify.post(
    '/:id/read',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = req.params;
      const userId = req.user.sub;

      await fastify.db.query(
        `INSERT INTO user_article_reads (user_id, article_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, article_id) DO NOTHING`,
        [userId, id]
      );

      // Update study session
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

  // POST /api/articles/generate
  // AI-generate a personalized article from selected words
  fastify.post(
    '/generate',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = req.user.sub;
      const GenerateBody = z.object({
        word_ids: z.array(z.string().uuid()).min(10).max(20),
      });

      const { word_ids } = GenerateBody.parse(req.body);

      // Fetch the actual words
      const wordsRes = await fastify.db.query(
        `SELECT word FROM words WHERE id = ANY($1::uuid[])`,
        [word_ids]
      );
      const targetWords = wordsRes.rows.map((r: { word: string }) => r.word);

      if (targetWords.length < 10) {
        return reply.status(400).send({ error: 'Not enough valid words found' });
      }

      // Get user level
      const userRes = await fastify.db.query(
        `SELECT word_list_type FROM users WHERE id = $1`,
        [userId]
      );
      const level = LEVEL_MAP[userRes.rows[0].word_list_type as WordListType] || 'intermediate';

      // Generate article
      fastify.log.info({ userId, wordCount: targetWords.length, level, words: targetWords }, '[articles] 开始 AI 生成文章');
      const rawContent = await generateArticle(targetWords, level);

      if (!isSafeContent(rawContent)) {
        return reply.status(422).send({ error: 'Generated content failed safety check. Please try again.' });
      }

      // Parse title from first line
      const lines = rawContent.split('\n').filter(Boolean);
      const title = lines[0] || 'AI Generated Article';
      const content = lines.slice(1).join('\n').trim();

      const articleRes = await fastify.db.query(
        `INSERT INTO articles (title, content, source_name, is_ai_generated, ai_target_words)
         VALUES ($1, $2, 'AI', true, $3)
         RETURNING *`,
        [title, content, JSON.stringify(targetWords)]
      );

      fastify.log.info({ userId, articleId: articleRes.rows[0].id, title }, '[articles] AI 文章生成完成');
      return articleRes.rows[0];
    }
  );

  // GET /api/articles/weak-words
  // Get user's weak words for word selector (AI generation)
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
  // Save word from reading to vocabulary notebook (生词本)
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
