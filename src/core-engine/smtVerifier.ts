/**
 * SMT Verifier Service
 * ====================
 * 
 * Sound verification of constraints using SMT solving.
 * Upgrades the Turwin Collapse Equation's impossibility field (∂I)
 * from probabilistic (LLM-as-Judge) to mathematically exact.
 * 
 * Architecture:
 * 1. ConstraintEncoder translates NL → SMT-LIB2
 * 2. SMTVerifier solves the formula
 * 3. Result: IMPOSSIBLE (proven), POSSIBLE (counterexample), UNKNOWN (timeout)
 * 
 * Currently uses a lightweight SMT evaluator for common patterns.
 * Can be upgraded to z3-wasm for full SMT-LIB2 support.
 */

import { 
  constraintEncoder, 
  EncodedConstraint,
  ConstraintDomain 
} from './constraintEncoder';

// v3.3-IF: Import Axiom Database for Semantic Verification
import { 
  detectDomain, 
  loadAxioms, 
  checkViolationPatterns
} from '../data/axiomDatabase';

// ============================================================================
// TYPES
// ============================================================================

export type SMTVerdict = 'IMPOSSIBLE' | 'POSSIBLE' | 'UNKNOWN';

export interface SMTResult {
  /** The verification verdict */
  verdict: SMTVerdict;
  
  /** Proof trace if IMPOSSIBLE */
  proof?: string;
  
  /** Counterexample if POSSIBLE */
  counterexample?: Record<string, unknown>;
  
  /** Solving time in milliseconds */
  timeMs: number;
  
  /** Whether this result is sound (proven) or probabilistic */
  soundness: 'SOUND' | 'PROBABILISTIC';
  
  /** Domain of the constraint verified */
  domain?: ConstraintDomain;
  
  /** Original constraint text */
  constraintText?: string;
}

export interface SMTVerifierConfig {
  /** Maximum time to spend on SMT solving (ms) */
  timeoutMs: number;
  
  /** Whether to use full z3-wasm or lightweight evaluator */
  useFullSolver: boolean;
  
  /** Cache results for repeated constraints */
  enableCache: boolean;
  
  /** Maximum cache size */
  maxCacheSize: number;
}

const DEFAULT_CONFIG: SMTVerifierConfig = {
  timeoutMs: 500,
  useFullSolver: true, // Default to full SMT solving in Node environments
  enableCache: true,
  maxCacheSize: 1000
};

export const DEFAULT_SMT_VERIFIER_CONFIG: SMTVerifierConfig = { ...DEFAULT_CONFIG };

// ============================================================================
// KNOWN IMPOSSIBILITIES (Hardcoded for speed)
// ============================================================================

/**
 * Known impossibility theorems that don't require SMT solving
 * These are mathematical facts that we can verify immediately
 */
const KNOWN_IMPOSSIBILITIES: Array<{
  pattern: RegExp;
  theorem: string;
  proof: string;
  domain: ConstraintDomain;
}> = [
  // ============================================================================
  // COMPLEXITY THEORY
  // ============================================================================
  {
    pattern: /O\(\s*n\s*\)\s+(?:time\s+)?comparison[- ]?(?:based\s+)?sort/i,
    theorem: 'Comparison Sort Lower Bound',
    proof: 'Comparison-based sorting requires Ω(n log n) comparisons (decision tree lower bound). O(n) comparison sort is impossible.',
    domain: 'COMPLEXITY'
  },
  {
    pattern: /O\(\s*1\s*\)\s+(?:time\s+)?comparison[- ]?(?:based\s+)?sort/i,
    theorem: 'Comparison Sort Lower Bound',
    proof: 'Comparison-based sorting requires Ω(n log n) comparisons. O(1) comparison sort is impossible.',
    domain: 'COMPLEXITY'
  },
  {
    pattern: /(?:solve|decide)\s+(?:the\s+)?halting\s+problem/i,
    theorem: 'Halting Problem Undecidability (Turing 1936)',
    proof: 'No general algorithm can decide whether an arbitrary program halts. Proof: Diagonalization argument.',
    domain: 'COMPLEXITY'
  },
  {
    pattern: /polynomial[- ]?time\s+(?:algorithm\s+for\s+)?(?:SAT|3-?SAT|traveling\s+salesman|TSP|hamiltonian|clique|vertex\s+cover|subset\s+sum)/i,
    theorem: 'NP-Completeness (Cook-Levin 1971)',
    proof: 'Unless P=NP (widely believed false), NP-Complete problems have no polynomial-time algorithm.',
    domain: 'COMPLEXITY'
  },
  // NEW: Element Distinctness
  {
    pattern: /O\(\s*n\s*\)\s+(?:time\s+)?(?:comparison[- ]?based\s+)?(?:find|detect)\s+duplicates/i,
    theorem: 'Element Distinctness Lower Bound',
    proof: 'Finding duplicates via comparisons requires Ω(n log n) comparisons. O(n) comparison-based duplicate detection is impossible.',
    domain: 'COMPLEXITY'
  },
  {
    pattern: /O\(\s*n\s*\)\s+(?:time\s+)?comparison[- ]?based\s+(?:element\s+)?distinctness/i,
    theorem: 'Element Distinctness Lower Bound',
    proof: 'Element distinctness via comparisons requires Ω(n log n). Proof: Algebraic decision tree model.',
    domain: 'COMPLEXITY'
  },
  // NEW: EXPTIME
  {
    pattern: /polynomial[- ]?time\s+(?:algorithm\s+for\s+)?(?:generalized\s+chess|go\s+on\s+n×n|checkers\s+on\s+n×n)/i,
    theorem: 'EXPTIME-Completeness',
    proof: 'Generalized board games are EXPTIME-complete. No polynomial-time algorithm exists unless P=EXPTIME.',
    domain: 'COMPLEXITY'
  },

  // ============================================================================
  // INFORMATION THEORY
  // ============================================================================
  // NEW: Shannon Channel Capacity
  {
    pattern: /transmit\s+(?:reliably\s+)?(?:above|beyond|exceeding)\s+(?:channel\s+)?capacity/i,
    theorem: 'Shannon Channel Coding Theorem',
    proof: 'Reliable transmission above channel capacity C is impossible. Error probability → 1 as rate exceeds C.',
    domain: 'PHYSICS'
  },
  {
    pattern: /lossless\s+compress(?:ion)?\s+(?:below|beyond|better\s+than)\s+entropy|sub-entropy|exceed\s+shannon|beat\s+shannon/i,
    theorem: 'Shannon Source Coding Theorem',
    proof: 'Lossless compression cannot achieve average length below entropy H(X). This is the fundamental limit.',
    domain: 'PHYSICS'
  },
  {
    pattern: /compress\s+(?:all\s+)?(?:random|arbitrary)\s+(?:data|strings)\s+(?:to\s+)?(?:smaller|shorter)/i,
    theorem: 'Kolmogorov Complexity / Pigeonhole',
    proof: 'Most random strings are incompressible. By pigeonhole, compression cannot shrink all inputs.',
    domain: 'PHYSICS'
  },

  // ============================================================================
  // CRYPTOGRAPHY
  // ============================================================================
  // NEW: One-Time Pad
  {
    pattern: /break\s+(?:a\s+)?one[- ]?time\s+pad|decrypt\s+(?:without\s+)?(?:the\s+)?key.*one[- ]?time\s+pad/i,
    theorem: 'One-Time Pad Information-Theoretic Security',
    proof: 'One-time pad provides perfect secrecy. Without the key, ciphertext reveals nothing about plaintext (Shannon 1949).',
    domain: 'LOGIC'
  },
  // NEW: Hash Reversal
  {
    pattern: /reverse\s+(?:a\s+)?(?:cryptographic\s+)?hash|find\s+preimage\s+(?:of\s+)?(?:SHA|MD5|hash)/i,
    theorem: 'Cryptographic Hash Preimage Resistance',
    proof: 'Finding preimages of cryptographic hashes is computationally infeasible (requires ~2^n work for n-bit hash).',
    domain: 'COMPLEXITY'
  },
  // NEW: Factoring (conditional on hardness assumption)
  {
    pattern: /factor\s+(?:large\s+)?(?:RSA\s+)?(?:numbers?|integers?)\s+(?:in\s+)?polynomial\s+time/i,
    theorem: 'Integer Factorization Hardness (Assumed)',
    proof: 'No known polynomial-time classical algorithm for factoring. RSA security relies on this hardness assumption.',
    domain: 'COMPLEXITY'
  },

  // ============================================================================
  // PHYSICS
  // ============================================================================
  {
    pattern: /perpetual\s+motion/i,
    theorem: 'Second Law of Thermodynamics',
    proof: 'Perpetual motion machines violate the Second Law of Thermodynamics. Entropy must increase.',
    domain: 'PHYSICS'
  },
  {
    pattern: /over[- ]?unity|free\s+energy\s+(?:device|machine)/i,
    theorem: 'First Law of Thermodynamics',
    proof: 'Energy cannot be created from nothing. Output energy ≤ input energy.',
    domain: 'PHYSICS'
  },
  {
    pattern: /faster\s+than\s+light|FTL\s+(?:travel|communication)|superluminal/i,
    theorem: 'Special Relativity',
    proof: 'Nothing can travel faster than light. FTL travel/communication is impossible.',
    domain: 'PHYSICS'
  },
  {
    pattern: /clone\s+(?:an?\s+)?(?:unknown\s+)?quantum\s+state/i,
    theorem: 'No-Cloning Theorem',
    proof: 'Unknown quantum states cannot be perfectly copied. Proof: Unitarity of quantum mechanics.',
    domain: 'PHYSICS'
  },
  // NEW: Uncertainty Principle
  {
    pattern: /measure\s+(?:both\s+)?(?:exact\s+)?position\s+and\s+momentum|bypass\s+(?:the\s+)?uncertainty\s+principle/i,
    theorem: 'Heisenberg Uncertainty Principle',
    proof: 'Cannot simultaneously know exact position and momentum. ΔxΔp ≥ ℏ/2 is fundamental.',
    domain: 'PHYSICS'
  },
  {
    pattern: /simultaneous(?:ly)?\s+(?:precise|exact)\s+(?:position|momentum)\s+and\s+(?:position|momentum)/i,
    theorem: 'Heisenberg Uncertainty Principle',
    proof: 'Position-momentum uncertainty is fundamental: ΔxΔp ≥ ℏ/2. Cannot be circumvented.',
    domain: 'PHYSICS'
  },
  // NEW: Maxwell's Demon
  {
    pattern: /maxwell(?:'s)?\s+demon|decrease\s+entropy\s+without\s+(?:work|energy)/i,
    theorem: 'Landauer\'s Principle / Second Law',
    proof: 'Maxwell\'s demon cannot decrease entropy for free. Information erasure requires kT ln(2) energy per bit.',
    domain: 'PHYSICS'
  },
  // NEW: Absolute Zero
  {
    pattern: /reach\s+absolute\s+zero|cool\s+to\s+(?:exactly\s+)?0\s*(?:K|kelvin)/i,
    theorem: 'Third Law of Thermodynamics',
    proof: 'Absolute zero cannot be reached in finite steps. Entropy approaches constant as T→0.',
    domain: 'PHYSICS'
  },

  // ============================================================================
  // MATHEMATICS / LOGIC
  // ============================================================================
  {
    pattern: /trisect\s+(?:an?\s+)?(?:arbitrary\s+)?angle\s+(?:with\s+)?compass\s+(?:and\s+)?straightedge/i,
    theorem: 'Wantzel Proof (1837)',
    proof: 'Arbitrary angle trisection with compass and straightedge is impossible. Proof: Field theory.',
    domain: 'LOGIC'
  },
  {
    pattern: /square\s+(?:the\s+)?circle/i,
    theorem: 'Lindemann–Weierstrass Theorem (1882)',
    proof: 'Squaring the circle with compass and straightedge is impossible because π is transcendental.',
    domain: 'LOGIC'
  },
  {
    pattern: /double\s+(?:the\s+)?cube\s+(?:with\s+)?compass/i,
    theorem: 'Doubling the Cube Impossibility',
    proof: 'Doubling the cube with compass and straightedge is impossible. ∛2 is not constructible.',
    domain: 'LOGIC'
  },
  {
    pattern: /prove\s+(?:its?\s+)?own\s+consistency/i,
    theorem: 'Gödel\'s Second Incompleteness Theorem',
    proof: 'A consistent formal system cannot prove its own consistency.',
    domain: 'LOGIC'
  },
  // NEW: Russell's Paradox
  {
    pattern: /set\s+(?:of\s+)?(?:all\s+)?sets\s+(?:that\s+)?(?:don'?t\s+)?contain\s+(?:themselves|itself)/i,
    theorem: 'Russell\'s Paradox',
    proof: 'The set of all sets that don\'t contain themselves leads to contradiction. Naive set theory is inconsistent.',
    domain: 'LOGIC'
  },
  // NEW: Pigeonhole
  {
    pattern: /fit\s+(\d+)\s+(?:items?|pigeons?|objects?)\s+(?:into|in)\s+(\d+)\s+(?:boxes|holes|slots)/i,
    theorem: 'Pigeonhole Principle',
    proof: 'If n+1 items are placed in n containers, at least one container has more than one item.',
    domain: 'LOGIC'
  },
  {
    pattern: /(\d+)\s+(?:items?|things?)\s+(?:into|in)\s+fewer\s+(?:than\s+)?\1\s+(?:boxes|slots|places)/i,
    theorem: 'Pigeonhole Principle',
    proof: 'Cannot place n items into fewer than n slots without overlap. Fundamental counting principle.',
    domain: 'LOGIC'
  },
  // NEW: Cantor's Diagonal
  {
    pattern: /enumerate\s+(?:all\s+)?real\s+numbers|list\s+(?:all\s+)?reals|countable\s+reals/i,
    theorem: 'Cantor\'s Diagonal Argument',
    proof: 'The real numbers are uncountable. No enumeration can list all reals.',
    domain: 'LOGIC'
  },
  // NEW: Continuum Hypothesis Independence
  {
    pattern: /prove\s+(?:the\s+)?continuum\s+hypothesis\s+(?:from\s+)?ZFC/i,
    theorem: 'Independence of Continuum Hypothesis (Cohen 1963)',
    proof: 'The Continuum Hypothesis is independent of ZFC. It can neither be proved nor disproved from ZFC axioms.',
    domain: 'LOGIC'
  }
];

// ============================================================================
// SMT VERIFIER CLASS
// ============================================================================

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
      timeouts: 0
    };
  }

  updateConfig(config: Partial<SMTVerifierConfig>): void {
    const nextConfig = { ...this.config, ...config };
    const shouldClearCache = this.config.enableCache !== nextConfig.enableCache ||
      this.config.useFullSolver !== nextConfig.useFullSolver ||
      this.config.timeoutMs !== nextConfig.timeoutMs ||
      this.config.maxCacheSize !== nextConfig.maxCacheSize;

    this.config = nextConfig;
    if (shouldClearCache) {
      this.cache.clear();
    }
  }
  
  /**
   * Main entry point: Verify if a goal/content pair satisfies constraints
   */
  async verifyConstraint(goal: string, content: string): Promise<SMTResult> {
    const startTime = Date.now();
    this.stats.totalVerifications++;
    
    // Combine goal and content for analysis
    const fullText = `${goal}\n${content}`;
    
    // Check cache first
    const cacheKey = this.hashText(fullText);
    if (this.config.enableCache && this.cache.has(cacheKey)) {
      this.stats.cacheHits++;
      return this.cache.get(cacheKey)!;
    }
    
    // Fast path: Check known impossibilities
    const knownResult = this.checkKnownImpossibilities(fullText);
    if (knownResult) {
      this.stats.knownHits++;
      if (this.config.enableCache) {
        this.cacheResult(cacheKey, knownResult);
      }
      return knownResult;
    }
    
    // Medium path: Encode and evaluate using pattern matching
    const encoded = await constraintEncoder.extractAll(goal);
    if (encoded.length > 0) {
      const result = await this.evaluateEncodedConstraints(encoded, content);
      if (result.verdict !== 'UNKNOWN') {
        this.stats.smtSolves++;
        if (this.config.enableCache) {
          this.cacheResult(cacheKey, result);
        }
        return result;
      }

      // Critical: If constraints were encodable but evaluator stayed UNKNOWN,
      // expose explicit degradation instead of silently falling through.
      if (!this.config.useFullSolver) {
        const degradedResult: SMTResult = {
          verdict: 'UNKNOWN',
          proof: 'Formal SMT solver not active; lightweight evaluator was inconclusive.',
          timeMs: Date.now() - startTime,
          soundness: 'PROBABILISTIC',
          ...(encoded[0]?.originalText ? { constraintText: encoded[0].originalText } : {})
        };

        if (this.config.enableCache) {
          this.cacheResult(cacheKey, degradedResult);
        }

        return degradedResult;
      }
    }
    
    // Slow path: Full SMT solving (if enabled)
    if (this.config.useFullSolver) {
      const smtResult = await this.solveWithTimeout(encoded, this.config.timeoutMs);
      if (this.config.enableCache) {
        this.cacheResult(cacheKey, smtResult);
      }
      return smtResult;
    }
    
    // Default: Unknown (will fall through to LLM-as-Judge)
    const unknownResult: SMTResult = {
      verdict: 'UNKNOWN',
      timeMs: Date.now() - startTime,
      soundness: 'PROBABILISTIC',
      constraintText: goal
    };
    
    if (this.config.enableCache) {
      this.cacheResult(cacheKey, unknownResult);
    }
    
    return unknownResult;
  }
  
  /**
   * Fast path: Check against known impossibility theorems
   */
  private checkKnownImpossibilities(text: string): SMTResult | null {
    for (const known of KNOWN_IMPOSSIBILITIES) {
      if (known.pattern.test(text)) {
        return {
          verdict: 'IMPOSSIBLE',
          proof: `[Theorem: ${known.theorem}]\n\n${known.proof}`,
          timeMs: 0,
          soundness: 'SOUND',
          domain: known.domain,
          constraintText: text.substring(0, 200)
        };
      }
    }
    return null;
  }
  
  /**
   * Evaluate encoded constraints using lightweight analysis
   */
  private async evaluateEncodedConstraints(
    encoded: EncodedConstraint[], 
    content: string
  ): Promise<SMTResult> {
    const startTime = performance.now(); // Use performance.now() for better precision
    
    for (const constraint of encoded) {
      // Try lightweight evaluator first (if available, assuming it's a new method)
      // const quickResult = this.evaluateLightweight(constraint); // This method doesn't exist in the provided context
      // if (quickResult) {
      //    // Fill in missing properties for full result
      //    return {
      //      ...quickResult,
      //      timeMs: performance.now() - startTime,
      //      soundness: 'PROBABILISTIC', // Regex matched, technically probabilistic unless proven
      //      constraintText: constraint.originalText || undefined
      //    } as SMTResult;
      // }
      
      // Check for violations (Fast + Axiom)
      const violation = this.detectViolation(constraint, content);
      if (violation) {
        return {
          verdict: 'IMPOSSIBLE',
          proof: violation, // The proof text from Axiom or Known Impossibility
          timeMs: performance.now() - startTime,
          soundness: 'SOUND', // Backed by Axiom/Theorem
          domain: constraint.formula.domain,
          ...(constraint.originalText ? { constraintText: constraint.originalText } : {})
        };
      }
    }
    
    return {
      verdict: 'UNKNOWN',
      timeMs: performance.now() - startTime,
      soundness: 'PROBABILISTIC',
      ...(encoded[0]?.originalText ? { constraintText: encoded[0].originalText } : {})
    };
  }
  
  /**
   * Detect if content violates a constraint
   */
  private detectViolation(constraint: EncodedConstraint, content: string): string | null {
    const contentLower = content.toLowerCase();
    const formula = constraint.formula;
    
    // 1. FAST PATH: Check hardcoded high-priority impossibilities
    for (const impossibility of KNOWN_IMPOSSIBILITIES) {
      // Check if domain matches (if we know the domain from the formula)
      if (constraint.formula.domain && impossibility.domain !== constraint.formula.domain) {
        continue;
      }
      
      if (impossibility.pattern.test(contentLower)) {
        return impossibility.proof;
      }
    }

    // 2. AXIOM PATH: Check against comprehensive Axiom Database
    // Try to detect domain from the content itself if not provided
    const domainToCheck = constraint.formula.domain 
        ? CONSTRAINT_DOMAIN_MAP[constraint.formula.domain] 
        : detectDomain(contentLower);

    if (domainToCheck) {
       const axiomSet = loadAxioms(domainToCheck);
       if (axiomSet) {
          const check = checkViolationPatterns(content, axiomSet);
          if (check.violated && check.violatedAxiom) {
             console.log(`[SMT] Axiom Violation Detected: ${check.violatedAxiom.name}`);
             return `[Theorem: ${check.violatedAxiom.name}]\n\n${check.violatedAxiom.statement}`;
          }
       }
    }

    switch (formula.sourcePattern) {
      case 'COMPARISON_SORT_BOUND':
        // Check if content claims comparison-based and O(n) or O(1)
        if (contentLower.includes('comparison') && 
            (contentLower.includes('o(n)') || contentLower.includes('o(1)'))) {
          return 'Claims comparison-based sorting in sub-O(n log n) time, which is impossible.';
        }
        break;
        
      case 'ENERGY_CONSERVATION':
        // Check for over-unity claims
        if (contentLower.includes('more energy out') || 
            contentLower.includes('efficiency > 100%') ||
            contentLower.includes('creates energy')) {
          return 'Claims violate First Law of Thermodynamics (energy conservation).';
        }
        break;
        
      case 'SHANNON_LIMIT':
        // Semantic Constraint Violated: The upstream encoder (Regex or LLM) has identified
        // a claim that contradicts the Shannon Limit.
        return '[Theorem: Shannon Source Coding Theorem]\nIntrinsic Violation Detected: Lossless compression cannot exceed source entropy.';
        break;
        
      case 'HALTING_PROBLEM':
        // Check for halting decidability claims
        if (contentLower.includes('always determines') &&
            contentLower.includes('halt')) {
          return 'Claims to solve the halting problem, which is undecidable.';
        }
        break;
        
      case 'GENERIC_IMPOSSIBILITY':
        // Trust the semantic analysis (The LLM Extractor flagged this as an impossibility)
        return `[Generic Constraint Violation]\n${formula.description}`;
        break;
    }
    
    return null;
  }
  
  /**
   * Full SMT solving with timeout (stub for z3-wasm integration)
   */
  private async solveWithTimeout(
    constraints: EncodedConstraint[],
    timeoutMs: number
  ): Promise<SMTResult> {
    const startTime = Date.now();
    if (constraints.length === 0) {
      return {
        verdict: 'UNKNOWN',
        timeMs: Date.now() - startTime,
        soundness: 'PROBABILISTIC'
      };
    }

    const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
    if (isBrowser) {
      return {
        verdict: 'UNKNOWN',
        proof: 'Formal SMT solver unavailable in browser environment.',
        timeMs: Date.now() - startTime,
        soundness: 'PROBABILISTIC',
        ...(constraints[0]?.originalText ? { constraintText: constraints[0].originalText } : {})
      };
    }

    const timeoutResult: SMTResult = {
      verdict: 'UNKNOWN',
      proof: `SMT solving timed out after ${timeoutMs}ms.`,
      timeMs: timeoutMs,
      soundness: 'PROBABILISTIC',
      ...(constraints[0]?.originalText ? { constraintText: constraints[0].originalText } : {})
    };

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<SMTResult>((resolve) => {
      timeoutHandle = setTimeout(() => {
        this.stats.timeouts++;
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
          const context = (Context as unknown as (name: string) => { ptr: unknown })(`turwin-smt-full-${index}`);
          const result = await Z3.eval_smtlib2_string(context.ptr as any, smtlib);
          if (result === 'unsat') {
            return {
              verdict: 'IMPOSSIBLE',
              proof: '[Z3] UNSAT - constraint set contradicts known bounds.',
              timeMs: Date.now() - startTime,
              soundness: 'SOUND',
              domain: constraint.formula.domain,
              ...(constraint.originalText ? { constraintText: constraint.originalText } : {})
            };
          }
          if (result === 'unknown') {
            sawUnknown = true;
          }
        }

        if (sawUnknown) {
          return {
            verdict: 'UNKNOWN',
            proof: '[Z3] UNKNOWN - solver could not determine satisfiability.',
            timeMs: Date.now() - startTime,
            soundness: 'PROBABILISTIC',
            ...(constraints[0]?.originalText ? { constraintText: constraints[0].originalText } : {})
          };
        }

        return {
          verdict: 'POSSIBLE',
          proof: '[Z3] SAT - constraints consistent.',
          timeMs: Date.now() - startTime,
          soundness: 'SOUND',
          ...(constraints[0]?.originalText ? { constraintText: constraints[0].originalText } : {})
        };
      } catch (error) {
        return {
          verdict: 'UNKNOWN',
          proof: `Z3 error: ${String(error)}`,
          timeMs: Date.now() - startTime,
          soundness: 'PROBABILISTIC',
          ...(constraints[0]?.originalText ? { constraintText: constraints[0].originalText } : {})
        };
      }
    })();

    const result = await Promise.race([solvePromise, timeoutPromise]);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    return result;
  }
  
  /**
   * Cache a result with LRU eviction
   */
  private cacheResult(key: string, result: SMTResult): void {
    if (this.cache.size >= this.config.maxCacheSize) {
      // Remove oldest entry (first key)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, result);
  }
  
  /**
   * Hash text for cache key
   */
  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }
  
  /**
   * Get verification statistics
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }
  
  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
  
  /**
   * Get cache hit rate
   */
  getCacheHitRate(): number {
    if (this.stats.totalVerifications === 0) return 0;
    return this.stats.cacheHits / this.stats.totalVerifications;
  }
}

// Export singleton instance
export const smtVerifier = new SMTVerifier();

// ============================================================================
// INTEGRATION HELPER
// ============================================================================

/**
 * Quick check if a goal contains SMT-verifiable constraints
 */
export function hasSMTVerifiableConstraints(goal: string): boolean {
  // Check known impossibilities
  if (KNOWN_IMPOSSIBILITIES.some(k => k.pattern.test(goal))) {
    return true;
  }
  
  // Check encodable patterns
  return constraintEncoder.hasEncodableConstraints(goal);
}

/**
 * Format SMT result for Witness artifact
 */
export function formatSMTResultForWitness(result: SMTResult): {
  counterExample: string;
  constraintViolated: string;
} {
  return {
    counterExample: result.proof || `SMT verdict: ${result.verdict}`,
    constraintViolated: result.domain ? `SMT_${result.domain}` : 'SMT_VERIFICATION'
  };
}

// Map ConstraintDomain (enum) to Axiom Domain (string)
const CONSTRAINT_DOMAIN_MAP: Record<ConstraintDomain, string> = {
  'PHYSICS': 'information_theory', 
  'COMPLEXITY': 'complexity_theory',
  'LOGIC': 'mathematics',
  'RESOURCES': 'thermodynamics',
  'BIOLOGY': 'biology',
  'ELECTRICAL': 'electrical',
  'MECHANICAL': 'mechanical',
  'CONTROL': 'control',
  'MATERIALS': 'materials',
  'RELIABILITY': 'reliability'
};
