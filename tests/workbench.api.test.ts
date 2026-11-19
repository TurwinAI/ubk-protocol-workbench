import { describe, expect, it } from 'vitest';
import { runProtocolWorkbench, ApiValidationError } from '../src/server/orchestrator';
import { RESEARCH_BENCHMARKS } from '../src/server/benchmarks';

describe('Protocol Workbench Orchestrator & Negative Fault-Injection Tests', () => {
  it('executes the feasible in-place sort benchmark end-to-end in replay mode with real Z3', async () => {
    const bench = RESEARCH_BENCHMARKS.find((b) => b.id === 'inplace-sort-sat')!;
    const result = await runProtocolWorkbench({
      objective: bench.objective,
      protocolMarkdown: bench.protocolMarkdown,
      benchmarkId: bench.id,
      mode: 'replay',
    });

    expect(result.mode).toBe('replay');
    expect(result.smtResult.verdict).toBe('POSSIBLE');
    expect(result.smtResult.proof).toContain('[Z3] SAT');
    expect(result.ubk.status).toBe('PASS');
    expect(result.ubk.certificate.certificate_type).toBe('Unique-Correct');
    expect(result.plan.nodes.length).toBeGreaterThanOrEqual(3);
    expect(result.artifacts.length).toBeGreaterThanOrEqual(4);
    expect(result.verificationPacket.jobId).toBe(result.runId);
  });

  it('executes the O(n) comparison sort impossibility benchmark end-to-end', async () => {
    const bench = RESEARCH_BENCHMARKS.find((b) => b.id === 'linear-comparison-sort-unsat')!;
    const result = await runProtocolWorkbench({
      objective: bench.objective,
      protocolMarkdown: bench.protocolMarkdown,
      benchmarkId: bench.id,
      mode: 'replay',
    });

    expect(result.smtResult.verdict).toBe('IMPOSSIBLE');
    expect(result.ubk.status).toBe('IMPOSSIBLE');
    expect(result.ubk.artifactBundle.impossibilityCertificates.length).toBeGreaterThan(0);
  });

  it('fails loudly (never silently mocks) when live BYOK mode is called without an API key', async () => {
    const prevA = process.env.GEMINI_API_KEY;
    const prevB = process.env.GOOGLE_AI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;

    try {
      await expect(
        runProtocolWorkbench({
          objective: 'Sort an array without any auxiliary space',
          mode: 'live',
        })
      ).rejects.toThrowError(ApiValidationError);

      try {
        await runProtocolWorkbench({
          objective: 'Sort an array without any auxiliary space',
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
