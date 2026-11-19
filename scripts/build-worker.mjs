#!/usr/bin/env node
/**
 * Bundles the Cloudflare Worker entrypoint (`src/worker/index.ts`) into `dist-worker/worker.js`,
 * aliasing Node-only `z3-solver` to the deterministic edge evaluator shim.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const outDir = path.join(ROOT, 'dist-worker');
fs.mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/worker/index.ts')],
  outfile: path.join(outDir, 'worker.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['workerd', 'worker', 'browser', 'import', 'default'],
  minify: true,
  alias: {
    'z3-solver': path.join(ROOT, 'src/worker/z3-shim.ts'),
  },
  external: ['node:crypto', 'crypto', 'node:buffer', 'buffer'],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

const stat = fs.statSync(path.join(outDir, 'worker.js'));
console.log(`Built dist-worker/worker.js (${(stat.size / 1024).toFixed(1)} kB)`);
