import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { sendVerificationEmail } from '../services/email.js';

const RegisterBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  word_list_type: z.enum(['gaokao', 'cet4', 'cet6', 'kaoyan', 'toefl', 'ielts']),
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string(),
});

const RefreshBody = z.object({
  refresh_token: z.string(),
});

function makeTokens(fastify: FastifyInstance, userId: string, email: string) {
  const access = fastify.jwt.sign(
    { sub: userId, email, type: 'access' },
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
  const refresh = fastify.jwt.sign(
    { sub: userId, email, type: 'refresh' },
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
  );
  return { access, refresh };
}

export default async function authRoutes(fastify: FastifyInstance) {
  // POST /api/auth/register
  fastify.post('/register', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = RegisterBody.parse(req.body);
    const { email, password, word_list_type } = body;

    fastify.log.info({ email, word_list_type }, '[auth] 注册请求');

    const existing = await fastify.db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      fastify.log.warn({ email }, '[auth] 邮箱已注册');
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const userResult = await fastify.db.query(
      `INSERT INTO users (email, password_hash, word_list_type)
       VALUES ($1, $2, $3) RETURNING id, email`,
      [email, password_hash, word_list_type]
    );
    const user = userResult.rows[0];
    fastify.log.info({ userId: user.id, email }, '[auth] 用户创建成功');

    const isDev = process.env.NODE_ENV !== 'production';

    if (isDev) {
      // 本地开发：跳过邮件，直接验证通过
      await fastify.db.query('UPDATE users SET is_verified = true WHERE id = $1', [user.id]);
      fastify.log.info({ email }, '[auth] 开发模式：自动跳过邮箱验证');
    } else {
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await fastify.db.query(
        `INSERT INTO verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
        [user.id, token, expiresAt]
      );
      await sendVerificationEmail(email, token);
      fastify.log.info({ email }, '[auth] 验证邮件已发送');
    }

    return reply.status(201).send({
      message: 'Registration successful. Please check your email to verify your account.',
      user_id: user.id,
    });
  });

  // GET /api/auth/verify-email?token=xxx
  fastify.get('/verify-email', async (req: FastifyRequest<{ Querystring: { token: string } }>, reply: FastifyReply) => {
    const { token } = req.query;
    if (!token) return reply.status(400).send({ error: 'Token required' });

    fastify.log.debug({ token: token.slice(0, 8) + '...' }, '[auth] 邮箱验证');

    const result = await fastify.db.query(
      `SELECT vt.user_id, vt.expires_at FROM verification_tokens vt WHERE vt.token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      fastify.log.warn('[auth] 验证 token 无效');
      return reply.status(400).send({ error: 'Invalid or expired token' });
    }

    const { user_id, expires_at } = result.rows[0];
    if (new Date(expires_at) < new Date()) {
      fastify.log.warn({ user_id }, '[auth] 验证 token 已过期');
      return reply.status(400).send({ error: 'Token expired' });
    }

    await fastify.db.query('UPDATE users SET is_verified = true WHERE id = $1', [user_id]);
    await fastify.db.query('DELETE FROM verification_tokens WHERE user_id = $1', [user_id]);
    fastify.log.info({ user_id }, '[auth] 邮箱验证成功');

    return { message: 'Email verified successfully. You can now log in.' };
  });

  // POST /api/auth/login
  fastify.post('/login', async (req: FastifyRequest, reply: FastifyReply) => {
    const { email, password } = LoginBody.parse(req.body);
    fastify.log.info({ email }, '[auth] 登录请求');

    const result = await fastify.db.query(
      `SELECT id, email, password_hash, is_verified, word_list_type,
              daily_word_goal, daily_article_goal, streak
       FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      fastify.log.warn({ email }, '[auth] 用户不存在');
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    if (!user.is_verified) {
      fastify.log.warn({ email }, '[auth] 邮箱未验证');
      return reply.status(403).send({ error: 'Please verify your email before logging in' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      fastify.log.warn({ email }, '[auth] 密码错误');
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const { access, refresh } = makeTokens(fastify, user.id, user.email);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await fastify.db.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.id, refresh, expiresAt]
    );

    fastify.log.info({ userId: user.id, email }, '[auth] 登录成功');
    return {
      access_token: access,
      refresh_token: refresh,
      user: {
        id: user.id,
        email: user.email,
        word_list_type: user.word_list_type,
        daily_word_goal: user.daily_word_goal,
        daily_article_goal: user.daily_article_goal,
        streak: user.streak,
      },
    };
  });

  // POST /api/auth/refresh
  fastify.post('/refresh', async (req: FastifyRequest, reply: FastifyReply) => {
    const { refresh_token } = RefreshBody.parse(req.body);
    fastify.log.debug('[auth] Token 刷新请求');

    let payload: { sub: string; email: string; type: string };
    try {
      payload = fastify.jwt.verify(refresh_token) as typeof payload;
    } catch {
      fastify.log.warn('[auth] refresh token 签名无效');
      return reply.status(401).send({ error: 'Invalid refresh token' });
    }

    if (payload.type !== 'refresh') {
      return reply.status(401).send({ error: 'Invalid token type' });
    }

    const stored = await fastify.db.query(
      `SELECT id, expires_at FROM refresh_tokens WHERE token = $1 AND user_id = $2`,
      [refresh_token, payload.sub]
    );

    if (stored.rows.length === 0 || new Date(stored.rows[0].expires_at) < new Date()) {
      fastify.log.warn({ userId: payload.sub }, '[auth] refresh token 已过期或不存在');
      return reply.status(401).send({ error: 'Refresh token expired or not found' });
    }

    await fastify.db.query('DELETE FROM refresh_tokens WHERE token = $1', [refresh_token]);
    const { access, refresh: newRefresh } = makeTokens(fastify, payload.sub, payload.email);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await fastify.db.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [payload.sub, newRefresh, expiresAt]
    );

    fastify.log.info({ userId: payload.sub }, '[auth] Token 轮换成功');
    return { access_token: access, refresh_token: newRefresh };
  });

  // POST /api/auth/logout
  fastify.post('/logout', { preHandler: [fastify.authenticate] }, async (req: FastifyRequest<{ Body: { refresh_token?: string } }>, reply: FastifyReply) => {
    const userId = req.user.sub;
    const { refresh_token } = req.body || {};
    if (refresh_token) {
      await fastify.db.query('DELETE FROM refresh_tokens WHERE token = $1', [refresh_token]);
    }
    fastify.log.info({ userId }, '[auth] 用户退出登录');
    return { message: 'Logged out' };
  });

  // GET /api/auth/me
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.user.sub;
    const result = await fastify.db.query(
      `SELECT id, email, word_list_type, daily_word_goal, daily_article_goal,
              push_enabled, push_time, streak, last_study_date, created_at
       FROM users WHERE id = $1`,
      [userId]
    );
    if (result.rows.length === 0) return reply.status(404).send({ error: 'User not found' });
    return result.rows[0];
  });

  // PATCH /api/auth/settings
  fastify.patch('/settings', { preHandler: [fastify.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.user.sub;
    const SettingsBody = z.object({
      daily_word_goal: z.number().min(1).max(200).optional(),
      daily_article_goal: z.number().min(0).max(10).optional(),
      push_enabled: z.boolean().optional(),
      push_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    });
    const updates = SettingsBody.parse(req.body);
    const fields = Object.entries(updates).filter(([, v]) => v !== undefined);
    if (fields.length === 0) return reply.status(400).send({ error: 'No fields to update' });

    const setClauses = fields.map(([k], i) => `${k} = $${i + 2}`).join(', ');
    const values = fields.map(([, v]) => v);
    await fastify.db.query(`UPDATE users SET ${setClauses} WHERE id = $1`, [userId, ...values]);

    fastify.log.info({ userId, fields: fields.map(([k]) => k) }, '[auth] 设置已更新');
    return { message: 'Settings updated' };
  });
}
