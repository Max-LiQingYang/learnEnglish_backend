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
import topicRoutes from './routes/topics.js';
import { sendErrorAlert } from './services/alerts.js';

const isDev = process.env.NODE_ENV !== 'production';
const slowRequestMs = Number(process.env.SLOW_REQUEST_MS) > 0
  ? Number(process.env.SLOW_REQUEST_MS)
  : 1000;

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

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  fastify.log.error({ err: reason }, 'unhandled promise rejection');
  void sendErrorAlert({
    type: 'unhandled_rejection',
    message,
    stack: reason instanceof Error ? reason.stack : undefined,
  }, fastify.log);
});

process.on('uncaughtException', (error) => {
  fastify.log.fatal({ err: error }, 'uncaught exception');
  void sendErrorAlert({
    type: 'uncaught_exception',
    message: error.message,
    stack: error.stack,
  }, fastify.log).finally(() => process.exit(1));
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
    const elapsedMs = reply.elapsedTime;
    const ms = elapsedMs.toFixed(1);
    const level = reply.statusCode >= 500 ? 'error'
                : elapsedMs >= slowRequestMs ? 'warn'
                : reply.statusCode >= 400 ? 'warn'
                : 'info';
    fastify.log[level](
      {
        method: req.method,
        url: req.url,
        status: reply.statusCode,
        ms,
        requestId: req.id,
        slow: elapsedMs >= slowRequestMs,
      },
      elapsedMs >= slowRequestMs
        ? `slow request ${reply.statusCode} ${ms}ms`
        : `← ${reply.statusCode} ${ms}ms`
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
    const statusCode = error.statusCode || 500;
    fastify.log.error(
      { url: req.url, method: req.method, err: error.message, stack: error.stack, requestId: req.id },
      '未处理异常'
    );
    if (statusCode >= 500) {
      void sendErrorAlert({
        type: 'http_error',
        message: error.message || 'Internal server error',
        method: req.method,
        url: req.url,
        statusCode,
        requestId: req.id,
        stack: error.stack,
      }, fastify.log);
    }
    return reply.status(statusCode).send({
      error: error.message || 'Internal server error',
    });
  });

  // ── 路由注册 ──────────────────────────────────────────────
  await fastify.register(authRoutes,    { prefix: '/api/auth' });
  await fastify.register(wordRoutes,    { prefix: '/api/words' });
  await fastify.register(articleRoutes, { prefix: '/api/articles' });
  await fastify.register(ttsRoutes,     { prefix: '/api/tts' });
  await fastify.register(statsRoutes,   { prefix: '/api/stats' });
  await fastify.register(topicRoutes,   { prefix: '/api/topics' });

  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  const port = Number(process.env.PORT) || 3000;
  await fastify.listen({ port, host: '0.0.0.0' });
  fastify.log.info(`🚀 服务启动 http://0.0.0.0:${port}  [${process.env.NODE_ENV || 'development'}]`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
