import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export default async function statsRoutes(fastify: FastifyInstance) {
  // GET /api/stats/overview
  fastify.get('/overview', { preHandler: [fastify.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.user.sub;
    const today = new Date().toISOString().split('T')[0];

    const [userRes, masteredRes, weakRes, articlesRes, todayRes] = await Promise.all([
      fastify.db.query(`SELECT streak, last_study_date FROM users WHERE id = $1`, [userId]),
      fastify.db.query(
        `SELECT COUNT(*) FROM user_word_progress WHERE user_id = $1 AND status = 'mastered'`,
        [userId]
      ),
      fastify.db.query(
        `SELECT COUNT(*) FROM user_word_progress WHERE user_id = $1 AND status = 'weak'`,
        [userId]
      ),
      fastify.db.query(
        `SELECT COUNT(*) FROM user_article_reads WHERE user_id = $1`,
        [userId]
      ),
      fastify.db.query(
        `SELECT words_studied, articles_read, duration_seconds
         FROM study_sessions WHERE user_id = $1 AND date = $2`,
        [userId, today]
      ),
    ]);

    const todaySession = todayRes.rows[0] || { words_studied: 0, articles_read: 0, duration_seconds: 0 };

    return {
      streak: userRes.rows[0]?.streak || 0,
      mastered_words: Number(masteredRes.rows[0].count),
      weak_words: Number(weakRes.rows[0].count),
      total_articles_read: Number(articlesRes.rows[0].count),
      today: {
        words_studied: todaySession.words_studied,
        articles_read: todaySession.articles_read,
        duration_seconds: todaySession.duration_seconds,
      },
    };
  });

  // GET /api/stats/calendar
  // Learning heatmap for last 90 days
  fastify.get('/calendar', { preHandler: [fastify.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.user.sub;

    const result = await fastify.db.query(
      `SELECT date, words_studied, articles_read, duration_seconds
       FROM study_sessions
       WHERE user_id = $1
         AND date >= CURRENT_DATE - INTERVAL '90 days'
       ORDER BY date ASC`,
      [userId]
    );

    return { calendar: result.rows };
  });

  // GET /api/stats/weak-distribution
  fastify.get('/weak-distribution', { preHandler: [fastify.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.user.sub;

    const result = await fastify.db.query(
      `SELECT w.word_list_type, COUNT(*) as count
       FROM user_word_progress uwp
       JOIN words w ON w.id = uwp.word_id
       WHERE uwp.user_id = $1 AND uwp.status = 'weak'
       GROUP BY w.word_list_type`,
      [userId]
    );

    return { distribution: result.rows };
  });

  // POST /api/stats/session-time
  // Update study duration for today
  fastify.post(
    '/session-time',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = req.user.sub;
      const { seconds } = req.body as any;

      if (!seconds || seconds < 0) return reply.status(400).send({ error: 'Invalid seconds' });

      const today = new Date().toISOString().split('T')[0];
      await fastify.db.query(
        `INSERT INTO study_sessions (user_id, date, duration_seconds)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, date) DO UPDATE SET
           duration_seconds = study_sessions.duration_seconds + EXCLUDED.duration_seconds`,
        [userId, today, seconds]
      );

      return { message: 'Session time recorded' };
    }
  );
}
