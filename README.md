# learnEnglish Backend

英语学习 App 后端 API（Fastify + TypeScript）

## 技术栈

- **框架**: Fastify + TypeScript
- **数据库**: PostgreSQL + Redis
- **认证**: JWT
- **AI 模型**:
  - `minimax.ts` — 旧版 `abab6.5s-chat`（文章生成、语法分析、TTS）
  - `m2.ts` — 新版 `MiniMax-M2.5`（Anthropic 兼容，详见 `docs/MODEL_M2.md`）

## 快速开始

```bash
npm install
npm run dev
```

## 环境变量

复制 `.env.example` 为 `.env` 并填写：

```bash
cp .env.example .env
```

关键变量：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `REDIS_URL` | Redis 连接串 |
| `JWT_SECRET` | JWT 签名密钥 |
| `SMTP_HOST/PORT/USER/PASS` | 邮件发送配置 |
| `MINIMAX_API_KEY` | 旧版 Minimax API Key |
| `MINIMAX_M2_API_KEY` | M2.5 API Key（Anthropic 兼容） |

## 文档

- [MiniMax M2.5 模型集成](docs/MODEL_M2.md) — 新增 (2026-04-09)

## API 路由

| 路由 | 说明 |
|------|------|
| `POST /auth/register` | 用户注册 |
| `POST /auth/login` | 用户登录 |
| `GET /words` | 单词列表 |
| `POST /words/:id/review` | 单词复习（SM2 算法） |
| `GET /articles` | 文章列表 |
| `GET /articles/:id` | 文章详情 |
| `GET /tts/:articleId` | 文章朗读（TTS） |
| `GET /stats` | 学习统计 |

## 开发

```bash
# 启动开发服务器（热重载）
npm run dev

# 生产构建
npm run build
npm start

# 数据库迁移
npm run db:migrate
```
