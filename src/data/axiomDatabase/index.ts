/**
 * Scientific Axiom Database Loader
 * 
 * Loads domain-specific axioms for claim validation.
 * Part of the Universal Scientific Claim Validation Protocol.
 */

import informationTheoryAxioms from './information_theory.json';
import thermodynamicsAxioms from './thermodynamics.json';
import complexityTheoryAxioms from './complexity_theory.json';
import relativityAxioms from './relativity.json';
import quantumMechanicsAxioms from './quantum_mechanics.json';
import mathematicsAxioms from './mathematics.json';
import biologyAxioms from './biology.json';
import electricalAxioms from './electrical.json';
import mechanicalAxioms from './mechanical.json';
import controlAxioms from './control.json';
import materialsAxioms from './materials.json';
import reliabilityAxioms from './reliability.json';

export interface Axiom {
  id: string;
  name: string;
  statement: string;
  formal: string;
  z3_encoding: {
    variables: string[];
    constraints: string[];
  };
  violations: string[];
}

export interface OpenConjecture {
  id: string;
  name: string;
  statement: string;
  implication: string;
  flag_patterns: string[];
}

export interface AxiomSet {
  domain: string;
  version: string;
  description: string;
  axioms: Axiom[];
  open_conjectures?: OpenConjecture[];
}

// Type assertions for imported JSON
const domains: Record<string, AxiomSet> = {
  information_theory: informationTheoryAxioms as AxiomSet,
  thermodynamics: thermodynamicsAxioms as AxiomSet,
  complexity_theory: complexityTheoryAxioms as AxiomSet,
  relativity: relativityAxioms as AxiomSet,
  quantum_mechanics: quantumMechanicsAxioms as AxiomSet,
  mathematics: mathematicsAxioms as AxiomSet,
  biology: biologyAxioms as AxiomSet,
  electrical: electricalAxioms as AxiomSet,
  mechanical: mechanicalAxioms as AxiomSet,
  control: controlAxioms as AxiomSet,
  materials: materialsAxioms as AxiomSet,
  reliability: reliabilityAxioms as AxiomSet,
};

/**
 * Load axioms for a specific domain
 */
export function loadAxioms(domain: string): AxiomSet | null {
  return domains[domain] || null;
}

/**
 * Get all available domains
 */
export function getAvailableDomains(): string[] {
  return Object.keys(domains);
}

/**
 * Detect domain from claim text using keyword matching
 */
export function detectDomain(claim: string): string | null {
  const claimLower = claim.toLowerCase();
  
  // Information theory keywords
  if (claimLower.includes('compression') || 
      claimLower.includes('entropy') || 
      claimLower.includes('encoding') ||
      claimLower.includes('lossless')) {
    return 'information_theory';
  }
  
  // Thermodynamics keywords
  if (claimLower.includes('energy') || 
      claimLower.includes('heat') || 
      claimLower.includes('thermodynamic') ||
      claimLower.includes('perpetual') ||
      claimLower.includes('carnot')) {
    return 'thermodynamics';
  }
  
  // Complexity theory keywords
  if (claimLower.includes('np-complete') || 
      claimLower.includes('polynomial time') || 
      claimLower.includes('halting') ||
      claimLower.includes('turing machine')) {
    return 'complexity_theory';
  }
  
  // Relativity keywords
  if (claimLower.includes('faster than light') ||
      claimLower.includes('superluminal') ||
      claimLower.includes('ftl') ||
      claimLower.includes('time travel') ||
      claimLower.includes('warp drive')) {
    return 'relativity';
  }
  
  // Quantum mechanics keywords
  if (claimLower.includes('quantum') ||
      claimLower.includes('qubit') ||
      claimLower.includes('entanglement') ||
      claimLower.includes('superposition') ||
      claimLower.includes('wavefunction')) {
    return 'quantum_mechanics';
  }
  
  // Mathematics keywords
  if (claimLower.includes('theorem') ||
      claimLower.includes('proof') ||
      claimLower.includes('axiom') ||
      claimLower.includes('gödel') ||
      claimLower.includes('trisect')) {
    return 'mathematics';
  }
  
  // Biology keywords
  if (claimLower.includes('dna') ||
      claimLower.includes('organism') ||
      claimLower.includes('genetic') ||
      claimLower.includes('abiogenesis')) {
    return 'biology';
  }

  // Electrical engineering keywords
  if (claimLower.includes('voltage') ||
      claimLower.includes('current') ||
      claimLower.includes('resistance') ||
      claimLower.includes('ohm') ||
      claimLower.includes('nyquist') ||
      claimLower.includes('junction temp')) {
    return 'electrical';
  }

  // Mechanical engineering keywords
  if (claimLower.includes('stress') ||
      claimLower.includes('strain') ||
      claimLower.includes('yield') ||
      claimLower.includes('buckling') ||
      claimLower.includes('fatigue') ||
      claimLower.includes('load')) {
    return 'mechanical';
  }

  // Control systems keywords
  if (claimLower.includes('control') ||
      claimLower.includes('stability') ||
      claimLower.includes('overshoot') ||
      claimLower.includes('latency') ||
      claimLower.includes('actuator')) {
    return 'control';
  }

  // Materials keywords
  if (claimLower.includes('tolerance') ||
      claimLower.includes('feature size') ||
      claimLower.includes('material compatibility') ||
      claimLower.includes('corrosion')) {
    return 'materials';
  }

  // Reliability keywords
  if (claimLower.includes('mtbf') ||
      claimLower.includes('failure rate') ||
      claimLower.includes('redundancy') ||
      claimLower.includes('fault tolerance')) {
    return 'reliability';
  }
  
  return null;
}

/**
 * Check claim against violation patterns
 */
export function checkViolationPatterns(claim: string, axiomSet: AxiomSet): {
  violated: boolean;
  violatedAxiom?: Axiom;
  pattern?: string;
} {
  const claimLower = claim.toLowerCase();
  
  for (const axiom of axiomSet.axioms) {
    for (const pattern of axiom.violations) {
      if (claimLower.includes(pattern.toLowerCase())) {
        return {
          violated: true,
          violatedAxiom: axiom,
          pattern
        };
      }
    }
  }
  
  return { violated: false };
}

/**
 * Check claim against open conjecture flag patterns
 */
export function checkFlagPatterns(claim: string, axiomSet: AxiomSet): {
  flagged: boolean;
  conjecture?: OpenConjecture;
  pattern?: string;
} {
  const claimLower = claim.toLowerCase();
  
  if (!axiomSet.open_conjectures) {
    return { flagged: false };
  }
  
  for (const conjecture of axiomSet.open_conjectures) {
    for (const pattern of conjecture.flag_patterns) {
      if (claimLower.includes(pattern.toLowerCase())) {
        return {
          flagged: true,
          conjecture,
          pattern
        };
      }
    }
  }
  
  return { flagged: false };
}
