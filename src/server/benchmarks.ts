export interface ResearchBenchmark {
  id: string;
  title: string;
  domain: string;
  expectedStatus: 'PASS' | 'IMPOSSIBLE';
  summary: string;
  objective: string;
  protocolMarkdown: string;
  replayCandidateOutput: string;
}

export const RESEARCH_BENCHMARKS: ResearchBenchmark[] = [
  {
    id: 'inplace-sort-sat',
    title: 'In-Place O(1) Auxiliary Space Sorting',
    domain: 'Complexity Theory (Z3 SAT)',
    expectedStatus: 'PASS',
    summary: 'Feasible algorithmic objective verified by Z3 WASM as SAT with a Unique-Correct bounded certificate.',
    objective: 'Sort an array without any auxiliary space',
    protocolMarkdown: `# Title
In-Place Heapsort Verification Protocol

## Goal
Sort an array without any auxiliary space while preserving O(n log n) worst-case comparison complexity.

## Principles
- Maintain the max-heap invariant strictly within the input array buffer.
- Restrict auxiliary working memory to O(1) scalar index variables.

## Operations
- Heapify: Convert unsorted array slice into a binary max-heap in place.
- ExtractMax: Swap root with tail boundary and restore heap property via sift-down.

## Steps
1. Formalize memory and comparison complexity constraints for sorting an array without any auxiliary space.
2. Construct the in-place heapsort algorithm using constant O(1) auxiliary space.
3. Verify constraint consistency via Z3 SMT solver and synthesize the verification report.

## Final Output
Verified in-place sorting protocol with bounded correctness certificate.`,
    replayCandidateOutput:
      'To sort an array without any auxiliary space, build a binary max-heap in place using constant O(1) auxiliary space (only scalar indices i, parent, left, right). Step 1: Heapify from index floor(n/2)-1 down to 0. Step 2: Repeatedly swap root element 0 with the end of the unsorted suffix and sift down to restore the max-heap invariant in O(n log n) worst-case comparisons and O(1) auxiliary space.',
  },
  {
    id: 'linear-comparison-sort-unsat',
    title: 'O(n) Comparison-Based Sorting Impossibility',
    domain: 'Complexity Theory (Lower Bound)',
    expectedStatus: 'IMPOSSIBLE',
    summary: 'Provably impossible claim violating the Ω(n log n) decision-tree lower bound; mints an Impossibility Certificate (ImpCert).',
    objective: 'Design an O(n) comparison-based sorting algorithm for arbitrary comparable elements',
    protocolMarkdown: `# Title
Linear-Time Comparison Sort Feasibility Study

## Goal
Design an O(n) comparison-based sorting algorithm for arbitrary comparable elements.

## Steps
1. Encode the comparison-based sorting decision-tree lower bound into SMT-LIB2.
2. Attempt to construct a comparison-only sorting procedure running in O(n) worst-case time.
3. Evaluate satisfiability and emit an Impossibility Certificate if refuted.`,
    replayCandidateOutput:
      'Step 1: Compare adjacent elements in a single linear O(n) comparison-based sort pass to sort arbitrary inputs in O(n) worst-case comparisons.',
  },
  {
    id: 'perpetual-motion-carnot',
    title: 'Over-Unity Heat Engine (>100% Efficiency)',
    domain: 'Thermodynamics (2nd Law Axiom)',
    expectedStatus: 'IMPOSSIBLE',
    summary: 'Violates conservation of energy and Carnot efficiency bounds in the 12-domain scientific axiom database.',
    objective: 'Build a closed-cycle perpetual motion thermal engine with 150% energy efficiency',
    protocolMarkdown: `# Title
Over-Unity Thermal Cycle Audit

## Goal
Build a closed-cycle perpetual motion thermal engine with 150% energy efficiency.

## Steps
1. Formalize thermodynamic efficiency bounds against the axiom database.
2. Propose a closed-loop heat engine exceeding Carnot efficiency.
3. Verify conservation laws and record any impossibility witnesses.`,
    replayCandidateOutput:
      'Step 1: Build a perpetual motion machine operating in a closed thermal cycle that extracts ambient heat and outputs 150% efficiency without any external work input, violating the second law of thermodynamics.',
  },
  {
    id: 'quantum-no-cloning',
    title: 'Unknown Quantum State Cloning Violation',
    domain: 'Quantum Mechanics (Resource-Flow Logic)',
    expectedStatus: 'IMPOSSIBLE',
    summary: 'Detected by the kernel resource-flow logic parser when a step duplicates an unknown quantum state |ψ⟩ into |ψ⟩ ⊗ |ψ⟩.',
    objective: 'Clone an unknown quantum state |ψ⟩ into two exact copies',
    protocolMarkdown: `# Title
Quantum State Duplication Protocol

## Goal
Clone an unknown quantum state |ψ⟩ into two exact copies using unitary gates.

## Steps
1. Input: |ψ⟩
2. Apply unitary copier to output |ψ⟩ ⊗ |ψ⟩
3. Audit resource conservation against the Quantum No-Cloning Theorem.`,
    replayCandidateOutput:
      'Step 1:\nInput: |ψ⟩\nOutput: |ψ⟩ ⊗ |ψ⟩\nClone an unknown quantum state |ψ⟩ into two identical independent copies via unitary evolution.',
  },
];

export function getBenchmarkById(id?: string): ResearchBenchmark | undefined {
  if (!id) return undefined;
  return RESEARCH_BENCHMARKS.find((b) => b.id === id);
}
