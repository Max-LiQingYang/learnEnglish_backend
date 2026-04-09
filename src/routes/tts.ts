import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { synthesizeSpeech } from '../services/minimax.js';

export default async function ttsRoutes(fastify: FastifyInstance) {
  // GET /api/tts/:articleId
  // Get or generate TTS audio for an article
  fastify.get(
    '/:articleId',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { articleId: string } }>, reply: FastifyReply) => {
      const { articleId } = req.params;

      // Check cache
      const cached = await fastify.db.query(
        `SELECT audio_url FROM tts_cache WHERE article_id = $1`,
        [articleId]
      );

      if (cached.rows.length > 0) {
        return { audio_url: cached.rows[0].audio_url };
      }

      // Get article content
      const articleRes = await fastify.db.query(
        `SELECT title, content FROM articles WHERE id = $1`,
        [articleId]
      );

      if (articleRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Article not found' });
      }

      const { title, content } = articleRes.rows[0];
      const text = `${title}. ${content}`.slice(0, 5000); // Minimax TTS limit

      // Check Redis for in-progress synthesis
      const lockKey = `tts:lock:${articleId}`;
      const locked = await fastify.redis.set(lockKey, '1', 'EX', 60, 'NX');
      if (!locked) {
        return reply.status(202).send({ message: 'Audio is being generated, please retry in a moment' });
      }

      try {
        fastify.log.info({ articleId, textLength: text.length }, '[tts] 开始语音合成');
        const audioBuffer = await synthesizeSpeech(text);

        // In production, upload to object storage (S3/OSS) and store URL.
        // For MVP: return as base64 data URL (< 5MB articles).
        const audioBase64 = audioBuffer.toString('base64');
        const audioUrl = `data:audio/mp3;base64,${audioBase64}`;

        await fastify.db.query(
          `INSERT INTO tts_cache (article_id, audio_url) VALUES ($1, $2)
           ON CONFLICT (article_id) DO UPDATE SET audio_url = EXCLUDED.audio_url`,
          [articleId, audioUrl]
        );

        fastify.log.info({ articleId, bytes: audioBuffer.length }, '[tts] 语音合成完成');
        return { audio_url: audioUrl };
      } finally {
        await fastify.redis.del(lockKey);
      }
    }
  );
}
