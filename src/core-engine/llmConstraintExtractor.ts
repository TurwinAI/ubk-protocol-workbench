import { GoogleGenAI } from '@google/genai';
import type { ConstraintDomain, EncodedConstraint, SMTFormula } from './constraintEncoder';
import { getModelConfig } from '../config/modelConfig';

interface LLMConstraint {
  domain: string;
  claim: string;
  confidence: number;
  originalText: string;
}

const LLM_ALLOWED_DOMAINS = new Set<ConstraintDomain>([
  'PHYSICS',
  'COMPLEXITY',
  'LOGIC',
  'RESOURCES',
  'BIOLOGY',
]);

function stripCodeFences(text: string): string {
  return text.replace(/```json/gi, '').replace(/```/g, '').trim();
}

function extractJsonEnclosure(text: string, openChar: '[' | '{', closeChar: ']' | '}'): string | null {
  const start = text.indexOf(openChar);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === '\\') {
        escapeNext = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === openChar) {
      depth += 1;
      continue;
    }
    if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseConstraintsJson(rawText: string): LLMConstraint[] {
  const cleaned = stripCodeFences(rawText);
  const candidate = extractJsonEnclosure(cleaned, '[', ']') ?? cleaned;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is LLMConstraint =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).domain === 'string' &&
      typeof (item as Record<string, unknown>).claim === 'string'
  );
}

/**
 * Optional BYOK LLM-assisted constraint extraction.
 *
 * - In deterministic replay mode (no GEMINI_API_KEY configured), returns `[]`
 *   cleanly so deterministic pattern/SMT encoding runs offline.
 * - When `strict` is true (or `apiKey` is explicitly passed in live mode),
 *   upstream API errors propagate instead of being silently swallowed.
 */
export async function extractConstraintsWithLLM(
  text: string,
  options?: { apiKey?: string; strict?: boolean }
): Promise<EncodedConstraint[]> {
  const config = await getModelConfig(options?.apiKey);
  const apiKey = config.apiKey;

  if (!apiKey) {
    if (options?.strict) {
      throw new Error('GEMINI_API_KEY is required for live LLM constraint extraction.');
    }
    return [];
  }

  const client = new GoogleGenAI({ apiKey });
  const prompt = [
    'Extract formal scientific, mathematical, or algorithmic constraints from the text below.',
    'Return ONLY a JSON array of objects: [{"domain":"COMPLEXITY|PHYSICS|LOGIC|RESOURCES|BIOLOGY","claim":"...","confidence":0.8,"originalText":"..."}]',
    '',
    text.slice(0, 4000),
  ].join('\n');

  const response = await client.models.generateContent({
    model: config.fastModel,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { temperature: 0.1, maxOutputTokens: 1024 },
  });

  const rawText =
    typeof response.text === 'string'
      ? response.text
      : (response.candidates?.[0]?.content?.parts ?? [])
          .map((p: { text?: string }) => p.text ?? '')
          .join('\n');

  const extracted = parseConstraintsJson(rawText);
  return extracted
    .filter((item) => LLM_ALLOWED_DOMAINS.has(item.domain as ConstraintDomain))
    .map((item, idx) => {
      const domain = item.domain as ConstraintDomain;
      const formula: SMTFormula = {
        smtlib: `; LLM-extracted semantic constraint ${idx + 1}\n; ${item.claim}\n(assert true)\n(check-sat)`,
        description: item.claim,
        domain,
        variables: [],
        sourcePattern: 'LLM_SEMANTIC_EXTRACTION',
      };
      return {
        formula,
        confidence: Math.max(0.1, Math.min(0.95, Number(item.confidence) || 0.55)),
        originalText: item.originalText || text.slice(0, 200),
      };
    });
}
