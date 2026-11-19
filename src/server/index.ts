import 'dotenv/config';
import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESEARCH_BENCHMARKS } from './benchmarks';
import { ApiValidationError, runProtocolWorkbench, type ProtocolRunRequest } from './orchestrator';
import { executeUniversalBoundsKernel } from '../core-engine/ubkKernel';
import { SMTVerifier } from '../core-engine/smtVerifier';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    const defaultMode = process.env.PROTOTYPE_MODE === 'live' ? 'live' : 'replay';
    const hasServerKey = Boolean((process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim());
    res.json({
      ok: true,
      service: 'ubk-protocol-workbench',
      runtime: 'node',
      z3Enabled: true,
      defaultMode,
      hasServerGeminiKey: hasServerKey,
      benchmarkCount: RESEARCH_BENCHMARKS.length,
    });
  });

  app.get('/api/benchmarks', (_req: Request, res: Response) => {
    res.json({ benchmarks: RESEARCH_BENCHMARKS });
  });

  app.post('/api/verify', async (req: Request, res: Response) => {
    try {
      const { objective, candidate, smtTimeoutMs } = (req.body || {}) as {
        objective?: string;
        candidate?: string;
        smtTimeoutMs?: number;
      };
      if (!objective || typeof objective !== 'string' || !objective.trim()) {
        res.status(400).json({ ok: false, code: 'MISSING_OBJECTIVE', error: 'objective is required' });
        return;
      }
      const candidateText = typeof candidate === 'string' && candidate.trim() ? candidate.trim() : objective.trim();
      const timeout = Math.max(250, Math.min(10_000, Number(smtTimeoutMs || 2500)));

      const smt = new SMTVerifier({ useFullSolver: true, timeoutMs: timeout, enableCache: false });
      const smtResult = await smt.verifyConstraint(objective.trim(), candidateText);
      const ubk = await executeUniversalBoundsKernel(
        {
          objective: objective.trim(),
          userInput: objective.trim(),
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

      res.json({ ok: true, smtResult, ubk });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, code: 'VERIFY_ERROR', error: msg });
    }
  });

  app.post('/api/protocol/run', async (req: Request, res: Response) => {
    try {
      const payload = (req.body || {}) as ProtocolRunRequest;
      const result = await runProtocolWorkbench(payload);
      res.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof ApiValidationError) {
        res.status(err.statusCode).json({
          ok: false,
          code: err.code,
          error: err.message,
        });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, code: 'EXECUTION_ERROR', error: msg });
    }
  });

  // Serve built React UI when SERVE_STATIC=true or dist/ exists in production
  const distDir = path.join(REPO_ROOT, 'dist');
  const shouldServeStatic =
    process.env.SERVE_STATIC === 'true' ||
    (process.env.NODE_ENV === 'production' && fs.existsSync(path.join(distDir, 'index.html')));

  if (shouldServeStatic && fs.existsSync(distDir)) {
    app.use(express.static(distDir, { dotfiles: 'allow' }));
    app.get(/^(?!\/api).*/, (_req: Request, res: Response) => {
      res.sendFile('index.html', { root: distDir, dotfiles: 'allow' });
    });
  }

  return app;
}

const isDirectEntry =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectEntry) {
  const port = Number(process.env.PORT || 8787);
  const app = createApp();
  app.listen(port, '127.0.0.1', () => {
    console.log(`[ubk-protocol-workbench] API listening on http://127.0.0.1:${port}`);
  });
}
