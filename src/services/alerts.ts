import { FastifyBaseLogger } from 'fastify';

type AlertPayload = {
  type: string;
  message: string;
  method?: string;
  url?: string;
  statusCode?: number;
  requestId?: string;
  stack?: string;
  details?: Record<string, unknown>;
};

let lastAlertAt = 0;

function intFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export async function sendErrorAlert(payload: AlertPayload, logger?: FastifyBaseLogger) {
  const webhookUrl = process.env.ERROR_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;

  const cooldownMs = intFromEnv('ERROR_ALERT_COOLDOWN_MS', 60000);
  const now = Date.now();
  if (cooldownMs > 0 && now - lastAlertAt < cooldownMs) return;
  lastAlertAt = now;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        service: 'learn-english-backend',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        ...payload,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    logger?.warn({ err }, 'error alert webhook failed');
  } finally {
    clearTimeout(timeout);
  }
}
