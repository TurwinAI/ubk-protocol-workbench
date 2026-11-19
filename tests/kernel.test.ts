import { describe, expect, it } from 'vitest';
import { SMTVerifier } from '../src/core-engine/smtVerifier';
import { executeUniversalBoundsKernel } from '../src/core-engine/ubkKernel';
import { parseRecipeToLogic, verifyNoCloning } from '../src/core-engine/logicParser';
import { validateScientificClaim } from '../src/core-engine/scientificValidationService';
import { buildExecutionPlanFromRecipeText } from '../src/core/execution/planBuilder';
import { getZ3VerificationService } from '../src/core-engine/z3VerificationService';
import { init as initEdgeSmt } from '../src/worker/z3-shim';

describe('UBK + Turwin Formal Verification Kernel (Research Integrity & Real Z3 WASM)', () => {
  it('Carnot counterfactual pair: proves 40% SAT and 65% UNSAT between 600 K and 300 K with identical wording', async () => {
    const verifier = new SMTVerifier({ useFullSolver: true, timeoutMs: 3000, enableCache: false });

    const sat = await verifier.verifyConstraint(
      'Design a reversible heat engine between a 600 K hot reservoir and a 300 K cold reservoir achieving 40% thermal efficiency',
      'Operate a reversible thermal cycle at 40% efficiency.'
    );
    expect(sat.verdict).toBe('POSSIBLE');
    expect(sat.soundness).toBe('FORMAL_SMT');
    expect(sat.proof ?? '').toContain('[Z3] SAT');

    const unsat = await verifier.verifyConstraint(
      'Design a reversible heat engine between a 600 K hot reservoir and a 300 K cold reservoir achieving 65% thermal efficiency',
      'Operate a reversible thermal cycle at 65% efficiency.'
    );
    expect(unsat.verdict).toBe('IMPOSSIBLE');
    expect(unsat.soundness).toBe('FORMAL_SMT');
    expect(unsat.proof ?? '').toContain('[Z3] UNSAT');
  });

  it('Nyquist counterfactual pair: refutes 20 kHz signal at 30 kHz and accepts 48 kHz in Z3', async () => {
    const verifier = new SMTVerifier({ useFullSolver: true, timeoutMs: 3000, enableCache: false });

    const bad = await verifier.verifyConstraint(
      'Reconstruct a bandlimited 20 kHz analog signal without aliasing using a 30 kHz uniform sampling rate',
      'Sample at 30 kHz.'
    );
    expect(bad.verdict).toBe('IMPOSSIBLE');
    expect(bad.soundness).toBe('FORMAL_SMT');

    const good = await verifier.verifyConstraint(
      'Reconstruct a bandlimited 20 kHz analog signal without aliasing using a 48 kHz uniform sampling rate',
      'Sample at 48 kHz.'
    );
    expect(good.verdict).toBe('POSSIBLE');
    expect(good.soundness).toBe('FORMAL_SMT');
  });

  it('Pigeonhole counterfactual pair: accepts 2 items into 10 boxes and refutes 10 items into 9 boxes', async () => {
    const verifier = new SMTVerifier({ useFullSolver: true, timeoutMs: 3000, enableCache: false });

    const feasible = await verifier.verifyConstraint('Fit 2 items into 10 boxes', 'Assign 2 items to 10 boxes.');
    expect(feasible.verdict).toBe('POSSIBLE');
    expect(feasible.soundness).toBe('FORMAL_SMT');

    const impossible = await verifier.verifyConstraint('Fit 10 items into 9 boxes', 'Assign 10 items to 9 boxes.');
    expect(impossible.verdict).toBe('IMPOSSIBLE');
    expect(impossible.soundness).toBe('FORMAL_SMT');
  });

  it('Comparison sort bounds: proves asymptotic O(n) UNSAT and checks concrete ceil(log2(16!))=45', async () => {
    const verifier = new SMTVerifier({ useFullSolver: true, timeoutMs: 3000, enableCache: false });

    const asym = await verifier.verifyConstraint(
      'Design an O(n) comparison-based sorting algorithm',
      'Sort with linear comparisons.'
    );
    expect(asym.verdict).toBe('IMPOSSIBLE');
    expect(asym.soundness).toBe('FORMAL_SMT');

    const tooFew = await verifier.verifyConstraint('Sort 16 distinct elements in 30 comparisons', '30 comparisons');
    expect(tooFew.verdict).toBe('IMPOSSIBLE');
    expect(tooFew.soundness).toBe('FORMAL_SMT');

    const enough = await verifier.verifyConstraint('Sort 16 distinct elements in 48 comparisons', '48 comparisons');
    expect(enough.verdict).toBe('POSSIBLE');
    expect(enough.soundness).toBe('FORMAL_SMT');
  });

  it('Epistemic abstention: unformalized prose returns UNVERIFIED with Umap populated (never fake PASS)', async () => {
    const ubk = await executeUniversalBoundsKernel(
      {
        objective: 'Propose an organizational governance policy for open-weight model release',
        generator: async () =>
          'Establish an internal review board for open-weight model release with written risk sign-off.',
      },
      {
        config: {
          smt: { useFullSolver: true, timeoutMs: 3000 },
          resourceLimits: { timeLimitMs: 15_000, memoryLimitMB: 512, maxIterations: 2, maxPaths: 5, maxFail: 2 },
        },
      }
    );

    expect(ubk.status).toBe('UNVERIFIED');
    expect(ubk.certificate.certificate_type).toBe('Unverified-Within-Bounds');
    expect(ubk.state.Umap.length).toBeGreaterThan(0);
    expect(ubk.state.Umap[0].code).toBe('OBJECTIVE_UNFORMALIZED');
  });

  it('Deterministic SHA-256 certificate replay produces identical fingerprint across separate runs', async () => {
    const runOnce = () =>
      executeUniversalBoundsKernel(
        {
          objective:
            'Design a reversible heat engine between a 600 K hot reservoir and a 300 K cold reservoir achieving 40% thermal efficiency',
          generator: async () =>
            'Design a reversible heat engine between 600 K and 300 K achieving 40% thermal efficiency below the 50% Carnot ceiling.',
        },
        {
          config: {
            smt: { useFullSolver: true, timeoutMs: 3000 },
            resourceLimits: { timeLimitMs: 15_000, memoryLimitMB: 512, maxIterations: 3, maxPaths: 5, maxFail: 2 },
          },
        }
      );

    const a = await runOnce();
    const b = await runOnce();
    expect(a.status).toBe('PASS');
    expect(a.certificate.certificate_type).toBe('Bounded-Verified');
    expect(a.certificate.fingerprint).toBe(b.certificate.fingerprint);
  });

  it('Guards against meta-questions and flags P vs NP as an open conjecture rather than IMPOSSIBLE', async () => {
    const verifier = new SMTVerifier({ useFullSolver: true, timeoutMs: 3000, enableCache: false });
    const meta = await verifier.verifyConstraint(
      'Explain why an O(n) comparison-based sorting algorithm is impossible',
      'Decision tree lower bound explanation.'
    );
    expect(meta.verdict).toBe('UNKNOWN');
    expect(meta.soundness).toBe('UNVERIFIED');

    const pvsnp = await validateScientificClaim(
      'A polynomial time SAT solver that solves NP-complete in polynomial time under complexity theory'
    );
    expect(pvsnp.classification).toBe('Flagged');
  });

  it('Detects Quantum No-Cloning for both Unicode |ψ⟩ and ASCII |psi> notation', () => {
    const uni = parseRecipeToLogic('Step 1:\nInput: |ψ⟩\nOutput: |ψ⟩ ⊗ |ψ⟩');
    expect(uni).not.toBeNull();
    expect(verifyNoCloning(uni!).passed).toBe(false);

    const ascii = parseRecipeToLogic('Step 1:\nInput: |psi>\nOutput: |psi> ⊗ |psi>');
    expect(ascii).not.toBeNull();
    expect(verifyNoCloning(ascii!).passed).toBe(false);
  });

  it('Verifies DAG acyclicity and catches cyclic protocols using real Z3 SAT', async () => {
    const z3 = getZ3VerificationService();
    const acyclic = await z3.verifyAcyclicDAG([
      { id: 'n1', dependencies: [], inputs: [], outputs: ['a'] },
      { id: 'n2', dependencies: ['n1'], inputs: ['a'], outputs: ['b'] },
      { id: 'n3', dependencies: ['n2'], inputs: ['b'], outputs: ['c'] },
    ]);
    expect(acyclic.isAcyclic).toBe(true);
    expect(acyclic.verificationMethod).toBe('z3-sat');

    const cyclic = await z3.verifyAcyclicDAG([
      { id: 'n1', dependencies: ['n2'], inputs: [], outputs: ['a'] },
      { id: 'n2', dependencies: ['n1'], inputs: ['a'], outputs: ['b'] },
    ]);
    expect(cyclic.isAcyclic).toBe(false);
    expect(cyclic.verificationMethod).toBe('z3-sat');
  });

  it('Exact edge SMT evaluator matches Z3 on ground/affine formulas and returns unknown on quantifiers', async () => {
    const { Context, Z3 } = await initEdgeSmt();
    const ctx = Context('test');

    const carnotSat = await Z3.eval_smtlib2_string(
      ctx.ptr,
      `(declare-const T_hot Real)(declare-const T_cold Real)(declare-const eta_claimed Real)(declare-const eta_carnot Real)
       (assert (= T_hot 600.0))(assert (= T_cold 300.0))(assert (= eta_claimed 0.4))
       (assert (= (* eta_carnot T_hot) (- T_hot T_cold)))(assert (<= eta_claimed eta_carnot))(check-sat)`
    );
    expect(carnotSat).toBe('sat');

    const carnotUnsat = await Z3.eval_smtlib2_string(
      ctx.ptr,
      `(declare-const T_hot Real)(declare-const T_cold Real)(declare-const eta_claimed Real)(declare-const eta_carnot Real)
       (assert (= T_hot 600.0))(assert (= T_cold 300.0))(assert (= eta_claimed 0.65))
       (assert (= (* eta_carnot T_hot) (- T_hot T_cold)))(assert (<= eta_claimed eta_carnot))(check-sat)`
    );
    expect(carnotUnsat).toBe('unsat');

    const quantified = await Z3.eval_smtlib2_string(
      ctx.ptr,
      `(declare-const x Int)(assert (forall ((y Int)) (> y x)))(check-sat)`
    );
    expect(quantified).toBe('unknown');
  });

  it('Builds a deterministic CompositeDoc AST execution plan from structured protocol markdown', () => {
    const plan = buildExecutionPlanFromRecipeText({
      intent: 'Verify Carnot engine',
      recipeText: '# Title\nCarnot Check\n\n## Steps\n1. Encode reservoirs\n2. Solve QF_LRA\n3. Emit report',
    });
    expect(plan.nodes.length).toBeGreaterThanOrEqual(3);
    expect(plan.ast.nodes.length).toBe(plan.nodes.length);
  });
});
