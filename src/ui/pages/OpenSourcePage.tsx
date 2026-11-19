import React, { useState } from 'react';
import { GITHUB_REPO_URL, type RoutePath } from '../types';

interface OpenSourcePageProps {
  onNavigate: (path: RoutePath) => void;
}

const QUICKSTART_CMD = `git clone ${GITHUB_REPO_URL}.git
cd ubk-protocol-workbench
npm ci && npm run build && SERVE_STATIC=true npm start`;

const VERIFY_CMD = `npm run typecheck
npm test
npm run test:e2e
npm run audit:release`;

export const OpenSourcePage: React.FC<OpenSourcePageProps> = ({ onNavigate }) => {
  const [copied, setCopied] = useState<string | null>(null);

  const copyText = (id: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1800);
    });
  };

  return (
    <main className="container-narrow prose" data-testid="open-source-page">
      <div className="eyebrow">Open Source · MIT License</div>
      <h1>The GitHub Repository, Explained in Simple Terms</h1>
      <p className="lead">
        No proprietary backends, no hidden cloud accounts, and no 30,000-file sprawl. Everything on{' '}
        <strong>turwinlabs.org</strong> comes from a clean, standalone MIT repository you can clone,
        inspect, modify, and run locally—with full Node.js Z3 WASM solving—in under two minutes.
      </p>

      <div className="cta-row" style={{ marginBottom: 32 }}>
        <a
          className="btn-primary"
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer"
          data-testid="github-primary-link"
        >
          Open on GitHub (MIT) ↗
        </a>
        <button type="button" className="btn-secondary" onClick={() => onNavigate('/workbench')}>
          Try Online First →
        </button>
      </div>

      <h2>Run It on Your Machine (3 Commands)</h2>
      <p>
        You only need <strong>Node.js 20+</strong> and <strong>npm</strong>. No API key is needed to run
        the real Z3 SMT solver, 12-domain axiom checks, and all 4 research benchmarks locally:
      </p>

      <div style={{ position: 'relative' }}>
        <pre className="code-block">{QUICKSTART_CMD}</pre>
        <button
          type="button"
          className="icon-btn"
          style={{ position: 'absolute', top: 10, right: 10 }}
          onClick={() => copyText('quick', QUICKSTART_CMD)}
        >
          {copied === 'quick' ? 'Copied' : 'Copy'}
        </button>
      </div>

      <p>
        Then open <code>http://127.0.0.1:8787</code> in your browser. Running locally activates the full{' '}
        <strong>Z3 WASM SMT solver</strong> inside Node.js so every encoded formula is checked directly by
        Z3.
      </p>

      <h2>What Is Inside the Repository?</h2>
      <p>
        Think of the codebase in five small, self-contained pieces:
      </p>

      <div className="card" style={{ padding: '10px 20px', marginBottom: 24 }}>
        <div className="tree-row">
          <div className="tree-path">src/core-engine/</div>
          <div>
            The mathematical heart: <strong>Universal Bounds Kernel</strong> (<code>ubkKernel.ts</code>),{' '}
            <strong>Turwin v4.0-FS Kernel</strong> (<code>turwinKernel.ts</code>), Z3 SMT verifier
            (<code>smtVerifier.ts</code>), natural-language constraint encoder, quantum no-cloning logic
            parser, and pluggable oracle hooks.
          </div>
        </div>
        <div className="tree-row">
          <div className="tree-path">src/data/axiomDatabase/</div>
          <div>
            12 plain JSON files encoding fundamental scientific and mathematical laws (complexity theory,
            thermodynamics, quantum mechanics, relativity, information theory, math, biology, electrical,
            mechanical, control, materials, reliability). Easy to inspect or extend with a pull request.
          </div>
        </div>
        <div className="tree-row">
          <div className="tree-path">src/core/execution/</div>
          <div>
            Turns structured Markdown research protocols into validated JSON-Schema execution graphs
            (<code>CompositeDocAst</code>), auto-registers safe tools, and packages verifiable outputs.
          </div>
        </div>
        <div className="tree-row">
          <div className="tree-path">src/server/ &amp; src/worker/</div>
          <div>
            Two clean HTTP runtimes sharing the same kernel: a local Node/Express server with full{' '}
            <strong>Z3 WASM</strong>, and a lightweight Cloudflare Worker powering{' '}
            <code>turwinlabs.org</code>.
          </div>
        </div>
        <div className="tree-row">
          <div className="tree-path">src/ui/ &amp; tests/</div>
          <div>
            This exact website (React + Vite, zero external CDN dependencies) plus Vitest unit tests,
            Playwright browser E2E tests, and an automated MIT license &amp; secret audit script.
          </div>
        </div>
      </div>

      <h2>Two Modes: Replay vs. Bring Your Own Key (BYOK)</h2>
      <div className="card-grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <h3>Replay Mode (Default, Offline)</h3>
          <p>
            Requires zero API keys and zero network calls. Curated candidate outputs are run live through
            the real formal verification kernel, Z3 SMT solver (in Node), 12-domain axiom DB, and AST
            planner so anyone can reproduce exact verdicts deterministically.
          </p>
        </div>
        <div className="card">
          <h3>Live BYOK Mode (Gemini API)</h3>
          <p>
            Set <code>GEMINI_API_KEY</code> in <code>.env</code> (or paste a key in the Workbench for a
            single request) to generate fresh candidate solutions and AST plans via{' '}
            <code>@google/genai</code>. If a key is missing or invalid, it fails loudly—never silently
            faking results.
          </p>
        </div>
      </div>

      <h2>Verify Everything Yourself</h2>
      <p>
        Every commit is checked by four objective commands—strict TypeScript compilation, real Z3 unit
        tests, headless Playwright end-to-end tests, and an automated secret + MIT license scanner:
      </p>
      <div style={{ position: 'relative' }}>
        <pre className="code-block">{VERIFY_CMD}</pre>
        <button
          type="button"
          className="icon-btn"
          style={{ position: 'absolute', top: 10, right: 10 }}
          onClick={() => copyText('verify', VERIFY_CMD)}
        >
          {copied === 'verify' ? 'Copied' : 'Copy'}
        </button>
      </div>

      <h2>How to Contribute</h2>
      <ul>
        <li>
          <strong>Add domain axioms:</strong> Drop new verified theorems or open conjectures into{' '}
          <code>src/data/axiomDatabase/*.json</code> with matching unit tests.
        </li>
        <li>
          <strong>Improve SMT-LIB2 encoders:</strong> Expand <code>src/core-engine/constraintEncoder.ts</code>{' '}
          to shrink <code>Umap</code> on new problem classes.
        </li>
        <li>
          <strong>Plug in custom oracles or models:</strong> Implement <code>VerificationOracles</code>{' '}
          in <code>src/core-engine/oracles.ts</code> or swap in any LLM provider alongside Gemini.
        </li>
      </ul>
    </main>
  );
};
