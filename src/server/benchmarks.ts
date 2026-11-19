export interface ResearchBenchmark {
  id: string;
  title: string;
  domain: string;
  expectedStatus: 'PASS' | 'IMPOSSIBLE' | 'UNVERIFIED';
  summary: string;
  objective: string;
  protocolMarkdown: string;
  replayCandidateOutput: string;
}

export const RESEARCH_BENCHMARKS: ResearchBenchmark[] = [
  {
    id: 'carnot-feasible-sat',
    title: 'Carnot Heat Engine (40% at 600 K / 300 K)',
    domain: 'Thermodynamics (QF_LRA SAT)',
    expectedStatus: 'PASS',
    summary:
      'Feasible thermal cycle below the 50% Carnot ceiling. Z3 evaluates eta_claimed <= 1 - T_cold/T_hot as SAT and mints a Bounded-Verified certificate.',
    objective:
      'Design a reversible heat engine between a 600 K hot reservoir and a 300 K cold reservoir achieving 40% thermal efficiency',
    protocolMarkdown: `# Title
Reversible Heat Engine Specification (40% Target)

## Goal
Design a reversible heat engine between a 600 K hot reservoir and a 300 K cold reservoir achieving 40% thermal efficiency.

## Steps
1. Encode reservoir temperatures T_hot = 600 K, T_cold = 300 K, and target eta_claimed = 0.40 in QF_LRA.
2. Solve the Carnot bound eta_claimed <= 1 - T_cold / T_hot in Z3.
3. Verify protocol DAG acyclicity and emit a bounded verification certificate.`,
    replayCandidateOutput:
      'Step 1: Set hot reservoir T_hot = 600 K and cold reservoir T_cold = 300 K (Carnot upper bound = 50.0%). Step 2: Operate a regenerative Brayton cycle targeting 40% net thermal efficiency, maintaining a 10% margin below the reversible Carnot ceiling.',
  },
  {
    id: 'carnot-infeasible-unsat',
    title: 'Carnot Heat Engine (65% at 600 K / 300 K)',
    domain: 'Thermodynamics (QF_LRA UNSAT)',
    expectedStatus: 'IMPOSSIBLE',
    summary:
      'Counterfactual pair with identical wording to Case 01, changing only 40% to 65%. Z3 proves 0.65 <= 0.50 is UNSAT without keyword heuristics.',
    objective:
      'Design a reversible heat engine between a 600 K hot reservoir and a 300 K cold reservoir achieving 65% thermal efficiency',
    protocolMarkdown: `# Title
Reversible Heat Engine Specification (65% Target)

## Goal
Design a reversible heat engine between a 600 K hot reservoir and a 300 K cold reservoir achieving 65% thermal efficiency.

## Steps
1. Encode reservoir temperatures T_hot = 600 K, T_cold = 300 K, and target eta_claimed = 0.65 in QF_LRA.
2. Check satisfiability against the Second Law Carnot bound in Z3.
3. Emit a Refuted certificate and impossibility witness if UNSAT.`,
    replayCandidateOutput:
      'Step 1: Couple a 600 K hot source to a 300 K cold sink and claim 65% closed-cycle thermal efficiency without auxiliary work input.',
  },
  {
    id: 'nyquist-undersampling-unsat',
    title: 'Nyquist Undersampling (20 kHz Signal at 30 kHz)',
    domain: 'Signal Processing (QF_LRA UNSAT)',
    expectedStatus: 'IMPOSSIBLE',
    summary:
      'Quantitative sampling rate violation (30 kHz < 40 kHz Nyquist minimum). Edit 30 kHz to 48 kHz in the input box to watch Z3 flip from UNSAT to SAT.',
    objective:
      'Reconstruct a bandlimited 20 kHz analog signal without aliasing using a 30 kHz uniform sampling rate',
    protocolMarkdown: `# Title
Uniform Sampling Reconstruction Check

## Goal
Reconstruct a bandlimited 20 kHz analog signal without aliasing using a 30 kHz uniform sampling rate.

## Steps
1. Encode signal bandwidth f_max = 20000 Hz and sampling rate f_s = 30000 Hz into QF_LRA.
2. Evaluate Nyquist criterion f_s >= 2 * f_max in Z3.
3. Return SAT model or UNSAT impossibility witness.`,
    replayCandidateOutput:
      'Step 1: Digitize a 20 kHz bandlimited analog signal uniformly at 30 kHz and attempt exact sinc reconstruction without aliasing.',
  },
  {
    id: 'quantum-no-cloning',
    title: 'Unknown Quantum State Cloning Violation',
    domain: 'Quantum Mechanics (Linear Resource-Flow)',
    expectedStatus: 'IMPOSSIBLE',
    summary:
      'Caught by the linear resource-flow checker when a unitary step increases unknown state |psi> multiplicity from 1 input copy to 2 output copies.',
    objective: 'Clone an unknown quantum state |psi> into |psi> ⊗ |psi> using unitary gates',
    protocolMarkdown: `# Title
Quantum State Duplication Protocol

## Goal
Clone an unknown quantum state |psi> into |psi> ⊗ |psi> using unitary gates.

## Steps
1. Input: |psi>
2. Output: |psi> ⊗ |psi>
3. Audit linear resource conservation against the Quantum No-Cloning Theorem.`,
    replayCandidateOutput:
      'Step 1:\nInput: |psi>\nOutput: |psi> ⊗ |psi>\nApply a unitary transformation mapping unknown state |psi> to two exact copies |psi> ⊗ |psi>.',
  },
  {
    id: 'unformalized-prose-abstain',
    title: 'Unformalized Governance Policy (Honest Abstention)',
    domain: 'Epistemic Abstention (Umap)',
    expectedStatus: 'UNVERIFIED',
    summary:
      'Prose objective with no extractable SMT or structural model. The kernel refuses to fabricate a PASS verdict and returns UNVERIFIED with Umap populated.',
    objective: 'Propose an organizational governance policy for open-weight model release',
    protocolMarkdown: `# Title
Open-Weight Model Release Governance Draft

## Goal
Propose an organizational governance policy for open-weight model release.

## Steps
1. Outline release review roles and escalation criteria.
2. Draft pre-release safety documentation requirements.
3. Record unformalized claims explicitly in Umap.`,
    replayCandidateOutput:
      'Step 1: Establish an internal review board for open-weight model release with written risk sign-off and incident disclosure windows.',
  },
];

export function getBenchmarkById(id?: string): ResearchBenchmark | undefined {
  if (!id) return undefined;
  return RESEARCH_BENCHMARKS.find((b) => b.id === id);
}
