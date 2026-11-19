import { RESEARCH_BENCHMARKS } from '../server/benchmarks';
import { ApiValidationError, runProtocolWorkbench, type ProtocolRunRequest } from '../server/orchestrator';
import { executeUniversalBoundsKernel } from '../core-engine/ubkKernel';
import { SMTVerifier } from '../core-engine/smtVerifier';

export interface WorkerEnv {
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
  PROTOTYPE_MODE?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return jsonResponse({
        ok: true,
        service: 'ubk-protocol-workbench',
        runtime: 'cloudflare-workers',
        solverEngine: 'edge-smt-evaluator',
        z3Enabled: false,
        defaultMode: env.PROTOTYPE_MODE === 'live' ? 'live' : 'replay',
        hasServerGeminiKey: Boolean(env.GEMINI_API_KEY?.trim()),
        benchmarkCount: RESEARCH_BENCHMARKS.length,
      });
    }

    if (url.pathname === '/api/benchmarks' && request.method === 'GET') {
      return jsonResponse({ benchmarks: RESEARCH_BENCHMARKS });
    }

    if (url.pathname === '/api/verify' && request.method === 'POST') {
      try {
        const body = (await request.json()) as {
          objective?: string;
          candidate?: string;
          smtTimeoutMs?: number;
        };
        const objective = String(body?.objective || '').trim();
        if (!objective) {
          return jsonResponse({ ok: false, code: 'MISSING_OBJECTIVE', error: 'objective is required' }, 400);
        }
        const candidateText = String(body?.candidate || '').trim() || objective;
        const timeout = Math.max(250, Math.min(10_000, Number(body?.smtTimeoutMs || 2500)));

        const smt = new SMTVerifier({ useFullSolver: true, timeoutMs: timeout, enableCache: false });
        const smtResult = await smt.verifyConstraint(objective, candidateText);
        const ubk = await executeUniversalBoundsKernel(
          {
            objective,
            userInput: objective,
            generator: async () => candidateText,
          },
          {
            config: {
              smt: { useFullSolver: true, timeoutMs: timeout },
              resourceLimits: {
                timeLimitMs: 15_000,
                memoryLimitMB: 512,
                maxIterations: 3,
                maxPaths: 5,
                maxFail: 2,
              },
            },
          }
        );

        return jsonResponse({ ok: true, smtResult, ubk });
      } catch (err) {
        return jsonResponse(
          { ok: false, code: 'VERIFY_ERROR', error: err instanceof Error ? err.message : String(err) },
          500
        );
      }
    }

    if (url.pathname === '/api/protocol/run' && request.method === 'POST') {
      try {
        const body = (await request.json()) as ProtocolRunRequest;
        const effectiveReq: ProtocolRunRequest = {
          ...body,
          apiKey: body.apiKey?.trim() || env.GEMINI_API_KEY?.trim() || undefined,
        };
        const result = await runProtocolWorkbench(effectiveReq);
        return jsonResponse({ ok: true, ...result });
      } catch (err) {
        if (err instanceof ApiValidationError) {
          return jsonResponse({ ok: false, code: err.code, error: err.message }, err.statusCode);
        }
        return jsonResponse(
          { ok: false, code: 'EXECUTION_ERROR', error: err instanceof Error ? err.message : String(err) },
          500
        );
      }
    }

    // Serve static assets + SPA fallback for /, /workbench, /research, /open-source
    if (env.ASSETS) {
      const assetResp = await env.ASSETS.fetch(request);
      if (assetResp.status !== 404 || url.pathname.includes('.')) {
        return assetResp;
      }
      const indexUrl = new URL('/index.html', url.origin);
      return env.ASSETS.fetch(new Request(indexUrl.toString(), request));
    }

    return new Response('Not Found', { status: 404 });
  },
};
