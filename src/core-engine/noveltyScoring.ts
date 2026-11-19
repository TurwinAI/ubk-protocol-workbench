export type EmbeddingProvider = (text: string) => Promise<number[]>;

export interface NoveltyResult {
  noveltyScore: number;
  maxSimilarity: number;
  compared: number;
  bestMatchIndex: number | null;
}

const DEFAULT_EMBEDDING_DIMS = 256;

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude === 0) return vector;
  return vector.map(val => val / magnitude);
}

function simpleHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function hashEmbed(text: string, dims: number = DEFAULT_EMBEDDING_DIMS): number[] {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const tokens = cleaned.split(/\s+/).filter(token => token.length >= 3);
  const vector = new Array(dims).fill(0);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    const index = simpleHash(token) % dims;
    const weight = 1 / Math.sqrt(i + 1);
    vector[index] += weight;
  }

  return normalizeVector(vector);
}

export function cosineSimilarity(vectorA: number[], vectorB: number[]): number {
  if (vectorA.length === 0 || vectorB.length === 0) return 0;
  const length = Math.min(vectorA.length, vectorB.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < length; i++) {
    const a = vectorA[i] || 0;
    const b = vectorB[i] || 0;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  const similarity = dot / denom;
  return Math.max(0, Math.min(1, similarity));
}

export async function semanticNovelty(
  candidate: string,
  registryTexts: string[],
  provider?: EmbeddingProvider,
  compareLimit: number = 200
): Promise<NoveltyResult> {
  if (!candidate || registryTexts.length === 0) {
    return { noveltyScore: 1, maxSimilarity: 0, compared: 0, bestMatchIndex: null };
  }

  const limitedTexts = registryTexts.slice(-compareLimit);
  if (limitedTexts.length === 0) {
    return { noveltyScore: 1, maxSimilarity: 0, compared: 0, bestMatchIndex: null };
  }

  const embed = provider ?? (async (text: string) => hashEmbed(text));
  const candidateVector = await embed(candidate);

  let maxSimilarity = 0;
  let bestMatchIndex: number | null = null;

  for (let i = 0; i < limitedTexts.length; i++) {
    const text = limitedTexts[i];
    if (!text) continue;
    const otherVector = await embed(text);
    const similarity = cosineSimilarity(candidateVector, otherVector);
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      bestMatchIndex = i;
    }
  }

  return {
    noveltyScore: Math.max(0, 1 - maxSimilarity),
    maxSimilarity,
    compared: limitedTexts.length,
    bestMatchIndex
  };
}
