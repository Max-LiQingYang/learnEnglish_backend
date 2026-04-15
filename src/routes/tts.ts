import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { synthesizeSpeech, splitIntoSentences } from '../services/minimax.js';

export default async function ttsRoutes(fastify: FastifyInstance) {
  // GET /api/tts/:articleId — legacy whole-article TTS
  fastify.get(
    '/:articleId',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { articleId } = req.params as { articleId: string };

      // Check cache
      const cached = await fastify.db.query(
        `SELECT audio_url FROM tts_cache WHERE article_id = $1`,
        [articleId]
      );

      if (cached.rows.length > 0) {
        return { audio_url: cached.rows[0].audio_url };
      }

      const articleRes = await fastify.db.query(
        `SELECT title, content FROM articles WHERE id = $1`,
        [articleId]
      );

      if (articleRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Article not found' });
      }

      const { title, content } = articleRes.rows[0];
      const text = `${title}. ${content}`.slice(0, 5000);

      const lockKey = `tts:lock:${articleId}`;
      const locked = await fastify.redis.set(lockKey, '1', 'EX', 60, 'NX');
      if (!locked) {
        return reply.status(202).send({ message: 'Audio is being generated, please retry in a moment' });
      }

      try {
        fastify.log.info({ articleId, textLength: text.length }, '[tts] 开始语音合成');
        const audioBuffer = await synthesizeSpeech(text);
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

  // GET /api/tts/:articleId/sentences — get cached sentence TTS data
  fastify.get(
    '/:articleId/sentences',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { articleId } = req.params as { articleId: string };

      const result = await fastify.db.query(
        `SELECT sort_order as index, sentence as text, audio_data, duration_ms as duration
         FROM tts_sentence_cache
         WHERE article_id = $1
         ORDER BY sort_order ASC`,
        [articleId]
      );

      return { sentences: result.rows };
    }
  );

  // POST /api/tts/:articleId/stream — SSE streaming sentence-by-sentence TTS
  fastify.post(
    '/:articleId/stream',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { articleId } = req.params as { articleId: string };
      const Body = z.object({ speed: z.number().min(0.5).max(2.0).default(1.0) });
      const { speed } = Body.parse(req.body || {});

      // Get article
      const articleRes = await fastify.db.query(
        `SELECT title, content FROM articles WHERE id = $1`,
        [articleId]
      );

      if (articleRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Article not found' });
      }

      const { content } = articleRes.rows[0];
      const sentences = splitIntoSentences(content);

      if (sentences.length === 0) {
        return reply.status(400).send({ error: 'No sentences found in article' });
      }

      // Check if all sentences are already cached
      const cachedRes = await fastify.db.query(
        `SELECT sort_order, audio_data, duration_ms
         FROM tts_sentence_cache
         WHERE article_id = $1
         ORDER BY sort_order ASC`,
        [articleId]
      );

      const cachedMap = new Map<number, { audio_data: string; duration_ms: number }>();
      for (const row of cachedRes.rows) {
        cachedMap.set(row.sort_order, { audio_data: row.audio_data, duration_ms: row.duration_ms });
      }

      // Lock to prevent concurrent generation
      const lockKey = `tts:stream:${articleId}`;
      const locked = await fastify.redis.set(lockKey, '1', 'EX', 120, 'NX');
      if (!locked) {
        // Check if we have cached data to return
        if (cachedMap.size === sentences.length) {
          // All cached, return directly
        } else {
          return reply.status(202).send({ message: 'TTS is being generated, please retry in a moment' });
        }
      }

      // Set SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const sendEvent = (event: string, data: unknown) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const halfIndex = Math.ceil(sentences.length / 2);

        // Generate first half
        for (let i = 0; i < sentences.length; i++) {
          const s = sentences[i];

          // Check cache
          if (cachedMap.has(i)) {
            const cached = cachedMap.get(i)!;
            sendEvent('sentence', {
              index: i,
              text: s.text,
              audio: cached.audio_data,
              duration: cached.duration_ms,
            });
          } else {
            try {
              const audioBuffer = await synthesizeSpeech(s.text, speed);
              const audioBase64 = audioBuffer.toString('base64');
              const durationMs = Math.round((audioBuffer.length / (128000 / 8)) * 1000); // estimate

              // Cache to DB
              await fastify.db.query(
                `INSERT INTO tts_sentence_cache (article_id, sentence, audio_data, duration_ms, sort_order)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (article_id, sort_order) DO NOTHING`,
                [articleId, s.text, audioBase64, durationMs, i]
              );

              sendEvent('sentence', {
                index: i,
                text: s.text,
                audio: audioBase64,
                duration: durationMs,
              });
            } catch (e) {
              fastify.log.error({ articleId, sentenceIndex: i, err: (e as Error).message }, '[tts] 句子合成失败');
              sendEvent('error', { index: i, message: 'TTS failed for this sentence' });
            }
          }

          // After first half, send generation_complete event
          if (i === halfIndex - 1) {
            sendEvent('generation_complete', { processed: halfIndex, total: sentences.length });
          }
        }

        sendEvent('complete', { total: sentences.length });
      } catch (e) {
        fastify.log.error({ articleId, err: (e as Error).message }, '[tts] 流式 TTS 失败');
        sendEvent('error', { message: 'TTS generation failed' });
      } finally {
        await fastify.redis.del(lockKey);
        reply.raw.end();
      }
    }
  );
}
