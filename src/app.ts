import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';

import dbPlugin from './plugins/db.js';
import redisPlugin from './plugins/redis.js';
import authPlugin from './plugins/auth.js';

import authRoutes from './routes/auth.js';
import wordRoutes from './routes/words.js';
import articleRoutes from './routes/articles.js';
import ttsRoutes from './routes/tts.js';
import statsRoutes from './routes/stats.js';

const isDev = process.env.NODE_ENV !== 'production';

const fastify = Fastify({
  logger: isDev
    ? {
        level: 'debug',
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
            messageFormat: '{msg}',
          },
        },
      }
    : { level: 'warn' },
});

async function start() {
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });

  await fastify.register(dbPlugin);
  await fastify.register(redisPlugin);
  await fastify.register(authPlugin);

  // ── 请求日志 ──────────────────────────────────────────────
  fastify.addHook('onRequest', (req, _reply, done) => {
    fastify.log.info({ method: req.method, url: req.url }, '→ 收到请求');
    done();
  });

  // ── 响应日志 ──────────────────────────────────────────────
  fastify.addHook('onResponse', (req, reply, done) => {
    const ms = reply.elapsedTime.toFixed(1);
    const level = reply.statusCode >= 500 ? 'error'
                : reply.statusCode >= 400 ? 'warn'
                : 'info';
    fastify.log[level](
      { method: req.method, url: req.url, status: reply.statusCode, ms },
      `← ${reply.statusCode} ${ms}ms`
    );
    done();
  });

  // ── 错误处理 ──────────────────────────────────────────────
  fastify.setErrorHandler((error, req, reply) => {
    if (error.name === 'ZodError') {
      fastify.log.warn({ url: req.url, details: error.message }, '参数校验失败');
      return reply.status(400).send({
        error: 'Validation error',
        details: JSON.parse(error.message),
      });
    }
    fastify.log.error(
      { url: req.url, method: req.method, err: error.message, stack: error.stack },
      '未处理异常'
    );
    return reply.status(error.statusCode || 500).send({
      error: error.message || 'Internal server error',
    });
  });

  // ── 路由注册 ──────────────────────────────────────────────
  await fastify.register(authRoutes,    { prefix: '/api/auth' });
  await fastify.register(wordRoutes,    { prefix: '/api/words' });
  await fastify.register(articleRoutes, { prefix: '/api/articles' });
  await fastify.register(ttsRoutes,     { prefix: '/api/tts' });
  await fastify.register(statsRoutes,   { prefix: '/api/stats' });

  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  const port = Number(process.env.PORT) || 3000;
  await fastify.listen({ port, host: '0.0.0.0' });
  fastify.log.info(`🚀 服务启动 http://0.0.0.0:${port}  [${process.env.NODE_ENV || 'development'}]`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
