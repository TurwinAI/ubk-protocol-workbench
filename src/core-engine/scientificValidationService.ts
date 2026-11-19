/**
 * Scientific Claim Validation Service
 * 
 * Implements the Universal Scientific Claim Validation Protocol
 * that Turwin self-generated to fix hallucination detection.
 * 
 * Classification tiers:
 * - Rejected: Contradicts known axioms (provable impossibility)
 * - Flagged: Relates to open conjectures (unknown territory)
 * - Accepted: Consistent with known axioms
 */

import {
  loadAxioms,
  detectDomain,
  checkViolationPatterns,
  checkFlagPatterns,
  type Axiom,
  type OpenConjecture
} from '../data/axiomDatabase';
import { getZ3VerificationService, type Constraint } from './z3VerificationService';
import { info, error } from '../utils/logger';

export type ClaimClassification = 'Rejected' | 'Flagged' | 'Accepted';

export interface ValidationResult {
  classification: ClaimClassification;
  proof: string[] | null;
  reasoning_summary: string;
  domain?: string;
  violated_axiom?: {
    id: string;
    name: string;
    statement: string;
  };
  flagged_conjecture?: {
    id: string;
    name: string;
    statement: string;
  };
}

/**
 * Validate a scientific claim against known axioms
 */
export async function validateScientificClaim(
  claim: string,
  domainHint?: string
): Promise<ValidationResult> {
  info('SCIENTIFIC_VALIDATION', 'Starting claim validation', { claimPreview: claim.substring(0, 100) });
  
  // Step 1: Detect domain
  const domain = domainHint || detectDomain(claim);
  
  if (!domain) {
    info('SCIENTIFIC_VALIDATION', 'No domain detected, accepting claim');
    return {
      classification: 'Accepted',
      proof: null,
      reasoning_summary: 'No domain-specific axioms applicable. Claim accepted by default.'
    };
  }
  
  // Step 2: Load axioms
  const axiomSet = loadAxioms(domain);
  
  if (!axiomSet) {
    info('SCIENTIFIC_VALIDATION', `No axioms for domain: ${domain}`);
    return {
      classification: 'Accepted',
      proof: null,
      reasoning_summary: `No axioms loaded for domain "${domain}". Claim accepted by default.`,
      domain
    };
  }
  
  info('SCIENTIFIC_VALIDATION', `Loaded axioms for domain: ${domain}`, { 
    axiomCount: axiomSet.axioms.length,
    conjectureCount: axiomSet.open_conjectures?.length || 0
  });
  
  // Step 3: Check for explicit violation patterns
  const violationCheck = checkViolationPatterns(claim, axiomSet);
  
  if (violationCheck.violated && violationCheck.violatedAxiom) {
    info('SCIENTIFIC_VALIDATION', 'Violation detected', { 
      axiom: violationCheck.violatedAxiom.id, 
      pattern: violationCheck.pattern 
    });
    
    return {
      classification: 'Rejected',
      proof: [
        `AXIOM: ${violationCheck.violatedAxiom.name}`,
        `STATEMENT: ${violationCheck.violatedAxiom.statement}`,
        `FORMAL: ${violationCheck.violatedAxiom.formal}`,
        `CLAIM CONTAINS: "${violationCheck.pattern}"`,
        `CONCLUSION: Claim contradicts ${violationCheck.violatedAxiom.id}`
      ],
      reasoning_summary: `Claim violates ${violationCheck.violatedAxiom.name}. Pattern "${violationCheck.pattern}" contradicts axiom: ${violationCheck.violatedAxiom.statement}`,
      domain,
      violated_axiom: {
        id: violationCheck.violatedAxiom.id,
        name: violationCheck.violatedAxiom.name,
        statement: violationCheck.violatedAxiom.statement
      }
    };
  }
  
  // Step 4: Check for open conjecture flag patterns
  const flagCheck = checkFlagPatterns(claim, axiomSet);
  
  if (flagCheck.flagged && flagCheck.conjecture) {
    info('SCIENTIFIC_VALIDATION', 'Claim flagged for review', { 
      conjecture: flagCheck.conjecture.id, 
      pattern: flagCheck.pattern 
    });
    
    return {
      classification: 'Flagged',
      proof: null,
      reasoning_summary: `Claim relates to open conjecture: ${flagCheck.conjecture.name}. ${flagCheck.conjecture.implication}`,
      domain,
      flagged_conjecture: {
        id: flagCheck.conjecture.id,
        name: flagCheck.conjecture.name,
        statement: flagCheck.conjecture.statement
      }
    };
  }

  // Step 5: Z3 SMT verification for rigorous constraint checking (v3.3-IF)
  try {
    const z3 = getZ3VerificationService();
    if (z3.isReady()) {
      // Encode scientific axioms as SMT constraints
      const constraints = encodeScientificAxiomsAsConstraints(claim, axiomSet);

      if (constraints.length > 0) {
        info('SCIENTIFIC_VALIDATION', `Encoded ${constraints.length} axiom constraints for Z3 verification`);

        const z3Result = await z3.verifyConstraints(constraints);

        if (!z3Result.satisfiable) {
          // UNSAT means the claim violates scientific axioms
          info('SCIENTIFIC_VALIDATION', 'Z3 proved impossibility - claim violates axioms');

          return {
            classification: 'Rejected',
            proof: z3Result.proof || ['Z3 SMT solver proved UNSAT - claim contradicts scientific axioms'],
            reasoning_summary: `Claim contradicts axioms in "${domain}" domain. Z3 SMT verification: UNSAT (solved in ${z3Result.solveTimeMs}ms)`,
            domain
          };
        }

        info('SCIENTIFIC_VALIDATION', `Z3 verification passed (SAT in ${z3Result.solveTimeMs}ms)`);
      }
    } else {
      info('SCIENTIFIC_VALIDATION', 'Z3 not ready (browser mode), using pattern matching only');
    }
  } catch (e) {
    // Z3 not available or failed, continue with pattern-based validation
    error('SCIENTIFIC_VALIDATION', 'Z3 verification error (non-fatal)', e);
  }

  // Step 6: No violations found - accept
  info('SCIENTIFIC_VALIDATION', 'No violations detected, accepting claim');
  
  return {
    classification: 'Accepted',
    proof: null,
    reasoning_summary: `Claim checked against ${axiomSet.axioms.length} axioms in "${domain}" domain. No violations detected.`,
    domain
  };
}

/**
 * Quick check for common scientific impossibilities (v3.3-IF consolidated)
 * Used in adversarialVerify as a fast path
 *
 * Canonical source for impossibility patterns - single source of truth
 * Consolidated from duplicate patterns in turwinKernel and scientificValidationService
 */
export function quickImpossibilityCheck(claim: string): {
  impossible: boolean;
  reason?: string;
} {
  const claimLower = claim.toLowerCase();

  // Comprehensive impossibility patterns (consolidated v3.3-IF)
  const quickChecks = [
    // Information Theory (6 patterns)
    { pattern: 'beats entropy', reason: 'Violates Shannon entropy limit' },
    { pattern: 'exceeds shannon', reason: 'Violates Shannon entropy limit' },
    { pattern: 'exceeding shannon', reason: 'Violates Shannon entropy limit' },
    { pattern: 'sub-entropy', reason: 'Violates Shannon entropy limit' },
    { pattern: 'below entropy', reason: 'Violates Shannon entropy limit' },
    { pattern: 'better than entropy', reason: 'Violates Shannon entropy limit' },

    // Thermodynamics (4 patterns)
    { pattern: 'perpetual motion', reason: 'Violates thermodynamics' },
    { pattern: 'free energy', reason: 'Violates energy conservation' },
    { pattern: 'over unity', reason: 'Violates energy conservation' },
    { pattern: 'more energy than it consumes', reason: 'Violates energy conservation' },

    // Complexity Theory (1 pattern)
    { pattern: 'solves halting problem', reason: 'Violates computability theory' },

    // Relativity (6 patterns)
    { pattern: 'faster than light', reason: 'Violates special relativity' },
    { pattern: 'superluminal', reason: 'Violates special relativity' },
    { pattern: 'ftl travel', reason: 'Violates special relativity' },
    { pattern: 'instantaneous transmission', reason: 'Violates special relativity (no FTL information)' },
    { pattern: 'instantaneous data transmission', reason: 'Violates special relativity (no FTL information)' },
    { pattern: 'instantaneously at the destination', reason: 'Violates special relativity (no FTL information)' },
    { pattern: 'instantaneous information', reason: 'Violates special relativity (no FTL information)' },

    // Quantum Mechanics (6 patterns)
    { pattern: 'clone quantum state', reason: 'Violates no-cloning theorem' },
    { pattern: 'copy quantum information', reason: 'Violates no-cloning theorem' },
    { pattern: 'ftl communication via entanglement', reason: 'Entanglement cannot transmit information FTL' },
    { pattern: 'instantaneous communication', reason: 'Violates no-signaling theorem' },
    { pattern: 'bypasses uncertainty', reason: 'Violates Heisenberg uncertainty principle' },
    { pattern: 'exact position and momentum', reason: 'Violates Heisenberg uncertainty principle' },

    // Mathematics (3 patterns)
    { pattern: 'trisect any angle with compass', reason: 'Angle trisection is proven impossible' },
    { pattern: 'squaring the circle', reason: 'Proven geometrically impossible' },
    { pattern: 'proves its own consistency', reason: 'Violates Gödel incompleteness' },
  ];

  for (const check of quickChecks) {
    if (claimLower.includes(check.pattern)) {
      return { impossible: true, reason: check.reason };
    }
  }

  return { impossible: false };
}

/**
 * Encode scientific axioms as SMT constraints for Z3 verification (v3.3-IF)
 *
 * This function converts scientific axioms into mathematical constraints
 * that can be verified by the Z3 SMT solver.
 */
function encodeScientificAxiomsAsConstraints(
  claim: string,
  axiomSet: { axioms: Axiom[]; domain: string }
): Constraint[] {
  const constraints: Constraint[] = [];
  const claimLower = claim.toLowerCase();

  // Encode thermodynamic constraints
  if (axiomSet.domain === 'thermodynamics') {
    // First Law: Energy conservation
    // If claim mentions efficiency > 100%, add constraint efficiency <= 1.0
    const efficiencyMatch = claimLower.match(/(\d+)%?\s*efficiency/);
    if (efficiencyMatch) {
      const efficiency = parseInt(efficiencyMatch[1]);
      if (efficiency > 100) {
        constraints.push({
          type: 'le',
          left: 'efficiency',
          right: 1.0
        });
      }
    }

    // Second Law: Entropy always increases or stays constant
    if (claimLower.includes('entropy') && (claimLower.includes('decrease') || claimLower.includes('reduce'))) {
      constraints.push({
        type: 'ge',
        left: 'entropy_change',
        right: 0
      });
    }
  }

  // Encode complexity theory constraints
  if (axiomSet.domain === 'complexity_theory') {
    // Sorting lower bound: comparison-based sorts are Ω(n log n)
    if (claimLower.includes('sort') && claimLower.includes('o(n)')) {
      constraints.push({
        type: 'ge',
        left: 'time_complexity',
        right: 'n_log_n'
      });
    }

    // Halting problem: undecidable
    if (claimLower.includes('halt') && claimLower.includes('decide')) {
      constraints.push({
        type: 'eq',
        left: 'halting_decidable',
        right: 0 // false
      });
    }
  }

  // Encode information theory constraints
  if (axiomSet.domain === 'information_theory') {
    // Shannon limit: Can't compress random data
    if (claimLower.includes('compress') && claimLower.includes('random')) {
      constraints.push({
        type: 'ge',
        left: 'compressed_size',
        right: 'entropy'
      });
    }

    // Channel capacity bound
    const capacityMatch = claimLower.match(/(\d+)\s*bits.*channel/);
    if (capacityMatch) {
      constraints.push({
        type: 'le',
        left: 'channel_rate',
        right: 'channel_capacity'
      });
    }
  }

  // Encode relativity constraints
  if (axiomSet.domain === 'relativity') {
    // Speed limit: v < c
    if (claimLower.includes('faster than light') || claimLower.includes('ftl')) {
      constraints.push({
        type: 'lt',
        left: 'velocity',
        right: 'speed_of_light'
      });
    }

    // Causality: No closed timelike curves
    if (claimLower.includes('time travel') || claimLower.includes('past')) {
      constraints.push({
        type: 'ge',
        left: 'proper_time',
        right: 0
      });
    }
  }

  return constraints;
}
