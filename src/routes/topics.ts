import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { validateTheme } from '../services/contentFilter.js';

export default async function topicRoutes(fastify: FastifyInstance) {
  // GET /api/topics — list active topics
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (_req: FastifyRequest, _reply: FastifyReply) => {
      const result = await fastify.db.query(
        `SELECT id, name, keywords, icon
         FROM topics
         WHERE is_active = true
         ORDER BY sort_order ASC`
      );
      return { topics: result.rows };
    }
  );

  // POST /api/topics/validate — check custom theme for sensitive content
  fastify.post(
    '/validate',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const Body = z.object({ theme: z.string() });
      const { theme } = Body.parse(req.body);
      const result = validateTheme(theme);
      return result;
    }
  );
}
