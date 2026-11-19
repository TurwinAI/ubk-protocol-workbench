import type { GoogleGenAI } from '@google/genai';

type GeminiRequest = {
  model?: string;
  contents?: Array<{
    role?: string;
    parts?: Array<{ text?: string }>;
  }>;
  config?: Record<string, unknown> & {
    maxOutputTokens?: number;
  };
};

type ControlledGenerateInput = {
  client: GoogleGenAI;
  request: GeminiRequest;
  context: string;
  maxRetries?: number;
  baseRetryDelayMs?: number;
};

const extractHttpStatus = (err: unknown): number | null => {
  const anyErr = err as { status?: unknown; code?: unknown; error?: { code?: unknown }; message?: unknown };
  const direct =
    (typeof anyErr?.status === 'number' && anyErr.status) ||
    (typeof anyErr?.code === 'number' && anyErr.code) ||
    (typeof anyErr?.error?.code === 'number' && anyErr.error.code);
  if (typeof direct === 'number' && direct >= 100 && direct < 600) return direct;

  const msg = String(anyErr?.message ?? err ?? '');
  const m = msg.match(/(?:status:|"code"\s*:)\s*(\d{3})/i);
  return m ? Number(m[1]) : null;
};

const isTransientStatus = (status: number | null): boolean =>
  status !== null && [408, 429, 500, 502, 503, 504].includes(status);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function generateGeminiContentWithRateControl({
  client,
  request,
  maxRetries = 2,
  baseRetryDelayMs = 600,
}: ControlledGenerateInput): Promise<unknown> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    try {
      return await client.models.generateContent(request as Parameters<GoogleGenAI['models']['generateContent']>[0]);
    } catch (err) {
      lastError = err;
      const status = extractHttpStatus(err);
      if (!isTransientStatus(status) || attempt >= maxRetries) {
        throw err;
      }
      await sleep(baseRetryDelayMs * Math.pow(2, attempt));
      attempt += 1;
    }
  }

  throw lastError;
}
