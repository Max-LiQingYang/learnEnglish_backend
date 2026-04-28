import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';

declare module 'fastify' {
  interface FastifyInstance {
    db: Pool;
  }
}

function intFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function queryText(query: unknown): string {
  if (typeof query === 'string') return query;
  if (query && typeof query === 'object' && 'text' in query) {
    const text = (query as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return '[unknown query]';
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().slice(0, 500);
}

export default fp(async (fastify: FastifyInstance) => {
  const max = intFromEnv('DB_POOL_MAX', 10);
  const slowQueryMs = intFromEnv('SLOW_QUERY_MS', 200);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  await pool.connect(); // verify connection on startup

  const originalQuery = pool.query.bind(pool);
  (pool as any).query = async (...args: any[]) => {
    const started = process.hrtime.bigint();
    try {
      return await (originalQuery as any)(...args);
    } finally {
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      if (elapsedMs >= slowQueryMs) {
        fastify.log.warn(
          {
            elapsedMs: Number(elapsedMs.toFixed(1)),
            thresholdMs: slowQueryMs,
            sql: normalizeSql(queryText(args[0])),
          },
          'slow database query'
        );
      }
    }
  };

  fastify.log.info({ max, slowQueryMs }, 'database pool initialized');

  fastify.decorate('db', pool);

  fastify.addHook('onClose', async () => {
    await pool.end();
  });
});
