import { describe, expect, it } from 'vitest';
import { runProtocolWorkbench, ApiValidationError } from '../src/server/orchestrator';
import { RESEARCH_BENCHMARKS } from '../src/server/benchmarks';

describe('Protocol Workbench Orchestrator & Negative Fault-Injection Tests', () => {
  it('executes the feasible Carnot 40% benchmark end-to-end with real Z3 SAT + Z3 DAG acyclicity proof', async () => {
    const bench = RESEARCH_BENCHMARKS.find((b) => b.id === 'carnot-feasible-sat')!;
    const result = await runProtocolWorkbench({
      objective: bench.objective,
      protocolMarkdown: bench.protocolMarkdown,
      benchmarkId: bench.id,
      mode: 'replay',
    });

    expect(result.mode).toBe('replay');
    expect(result.smtResult.verdict).toBe('POSSIBLE');
    expect(result.smtResult.soundness).toBe('FORMAL_SMT');
    expect(result.smtResult.proof).toContain('[Z3] SAT');
    expect(result.ubk.status).toBe('PASS');
    expect(result.ubk.certificate.certificate_type).toBe('Bounded-Verified');
    expect(result.dagVerification.isAcyclic).toBe(true);
    expect(result.dagVerification.verificationMethod).toBe('z3-sat');
    expect(result.plan.nodes.length).toBeGreaterThanOrEqual(3);
    expect(result.verificationPacket.jobId).toBe(result.runId);
  });

  it('executes the counterfactual Carnot 65% benchmark and refutes it as IMPOSSIBLE via Z3 UNSAT', async () => {
    const bench = RESEARCH_BENCHMARKS.find((b) => b.id === 'carnot-infeasible-unsat')!;
    const result = await runProtocolWorkbench({
      objective: bench.objective,
      protocolMarkdown: bench.protocolMarkdown,
      benchmarkId: bench.id,
      mode: 'replay',
    });

    expect(result.smtResult.verdict).toBe('IMPOSSIBLE');
    expect(result.smtResult.soundness).toBe('FORMAL_SMT');
    expect(result.ubk.status).toBe('IMPOSSIBLE');
    expect(result.ubk.certificate.certificate_type).toBe('Refuted');
    expect(result.ubk.artifactBundle.impossibilityCertificates.length).toBeGreaterThan(0);
  });

  it('abstains honestly as UNVERIFIED with Umap populated on unformalized prose benchmark', async () => {
    const bench = RESEARCH_BENCHMARKS.find((b) => b.id === 'unformalized-prose-abstain')!;
    const result = await runProtocolWorkbench({
      objective: bench.objective,
      protocolMarkdown: bench.protocolMarkdown,
      benchmarkId: bench.id,
      mode: 'replay',
    });

    expect(result.smtResult.verdict).toBe('UNKNOWN');
    expect(result.smtResult.soundness).toBe('UNVERIFIED');
    expect(result.ubk.status).toBe('UNVERIFIED');
    expect(result.ubk.certificate.certificate_type).toBe('Unverified-Within-Bounds');
    expect(result.ubk.state.Umap.length).toBeGreaterThan(0);
  });

  it('fails loudly (never silently mocks) when live BYOK mode is called without an API key', async () => {
    const prevA = process.env.GEMINI_API_KEY;
    const prevB = process.env.GOOGLE_AI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;

    try {
      await expect(
        runProtocolWorkbench({
          objective: 'Fit 2 items into 10 boxes',
          mode: 'live',
        })
      ).rejects.toThrowError(ApiValidationError);

      try {
        await runProtocolWorkbench({
          objective: 'Fit 2 items into 10 boxes',
          mode: 'live',
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ApiValidationError);
        expect((err as ApiValidationError).statusCode).toBe(400);
        expect((err as ApiValidationError).code).toBe('MISSING_API_KEY');
      }
    } finally {
      if (prevA !== undefined) process.env.GEMINI_API_KEY = prevA;
      if (prevB !== undefined) process.env.GOOGLE_AI_API_KEY = prevB;
    }
  });
});
