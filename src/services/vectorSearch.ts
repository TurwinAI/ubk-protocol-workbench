/**
 * Pluggable local semantic search boundary (replaces cloud vector search).
 */

export interface VectorHit {
  id: string;
  text?: string;
  metadata?: Record<string, unknown>;
}

export interface SemanticSearchRequest {
  workspaceId: string;
  query: string;
  limit?: number;
}

export type SemanticSearchProvider = (req: SemanticSearchRequest) => Promise<VectorHit[]>;

let customProvider: SemanticSearchProvider | null = null;

export function setSemanticSearchProvider(provider: SemanticSearchProvider | null): void {
  customProvider = provider;
}

export async function semanticSearch(req: SemanticSearchRequest): Promise<VectorHit[]> {
  if (!customProvider) {
    return [];
  }
  return customProvider(req);
}
