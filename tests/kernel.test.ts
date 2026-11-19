import { describe, expect, it } from 'vitest';
import { SMTVerifier } from '../src/core-engine/smtVerifier';
import { executeUniversalBoundsKernel } from '../src/core-engine/ubkKernel';
import { parseRecipeToLogic, verifyNoCloning } from '../src/core-engine/logicParser';
import { validateScientificClaim } from '../src/core-engine/scientificValidationService';
import { buildExecutionPlanFromRecipeText } from '../src/core/execution/planBuilder';

describe('UBK + Turwin Formal Verification Kernel (Node Z3 WASM)', () => {
  it('proves feasible in-place sorting SAT via real Z3 WASM and mints Unique-Correct certificate', async () => {
    const verifier = new SMTVerifier({ useFullSolver: true, timeoutMs: 3000, enableCache: false });
    const smt = await verifier.verifyConstraint(
      'Sort an array without any auxiliary space',
      'Build a max-heap in place using O(1) auxiliary space.'
    );
    expect(smt.verdict).toBe('POSSIBLE');
    expect(smt.soundness).toBe('SOUND');
    expect(smt.proof ?? '').toContain('[Z3] SAT');

    const ubk = await executeUniversalBoundsKernel(
      {
        objective: 'Sort an array without any auxiliary space',
        generator: async () =>
          'To sort an array without any auxiliary space, build a binary max-heap in place using constant O(1) auxiliary space and sift down in O(n log n) comparisons.',
      },
      {
        config: {
          smt: { useFullSolver: true, timeoutMs: 3000 },
          resourceLimits: { timeLimitMs: 15_000, memoryLimitMB: 512, maxIterations: 3, maxPaths: 5, maxFail: 2 },
        },
      }
    );

    expect(ubk.status).toBe('PASS');
    expect(ubk.runStatus).toBe('SUCCESS');
    expect(ubk.certificate.certificate_type).toBe('Unique-Correct');
    expect(ubk.artifactBundle.impossibilityCertificates).toHaveLength(0);
  });

  it('refutes O(n) comparison-based sorting as IMPOSSIBLE and mints an ImpCert', async () => {
    const ubk = await executeUniversalBoundsKernel(
      {
        objective: 'Design an O(n) comparison-based sorting algorithm',
        generator: async () =>
          'Step 1: Compare adjacent items in O(n) comparison-based sort time.',
      },
      {
        config: {
          smt: { useFullSolver: true, timeoutMs: 3000 },
          resourceLimits: { timeLimitMs: 15_000, memoryLimitMB: 512, maxIterations: 3, maxPaths: 5, maxFail: 2 },
        },
      }
    );

    expect(ubk.status).toBe('IMPOSSIBLE');
    expect(ubk.artifactBundle.impossibilityCertificates.length).toBeGreaterThan(0);
  });

  it('detects Quantum No-Cloning resource duplication via logicParser', () => {
    const steps = parseRecipeToLogic('Step 1:\nInput: |ψ⟩\nOutput: |ψ⟩ ⊗ |ψ⟩');
    expect(steps).not.toBeNull();
    const check = verifyNoCloning(steps!);
    expect(check.passed).toBe(false);
    expect(check.violationStep).toBe(1);
  });

  it('rejects thermodynamic perpetual motion claims via 12-domain axiom database', async () => {
    const res = await validateScientificClaim(
      'Build a perpetual motion machine with 150% efficiency violating the second law of thermodynamics.'
    );
    expect(res.classification).toBe('Rejected');
  });

  it('builds a deterministic CompositeDoc AST execution plan from structured protocol markdown', () => {
    const plan = buildExecutionPlanFromRecipeText({
      intent: 'Verify in-place sorting',
      recipeText: '# Title\nSort Verification\n\n## Steps\n1. Formalize memory bounds\n2. Generate algorithm\n3. Produce verification report',
    });
    expect(plan.nodes.length).toBeGreaterThanOrEqual(3);
    expect(plan.ast.nodes.length).toBe(plan.nodes.length);
  });
});
