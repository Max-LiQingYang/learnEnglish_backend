/**
 * MiniMax M2.5 Model Service (Anthropic API 兼容)
 *
 * 文档: https://platform.minimaxi.com/docs/api-reference/text-anthropic-api
 * 模型: MiniMax-M2.5 / MiniMax-M2.5-highspeed
 *
 * 用法:
 *   import { m2Chat } from './services/m2';
 *   const reply = await m2Chat({ messages: [{ role: 'user', content: 'Hello' }] });
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  baseURL: 'https://api.minimaxi.com/anthropic',
  apiKey: process.env.MINIMAX_M2_API_KEY, // 独立 API Key，与旧版 MINIMAX_API_KEY 分开
});

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatOptions {
  messages: Message[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  model?: 'MiniMax-M2.5' | 'MiniMax-M2.5-highspeed';
}

/**
 * 通用对话接口
 */
export async function m2Chat(opts: ChatOptions): Promise<string> {
  const {
    messages,
    system = 'You are a helpful assistant.',
    maxTokens = 1024,
    temperature = 0.7,
    model = 'MiniMax-M2.5',
  } = opts;

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: messages as Anthropic.MessageParam[],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}

/**
 * 带思维链的对话（适用于复杂推理任务）
 */
export async function m2ChatWithThinking(opts: ChatOptions & { thinkingBudget?: number }): Promise<{
  text: string;
  thinking?: string;
}> {
  const {
    messages,
    system = 'You are a helpful assistant.',
    maxTokens = 1024,
    temperature = 0.7,
    thinkingBudget = 1024,
    model = 'MiniMax-M2.5',
  } = opts;

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    thinking: { type: 'enabled', budget_tokens: thinkingBudget },
    system,
    messages: messages as Anthropic.MessageParam[],
  });

  let thinking: string | undefined;
  let text: string = '';

  for (const block of response.content) {
    if (block.type === 'thinking' && 'thinking' in block) {
      thinking = block.thinking;
    } else if (block.type === 'text' && 'text' in block) {
      text = block.text;
    }
  }

  return { text, thinking };
}

/**
 * 快捷函数：单轮问答
 */
export async function askM2(prompt: string, system?: string): Promise<string> {
  return m2Chat({
    messages: [{ role: 'user', content: prompt }],
    system,
  });
}
