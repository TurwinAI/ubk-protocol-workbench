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
      <div className="kicker">Open Source · TurwinAI · MIT License</div>
      <h1>The Repository in Plain Terms</h1>

      <div className="abstract">
        The public repo holds the full formal kernel, twelve domain axiom tables, the protocol
        graph compiler, and this web interface. It needs no cloud account, no hosted database, and
        no paid service to build or run.
      </div>

      <div className="cta-row" style={{ marginBottom: 28 }}>
        <a
          className="btn-primary"
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer"
          data-testid="github-primary-link"
        >
          View on GitHub (TurwinAI)
        </a>
        <button type="button" className="btn-secondary" onClick={() => onNavigate('/workbench')}>
          Open Web Workbench
        </button>
      </div>

      <h2>1. Local Setup (Three Commands)</h2>
      <p>
        Install Node.js 20 or newer. Run the commands below to compile the interface and start the
        local server with full Node.js Z3 WebAssembly solving:
      </p>

      <div style={{ position: 'relative' }}>
        <pre className="code-block">{QUICKSTART_CMD}</pre>
        <button
          type="button"
          className="btn-ghost"
          style={{ position: 'absolute', top: 10, right: 10 }}
          onClick={() => copyText('quick', QUICKSTART_CMD)}
        >
          {copied === 'quick' ? 'Copied' : 'Copy'}
        </button>
      </div>

      <p>
        Open <code>http://127.0.0.1:8787</code> in a browser. Local runs load the full Z3 solver
        inside Node.js so every SMT-LIB2 formula is checked right on your machine.
      </p>

      <h2>2. Directory Map</h2>
      <p>The codebase contains five directories with distinct roles:</p>

      <div className="panel" style={{ padding: '6px 16px', marginBottom: 20 }}>
        <div className="tree-row">
          <div className="tree-path">src/core-engine/</div>
          <div>
            The Universal Bounds Kernel (<code>ubkKernel.ts</code>), Turwin v4.0-FS kernel
            (<code>turwinKernel.ts</code>), Z3 SMT verifier (<code>smtVerifier.ts</code>),
            constraint encoder, quantum no-cloning parser, and optional oracle interfaces.
          </div>
        </div>
        <div className="tree-row">
          <div className="tree-path">src/data/axiomDatabase/</div>
          <div>
            Twelve plain JSON files containing verified laws and open conjectures across physics,
            mathematics, computer science, biology, and engineering.
          </div>
        </div>
        <div className="tree-row">
          <div className="tree-path">src/core/execution/</div>
          <div>
            The Markdown protocol parser, JSON-Schema graph planner (<code>CompositeDocAst</code>),
            safe tool registry, and verification packet builder.
          </div>
        </div>
        <div className="tree-row">
          <div className="tree-path">src/server/ &amp; src/worker/</div>
          <div>
            Two HTTP entrypoints sharing the same kernel: a local Node.js server with native Z3
            WebAssembly, and a Cloudflare Worker that serves <code>turwinlabs.org</code>.
          </div>
        </div>
        <div className="tree-row">
          <div className="tree-path">src/ui/ &amp; tests/</div>
          <div>
            The React interface, Vitest kernel tests, Playwright browser tests, and an automated
            release audit script checking secrets, private identifiers, and MIT license compliance.
          </div>
        </div>
      </div>

      <h2>3. Replay Mode and Live Key Mode</h2>
      <p>
        <strong>Replay mode</strong> is the default. It uses deterministic candidate fixtures and
        runs real formal verification offline with zero external network traffic.
      </p>
      <p>
        <strong>Live BYOK mode</strong> accepts your own <code>GEMINI_API_KEY</code> in{' '}
        <code>.env</code> or per request in the Workbench. If the key is missing or rejected, the
        server returns an explicit HTTP 400 or 401 error and stops.
      </p>

      <h2>4. Automated Verification Commands</h2>
      <p>Run all four gates after any change to confirm type safety, proofs, and license hygiene:</p>

      <div style={{ position: 'relative' }}>
        <pre className="code-block">{VERIFY_CMD}</pre>
        <button
          type="button"
          className="btn-ghost"
          style={{ position: 'absolute', top: 10, right: 10 }}
          onClick={() => copyText('verify', VERIFY_CMD)}
        >
          {copied === 'verify' ? 'Copied' : 'Copy'}
        </button>
      </div>

      <h2>5. Contributing</h2>
      <ul>
        <li>
          Add domain theorems or open conjectures to <code>src/data/axiomDatabase/*.json</code> with
          matching unit tests in <code>tests/kernel.test.ts</code>.
        </li>
        <li>
          Extend <code>src/core-engine/constraintEncoder.ts</code> to translate new natural language
          bounds into valid SMT-LIB2 formulas.
        </li>
        <li>
          Bind custom external fact or prior-art checks through <code>setVerificationOracles</code>{' '}
          in <code>src/core-engine/oracles.ts</code>.
        </li>
      </ul>
    </main>
  );
};
