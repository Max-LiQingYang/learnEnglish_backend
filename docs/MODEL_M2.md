# MiniMax M2.5 模型集成

> 添加时间: 2026-04-09

## 概述

本项目新增 MiniMax M2.5 模型支持，通过 Anthropic 兼容 API 调用。

**模型**: `MiniMax-M2.5` / `MiniMax-M2.5-highspeed`
**文档**: https://platform.minimaxi.com/docs/api-reference/text-anthropic-api
**Token 计划**: https://platform.minimaxi.com/subscribe/token-plan

## 新增文件

- `src/services/m2.ts` — M2.5 模型服务封装

## 环境变量

在 `.env` 中添加：

```env
MINIMAX_M2_API_KEY=your-m2-api-key
```

（Key 从 https://platform.minimaxi.com/subscribe/token-plan 获取）

## 使用方式

```typescript
import { m2Chat, askM2, m2ChatWithThinking } from './services/m2';

// 简单问答
const reply = await askM2('What is the past tense of "go"?');

// 多轮对话
const reply = await m2Chat({
  messages: [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi!' },
    { role: 'user', content: 'Explain "serendipity"' },
  ],
  system: 'You are an English tutor.',
  temperature: 0.7,
  maxTokens: 500,
});

// 带思维链（复杂推理）
const { text, thinking } = await m2ChatWithThinking({
  messages: [{ role: 'user', content: 'Explain quantum entanglement' }],
  thinkingBudget: 2048,
});
```

## API 签名

### `m2Chat(opts)`
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `messages` | `Message[]` | 必填 | 对话历史 |
| `system` | `string` | `'You are a helpful assistant.'` | 系统提示词 |
| `maxTokens` | `number` | `1024` | 最大输出 token 数 |
| `temperature` | `number` | `0.7` | 随机性控制 (0.0, 1.0] |
| `model` | `string` | `'MiniMax-M2.5'` | 模型名，可选 `MiniMax-M2.5-highspeed` |

### `m2ChatWithThinking(opts)`
同上，额外参数 `thinkingBudget`（默认 1024），返回 `{ text, thinking }`。

### `askM2(prompt, system?)`
单轮问答快捷函数。

## 与旧版 Minimax 的区别

| | 旧版 `minimax.ts` | 新版 `m2.ts` |
|---|---|---|
| API 格式 | 私有 v1 API | Anthropic 兼容 |
| 模型 | `abab6.5s-chat` | `MiniMax-M2.5` |
| 工具支持 | 无 | 支持 function calling |
| 思维链 | 不支持 | 支持 |
| Token 窗口 | 未知 | 204,800 |
| SDK | 原生 fetch | `@anthropic-ai/sdk` |
| 环境变量 | `MINIMAX_API_KEY` | `MINIMAX_M2_API_KEY` |

## 后续规划

- [ ] 将 `generateArticle` / `analyzeGrammar` 迁移至 M2 模型
- [ ] 新增 AI 对话练习功能（英语聊天）
- [ ] 新增作文批改功能
