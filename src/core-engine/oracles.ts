/**
 * Pluggable Verification Oracles
 *
 * External prior-art (patent) and fact-checking oracles are optional in the
 * open-source standalone kernel. By default neither oracle is bound to any
 * proprietary cloud backend; callers may inject custom implementations via
 * `setVerificationOracles(...)` for domain-specific research experiments.
 */

export interface PatentNoveltyResult {
  novel: boolean;
  score: number;
  details: string;
  error?: boolean;
}

export interface PatentOracle {
  verifyNovelty(
    content: string,
    goal: string,
    context?: {
      source?: string;
      goal?: string;
      impCertIds?: string[];
      exclusionHints?: string[];
    }
  ): Promise<PatentNoveltyResult>;
}

export interface FactsVerificationResult {
  verified: boolean;
  contradiction: boolean;
  confidence: number;
  details: string;
  error?: boolean;
}

export interface FactsOracle {
  verifyStatement(
    statement: string,
    options?: { strict?: boolean }
  ): Promise<FactsVerificationResult>;
}

export interface VerificationOracles {
  patentOracle?: PatentOracle | null;
  factsOracle?: FactsOracle | null;
}

let activeOracles: VerificationOracles = {
  patentOracle: null,
  factsOracle: null,
};

export function setVerificationOracles(oracles: VerificationOracles): void {
  activeOracles = { ...activeOracles, ...oracles };
}

export function getVerificationOracles(): Readonly<VerificationOracles> {
  return activeOracles;
}

export function resetVerificationOracles(): void {
  activeOracles = { patentOracle: null, factsOracle: null };
}
