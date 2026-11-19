/**
 * Scientific Claim Validation Service (Epistemically Honest)
 * ==========================================================
 *
 * Classifies claims against the 12-domain axiom database and quantitative Z3 SMT:
 * - Rejected:   Contradicts a quantitative Z3 bound or curated physical/mathematical axiom.
 * - Flagged:    Touches an open conjecture (e.g., P vs NP, integer factoring) -> NEVER rejected.
 * - Accepted:   Consistent with checked quantitative bounds and domain axioms.
 * - Unverified: No domain axioms or quantitative bounds applied.
 */

import {
  loadAxioms,
  detectDomain,
  checkViolationPatterns,
  checkFlagPatterns,
} from '../data/axiomDatabase';
import { isMetaDiscussionPrompt } from './constraintEncoder';
import { smtVerifier } from './smtVerifier';
import { info } from '../utils/logger';

export type ClaimClassification = 'Rejected' | 'Flagged' | 'Accepted' | 'Unverified';

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

export async function validateScientificClaim(
  claim: string,
  domainHint?: string
): Promise<ValidationResult> {
  info('SCIENTIFIC_VALIDATION', 'Starting claim validation', { claimPreview: claim.substring(0, 100) });

  if (isMetaDiscussionPrompt(claim)) {
    return {
      classification: 'Unverified',
      proof: null,
      reasoning_summary: 'Prompt asks an explanatory or meta-level question; no empirical or formal claim asserted.',
    };
  }

  // Step 1: Real quantitative SMT check first (Carnot, Nyquist, Pigeonhole, Comparison Sort, Latency)
  const smtCheck = await smtVerifier.verifyConstraint(claim, claim);
  if (smtCheck.soundness === 'FORMAL_SMT') {
    if (smtCheck.verdict === 'IMPOSSIBLE') {
      return {
        classification: 'Rejected',
        proof: [smtCheck.proof || 'Z3 SMT solver proved UNSAT'],
        reasoning_summary: `${smtCheck.proof} (solved in ${smtCheck.timeMs}ms).`,
        domain: smtCheck.domain?.toLowerCase(),
      };
    }
    if (smtCheck.verdict === 'POSSIBLE') {
      return {
        classification: 'Accepted',
        proof: [smtCheck.proof || 'Z3 SMT solver proved SAT'],
        reasoning_summary: `${smtCheck.proof} (solved in ${smtCheck.timeMs}ms).`,
        domain: smtCheck.domain?.toLowerCase(),
      };
    }
  }

  // Step 2: Detect domain and load curated axiom + open-conjecture table
  const domain = domainHint || detectDomain(claim);
  if (!domain) {
    return {
      classification: 'Unverified',
      proof: null,
      reasoning_summary: 'No domain-specific axioms or quantitative bounds matched this claim.',
    };
  }

  const axiomSet = loadAxioms(domain);
  if (!axiomSet) {
    return {
      classification: 'Unverified',
      proof: null,
      reasoning_summary: `No axioms loaded for domain "${domain}".`,
      domain,
    };
  }

  // Step 3: Check open conjectures BEFORE rejection (e.g. P vs NP must be Flagged, not Rejected)
  const flagCheck = checkFlagPatterns(claim, axiomSet);
  if (flagCheck.flagged && flagCheck.conjecture) {
    return {
      classification: 'Flagged',
      proof: null,
      reasoning_summary: `Open conjecture flagged (${flagCheck.conjecture.name}): ${flagCheck.conjecture.implication}`,
      domain,
      flagged_conjecture: {
        id: flagCheck.conjecture.id,
        name: flagCheck.conjecture.name,
        statement: flagCheck.conjecture.statement,
      },
    };
  }

  // Step 4: Check curated qualitative violation patterns (explicitly marked as heuristic pattern)
  const violationCheck = checkViolationPatterns(claim, axiomSet);
  if (violationCheck.violated && violationCheck.violatedAxiom) {
    return {
      classification: 'Rejected',
      proof: [
        `HEURISTIC AXIOM PATTERN: ${violationCheck.violatedAxiom.name}`,
        `STATEMENT: ${violationCheck.violatedAxiom.statement}`,
        `FORMAL REFERENCE: ${violationCheck.violatedAxiom.formal}`,
        `MATCHED PHRASE: "${violationCheck.pattern}"`,
      ],
      reasoning_summary: `Heuristic axiom violation (${violationCheck.violatedAxiom.name}): matched "${violationCheck.pattern}".`,
      domain,
      violated_axiom: {
        id: violationCheck.violatedAxiom.id,
        name: violationCheck.violatedAxiom.name,
        statement: violationCheck.violatedAxiom.statement,
      },
    };
  }

  return {
    classification: 'Unverified',
    proof: null,
    reasoning_summary: `Checked ${axiomSet.axioms.length} curated axioms in "${domain}" with no pattern violation; no formal SMT proof generated.`,
    domain,
  };
}

/**
 * Curated qualitative impossibility phrase check (heuristic pre-filter; never labeled FORMAL_SMT).
 * Excludes open conjectures (P vs NP, factoring) and guards against explanatory meta-questions.
 */
export function quickImpossibilityCheck(claim: string): {
  impossible: boolean;
  reason?: string;
} {
  if (isMetaDiscussionPrompt(claim)) {
    return { impossible: false };
  }

  const claimLower = claim.toLowerCase();
  const quickChecks = [
    { pattern: 'beats entropy', reason: 'Heuristic pattern: Shannon entropy bound' },
    { pattern: 'exceeds shannon', reason: 'Heuristic pattern: Shannon entropy bound' },
    { pattern: 'sub-entropy', reason: 'Heuristic pattern: Shannon entropy bound' },
    { pattern: 'perpetual motion', reason: 'Heuristic pattern: First/Second Law of Thermodynamics' },
    { pattern: 'free energy device', reason: 'Heuristic pattern: First Law of Thermodynamics' },
    { pattern: 'over unity', reason: 'Heuristic pattern: First Law of Thermodynamics' },
    { pattern: 'over-unity', reason: 'Heuristic pattern: First Law of Thermodynamics' },
    { pattern: 'solves halting problem', reason: 'Heuristic pattern: Halting Problem undecidability' },
    { pattern: 'faster than light', reason: 'Heuristic pattern: Special Relativity causal limit' },
    { pattern: 'superluminal', reason: 'Heuristic pattern: Special Relativity causal limit' },
    { pattern: 'ftl travel', reason: 'Heuristic pattern: Special Relativity causal limit' },
    { pattern: 'clone quantum state', reason: 'Heuristic pattern: Quantum No-Cloning Theorem' },
    { pattern: 'copy quantum information', reason: 'Heuristic pattern: Quantum No-Cloning Theorem' },
    { pattern: 'trisect any angle with compass', reason: 'Heuristic pattern: Wantzel angle-trisection impossibility' },
    { pattern: 'squaring the circle', reason: 'Heuristic pattern: Lindemann-Weierstrass impossibility' },
    { pattern: 'proves its own consistency', reason: 'Heuristic pattern: Gödel Second Incompleteness Theorem' },
  ];

  for (const check of quickChecks) {
    if (claimLower.includes(check.pattern)) {
      return { impossible: true, reason: check.reason };
    }
  }

  return { impossible: false };
}
