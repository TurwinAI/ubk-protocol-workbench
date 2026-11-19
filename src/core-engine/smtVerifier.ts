/**
 * SMT Verifier Service (Epistemically Honest Grading)
 * ===================================================
 *
 * Evaluates quantitative SMT-LIB2 formulas using Z3 WebAssembly (in Node.js)
 * or the exact ground/affine evaluator (on Cloudflare Workers edge).
 *
 * Strict epistemic soundness tiers:
 * - `FORMAL_SMT`:        Z3 / exact SMT evaluator proved SAT or UNSAT on a genuine
 *                        quantitative/structural formula asserting BOTH law and claim.
 * - `STRUCTURAL_CHECK`:  Deterministic structural checker (e.g. linear resource-flow
 *                        conservation or DAG acyclicity) proved a violation/property.
 * - `HEURISTIC_PATTERN`: Curated axiom pattern matched text (NEVER labeled FORMAL_SMT).
 * - `UNVERIFIED`:        No formal model extracted or solver returned unknown/timeout.
 */

import {
  constraintEncoder,
  isMetaDiscussionPrompt,
  type EncodedConstraint,
  type ConstraintDomain,
} from './constraintEncoder';
import { parseRecipeToLogic, verifyNoCloning } from './logicParser';

export type SMTVerdict = 'IMPOSSIBLE' | 'POSSIBLE' | 'UNKNOWN';

export type VerificationSoundness =
  | 'FORMAL_SMT'
  | 'STRUCTURAL_CHECK'
  | 'HEURISTIC_PATTERN'
  | 'UNVERIFIED';

export interface SMTResult {
  verdict: SMTVerdict;
  proof?: string;
  counterexample?: Record<string, unknown>;
  timeMs: number;
  soundness: VerificationSoundness;
  domain?: ConstraintDomain;
  constraintText?: string;
  smtlib?: string;
}

export interface SMTVerifierConfig {
  timeoutMs: number;
  useFullSolver: boolean;
  enableCache: boolean;
  maxCacheSize: number;
}

const DEFAULT_CONFIG: SMTVerifierConfig = {
  timeoutMs: 2500,
  useFullSolver: true,
  enableCache: true,
  maxCacheSize: 1000,
};

export const DEFAULT_SMT_VERIFIER_CONFIG: SMTVerifierConfig = { ...DEFAULT_CONFIG };

/**
 * Curated qualitative impossibility patterns (strictly labeled HEURISTIC_PATTERN,
 * NEVER FORMAL_SMT). Open conjectures (such as P vs NP and integer factoring) are
 * deliberately EXCLUDED here and handled as flagged open conjectures instead.
 */
const HEURISTIC_IMPOSSIBILITY_PATTERNS: Array<{
  pattern: RegExp;
  theorem: string;
  proof: string;
  domain: ConstraintDomain;
}> = [
  {
    pattern: /(?:solve|decide)\s+(?:the\s+)?halting\s+problem/i,
    theorem: 'Halting Problem Undecidability (Turing 1936)',
    proof: 'Heuristic pattern match: no general algorithm can decide whether an arbitrary Turing machine halts.',
    domain: 'COMPLEXITY',
  },
  {
    pattern: /perpetual\s+motion|over[- ]?unity|free\s+energy\s+(?:device|machine)/i,
    theorem: 'First and Second Laws of Thermodynamics',
    proof: 'Heuristic pattern match: closed-cycle perpetual motion / over-unity energy generation violates conservation of energy and entropy monotonicity.',
    domain: 'PHYSICS',
  },
  {
    pattern: /faster\s+than\s+light|FTL\s+(?:travel|communication)|superluminal/i,
    theorem: 'Special Relativity (Causal Speed Limit c)',
    proof: 'Heuristic pattern match: superluminal signaling violates relativistic causality.',
    domain: 'PHYSICS',
  },
  {
    pattern: /lossless\s+compress(?:ion)?\s+(?:below|beyond|better\s+than)\s+entropy|sub-entropy|exceed\s+shannon|beat\s+shannon/i,
    theorem: 'Shannon Source Coding Theorem (1948)',
    proof: 'Heuristic pattern match: expected lossless code length cannot fall below source entropy H(X).',
    domain: 'PHYSICS',
  },
  {
    pattern: /trisect\s+(?:an?\s+)?(?:arbitrary\s+)?angle\s+(?:with\s+)?compass\s+(?:and\s+)?straightedge/i,
    theorem: 'Wantzel Theorem (1837)',
    proof: 'Heuristic pattern match: arbitrary angle trisection by straightedge and compass is impossible because cos(20°) has degree 3 over Q.',
    domain: 'LOGIC',
  },
  {
    pattern: /square\s+(?:the\s+)?circle/i,
    theorem: 'Lindemann-Weierstrass Theorem (1882)',
    proof: 'Heuristic pattern match: squaring the circle with straightedge and compass is impossible because pi is transcendental.',
    domain: 'LOGIC',
  },
];

export class SMTVerifier {
  private config: SMTVerifierConfig;
  private cache: Map<string, SMTResult>;
  private stats: {
    totalVerifications: number;
    knownHits: number;
    cacheHits: number;
    smtSolves: number;
    timeouts: number;
  };

  constructor(config: Partial<SMTVerifierConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cache = new Map();
    this.stats = {
      totalVerifications: 0,
      knownHits: 0,
      cacheHits: 0,
      smtSolves: 0,
      timeouts: 0,
    };
  }

  updateConfig(config: Partial<SMTVerifierConfig>): void {
    const nextConfig = { ...this.config, ...config };
    const shouldClearCache =
      this.config.enableCache !== nextConfig.enableCache ||
      this.config.useFullSolver !== nextConfig.useFullSolver ||
      this.config.timeoutMs !== nextConfig.timeoutMs ||
      this.config.maxCacheSize !== nextConfig.maxCacheSize;

    this.config = nextConfig;
    if (shouldClearCache) {
      this.cache.clear();
    }
  }

  /**
   * Main entry point:
   * 1. Quantitative SMT-LIB2 encoding -> real Z3 / exact edge solver (`FORMAL_SMT`).
   * 2. Linear resource-flow conservation check for quantum kets (`STRUCTURAL_CHECK`).
   * 3. Curated qualitative heuristic patterns (`HEURISTIC_PATTERN`, guarded against meta-questions).
   * 4. Otherwise abstain honestly (`UNKNOWN` / `UNVERIFIED`).
   */
  async verifyConstraint(goal: string, content: string): Promise<SMTResult> {
    const startTime = Date.now();
    this.stats.totalVerifications += 1;

    const fullText = `${goal}\n${content}`;
    const cacheKey = this.hashText(fullText);
    if (this.config.enableCache && this.cache.has(cacheKey)) {
      this.stats.cacheHits += 1;
      return this.cache.get(cacheKey)!;
    }

    // Meta-discussion guard: never flag "Explain why X is impossible" as an impossible claim
    if (isMetaDiscussionPrompt(goal)) {
      const metaRes: SMTResult = {
        verdict: 'UNKNOWN',
        proof: 'Objective is a meta-question or explanation request; no formal claim asserted.',
        timeMs: Date.now() - startTime,
        soundness: 'UNVERIFIED',
        constraintText: goal,
      };
      if (this.config.enableCache) this.cacheResult(cacheKey, metaRes);
      return metaRes;
    }

    // Step 1: Real Quantitative SMT-LIB2 Solving FIRST (before any heuristic regex!)
    const encoded = constraintEncoder.extract(goal);
    const executable = encoded.filter((c) => Boolean(c.formula.smtlib && c.formula.smtlib.trim()));

    if (executable.length > 0 && this.config.useFullSolver) {
      const smtResult = await this.solveWithTimeout(executable, this.config.timeoutMs);
      this.stats.smtSolves += 1;
      if (this.config.enableCache) this.cacheResult(cacheKey, smtResult);
      return smtResult;
    }

    // Step 2: Deterministic Linear Resource-Flow Check (Quantum No-Cloning)
    const steps = parseRecipeToLogic(fullText);
    if (steps) {
      const noCloning = verifyNoCloning(steps);
      if (!noCloning.passed) {
        const res: SMTResult = {
          verdict: 'IMPOSSIBLE',
          proof: `[Linear Resource-Flow Check] UNSAT: Step ${noCloning.violationStep} increases non-clonable state ${noCloning.violatedState} from ${noCloning.inputCount} to ${noCloning.outputCount} copies (Quantum No-Cloning Theorem).`,
          timeMs: Date.now() - startTime,
          soundness: 'STRUCTURAL_CHECK',
          domain: 'PHYSICS',
          constraintText: goal.slice(0, 200),
        };
        if (this.config.enableCache) this.cacheResult(cacheKey, res);
        return res;
      }
    }

    // Step 3: Curated Qualitative Heuristic Patterns (explicitly graded HEURISTIC_PATTERN)
    const heuristicHit = this.checkHeuristicPatterns(fullText);
    if (heuristicHit) {
      this.stats.knownHits += 1;
      if (this.config.enableCache) this.cacheResult(cacheKey, heuristicHit);
      return heuristicHit;
    }

    // Step 4: Honest Abstention — no formal model extracted
    const unverified: SMTResult = {
      verdict: 'UNKNOWN',
      proof: 'No formal quantitative or structural SMT model extracted; recorded in Umap as unverified.',
      timeMs: Date.now() - startTime,
      soundness: 'UNVERIFIED',
      constraintText: goal.slice(0, 200),
    };
    if (this.config.enableCache) this.cacheResult(cacheKey, unverified);
    return unverified;
  }

  private checkHeuristicPatterns(text: string): SMTResult | null {
    for (const entry of HEURISTIC_IMPOSSIBILITY_PATTERNS) {
      if (entry.pattern.test(text)) {
        return {
          verdict: 'IMPOSSIBLE',
          proof: `[Heuristic Pattern: ${entry.theorem}]\n${entry.proof}`,
          timeMs: 0,
          soundness: 'HEURISTIC_PATTERN',
          domain: entry.domain,
          constraintText: text.substring(0, 200),
        };
      }
    }
    return null;
  }

  private async solveWithTimeout(
    constraints: EncodedConstraint[],
    timeoutMs: number
  ): Promise<SMTResult> {
    const startTime = Date.now();
    if (constraints.length === 0) {
      return {
        verdict: 'UNKNOWN',
        timeMs: Date.now() - startTime,
        soundness: 'UNVERIFIED',
      };
    }

    const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
    if (isBrowser) {
      return {
        verdict: 'UNKNOWN',
        proof: 'Formal SMT solver unavailable in browser runtime.',
        timeMs: Date.now() - startTime,
        soundness: 'UNVERIFIED',
        constraintText: constraints[0]?.originalText,
      };
    }

    const timeoutResult: SMTResult = {
      verdict: 'UNKNOWN',
      proof: `SMT solving timed out after ${timeoutMs}ms.`,
      timeMs: timeoutMs,
      soundness: 'UNVERIFIED',
      constraintText: constraints[0]?.originalText,
    };

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<SMTResult>((resolve) => {
      timeoutHandle = setTimeout(() => {
        this.stats.timeouts += 1;
        resolve(timeoutResult);
      }, timeoutMs);
    });

    const solvePromise = (async (): Promise<SMTResult> => {
      try {
        const { init } = await import('z3-solver');
        const { Context, Z3 } = await init();
        let sawUnknown = false;

        for (const [index, constraint] of constraints.entries()) {
          const smtlib = constraint.formula.smtlib?.trim();
          if (!smtlib) {
            sawUnknown = true;
            continue;
          }
          const context = (Context as unknown as (name: string) => { ptr: unknown })(
            `turwin-smt-${index}`
          );
          const rawResult = await Z3.eval_smtlib2_string(context.ptr as never, smtlib);
          const normalized = String(rawResult).trim().toLowerCase();

          if (normalized.includes('unsat')) {
            return {
              verdict: 'IMPOSSIBLE',
              proof: `[Z3] UNSAT — ${constraint.formula.description}`,
              timeMs: Date.now() - startTime,
              soundness: 'FORMAL_SMT',
              domain: constraint.formula.domain,
              constraintText: constraint.originalText,
              smtlib,
            };
          }
          if (normalized.includes('unknown') || !normalized.includes('sat')) {
            sawUnknown = true;
          }
        }

        if (sawUnknown) {
          return {
            verdict: 'UNKNOWN',
            proof: '[Z3] UNKNOWN — solver could not decide satisfiability within fragment/timeout.',
            timeMs: Date.now() - startTime,
            soundness: 'UNVERIFIED',
            constraintText: constraints[0]?.originalText,
          };
        }

        const primary = constraints[0];
        return {
          verdict: 'POSSIBLE',
          proof: `[Z3] SAT — ${primary.formula.description}`,
          timeMs: Date.now() - startTime,
          soundness: 'FORMAL_SMT',
          domain: primary.formula.domain,
          constraintText: primary.originalText,
          smtlib: primary.formula.smtlib.trim(),
        };
      } catch (error) {
        return {
          verdict: 'UNKNOWN',
          proof: `Z3 error: ${String(error)}`,
          timeMs: Date.now() - startTime,
          soundness: 'UNVERIFIED',
          constraintText: constraints[0]?.originalText,
        };
      }
    })();

    const result = await Promise.race([solvePromise, timeoutPromise]);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    return result;
  }

  private cacheResult(key: string, result: SMTResult): void {
    if (this.cache.size >= this.config.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, result);
  }

  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash &= hash;
    }
    return hash.toString(36);
  }

  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const smtVerifier = new SMTVerifier();

export function hasSMTVerifiableConstraints(goal: string): boolean {
  if (isMetaDiscussionPrompt(goal)) return false;
  return constraintEncoder.hasEncodableConstraints(goal);
}

export function formatSMTResultForWitness(result: SMTResult): {
  counterExample: string;
  constraintViolated: string;
} {
  return {
    counterExample: result.proof || `SMT verdict: ${result.verdict}`,
    constraintViolated: result.domain ? `SMT_${result.domain}` : 'SMT_VERIFICATION',
  };
}
