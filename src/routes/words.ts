import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { sm2, SM2State } from '../services/sm2.js';

export default async function wordRoutes(fastify: FastifyInstance) {
  // GET /api/words/today
  // Returns today's study batch: new words + due reviews
  fastify.get('/today', { preHandler: [fastify.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.user.sub;

    const userRes = await fastify.db.query(
      `SELECT word_list_type, daily_word_goal FROM users WHERE id = $1`,
      [userId]
    );
    const { word_list_type, daily_word_goal } = userRes.rows[0];
    fastify.log.debug({ userId, word_list_type, daily_word_goal }, '[words] 获取今日任务');

    // Due reviews
    const reviews = await fastify.db.query(
      `SELECT uwp.id as progress_id, uwp.ease_factor, uwp.interval_days,
              uwp.repetitions, uwp.next_review, uwp.status,
              w.id, w.word, w.phonetic_us, w.phonetic_uk, w.definitions, w.examples
       FROM user_word_progress uwp
       JOIN words w ON w.id = uwp.word_id
       WHERE uwp.user_id = $1 AND uwp.next_review <= now()
       ORDER BY uwp.next_review ASC
       LIMIT $2`,
      [userId, daily_word_goal]
    );

    const reviewCount = reviews.rows.length;
    const newWordsNeeded = Math.max(0, daily_word_goal - reviewCount);

    // New words not yet started
    let newWords: typeof reviews.rows = [];
    if (newWordsNeeded > 0) {
      const newWordsRes = await fastify.db.query(
        `SELECT w.id, w.word, w.phonetic_us, w.phonetic_uk, w.definitions, w.examples
         FROM words w
         WHERE w.word_list_type = $1
           AND w.id NOT IN (
             SELECT word_id FROM user_word_progress WHERE user_id = $2
           )
         ORDER BY w.word
         LIMIT $3`,
        [word_list_type, userId, newWordsNeeded]
      );
      newWords = newWordsRes.rows;
    }

    fastify.log.info(
      { userId, reviews: reviews.rows.length, new_words: newWords.length },
      '[words] 今日任务返回'
    );
    return {
      reviews: reviews.rows,
      new_words: newWords,
      total: reviews.rows.length + newWords.length,
    };
  });

  // POST /api/words/:wordId/review
  // Submit SM-2 quality rating for a word
  fastify.post(
    '/:wordId/review',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = req.user.sub;
      const { wordId } = req.params as Record<string, string>;
      const { quality } = z.object({ quality: z.number().min(0).max(5) }).parse(req.body);

      // Get or create progress record
      const existing = await fastify.db.query(
        `SELECT * FROM user_word_progress WHERE user_id = $1 AND word_id = $2`,
        [userId, wordId]
      );

      let state: SM2State;
      if (existing.rows.length === 0) {
        state = { easeFactor: 2.5, intervalDays: 0, repetitions: 0 };
      } else {
        const r = existing.rows[0];
        state = { easeFactor: r.ease_factor, intervalDays: r.interval_days, repetitions: r.repetitions };
      }

      const result = sm2(state, quality);

      fastify.log.info(
        { userId, wordId, quality, status: result.status, interval: result.intervalDays },
        '[words] SM-2 复习提交'
      );

      await fastify.db.query(
        `INSERT INTO user_word_progress
           (user_id, word_id, ease_factor, interval_days, repetitions, next_review, last_reviewed, status)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7)
         ON CONFLICT (user_id, word_id) DO UPDATE SET
           ease_factor = EXCLUDED.ease_factor,
           interval_days = EXCLUDED.interval_days,
           repetitions = EXCLUDED.repetitions,
           next_review = EXCLUDED.next_review,
           last_reviewed = EXCLUDED.last_reviewed,
           status = EXCLUDED.status`,
        [userId, wordId, result.easeFactor, result.intervalDays, result.repetitions, result.nextReview, result.status]
      );

      // Update study session
      const today = new Date().toISOString().split('T')[0];
      await fastify.db.query(
        `INSERT INTO study_sessions (user_id, date, words_studied)
         VALUES ($1, $2, 1)
         ON CONFLICT (user_id, date) DO UPDATE SET
           words_studied = study_sessions.words_studied + 1`,
        [userId, today]
      );

      // Update streak
      await updateStreak(fastify, userId);

      return {
        next_review: result.nextReview,
        interval_days: result.intervalDays,
        status: result.status,
      };
    }
  );

  // GET /api/words/selectable
  // Get words for AI article generation — supports source=weak|random
  fastify.get('/selectable', { preHandler: [fastify.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.user.sub;
    const source = ((req.query as any).source as string) || 'weak';
    const limit = Math.min(50, Math.max(1, Number((req.query as any).limit) || 30));

    if (source === 'weak') {
      // Weak + learning words, ordered by lowest ease_factor
      const result = await fastify.db.query(
        `SELECT w.id, w.word, w.phonetic_us, w.phonetic_uk, w.definitions
         FROM user_word_progress uwp
         JOIN words w ON w.id = uwp.word_id
         WHERE uwp.user_id = $1 AND uwp.status IN ('weak', 'learning')
         ORDER BY uwp.ease_factor ASC
         LIMIT $2`,
        [userId, limit]
      );
      return { words: result.rows };
    } else {
      // Random from studied words (any status except 'new')
      const result = await fastify.db.query(
        `SELECT w.id, w.word, w.phonetic_us, w.phonetic_uk, w.definitions
         FROM user_word_progress uwp
         JOIN words w ON w.id = uwp.word_id
         WHERE uwp.user_id = $1
         ORDER BY RANDOM()
         LIMIT $2`,
        [userId, limit]
      );
      return { words: result.rows };
    }
  });

  // GET /api/words/weak
  // Get user's weak words
  fastify.get('/weak', { preHandler: [fastify.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.user.sub;

    const result = await fastify.db.query(
      `SELECT w.id, w.word, w.phonetic_us, w.phonetic_uk, w.definitions,
              uwp.repetitions, uwp.ease_factor, uwp.status
       FROM user_word_progress uwp
       JOIN words w ON w.id = uwp.word_id
       WHERE uwp.user_id = $1 AND uwp.status = 'weak'
       ORDER BY uwp.ease_factor ASC
       LIMIT 100`,
      [userId]
    );

    return { words: result.rows, total: result.rows.length };
  });

  // GET /api/words/mastered
  fastify.get('/mastered', { preHandler: [fastify.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.user.sub;

    const result = await fastify.db.query(
      `SELECT w.id, w.word, uwp.status, uwp.interval_days
       FROM user_word_progress uwp
       JOIN words w ON w.id = uwp.word_id
       WHERE uwp.user_id = $1 AND uwp.status = 'mastered'
       ORDER BY uwp.last_reviewed DESC
       LIMIT 200`,
      [userId]
    );

    return { words: result.rows, total: result.rows.length };
  });

  // GET /api/words/:wordId
  // Word detail
  fastify.get('/:wordId', { preHandler: [fastify.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { wordId } = req.params as Record<string, string>;
    const userId = req.user.sub;

    const wordRes = await fastify.db.query(
      `SELECT w.*, uwp.status, uwp.ease_factor, uwp.interval_days, uwp.repetitions, uwp.next_review
       FROM words w
       LEFT JOIN user_word_progress uwp ON uwp.word_id = w.id AND uwp.user_id = $1
       WHERE w.id = $2`,
      [userId, wordId]
    );

    if (wordRes.rows.length === 0) return reply.status(404).send({ error: 'Word not found' });
    return wordRes.rows[0];
  });
}

async function updateStreak(fastify: FastifyInstance, userId: string) {
  const userRes = await fastify.db.query(
    `SELECT last_study_date, streak FROM users WHERE id = $1`,
    [userId]
  );
  const { last_study_date, streak } = userRes.rows[0];

  const today = new Date().toISOString().split('T')[0];
  if (last_study_date === today) return; // already updated today

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const newStreak = last_study_date === yesterdayStr ? streak + 1 : 1;

  await fastify.db.query(
    `UPDATE users SET streak = $1, last_study_date = $2 WHERE id = $3`,
    [newStreak, today, userId]
  );
}
