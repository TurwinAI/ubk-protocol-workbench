import React from 'react';
import { GITHUB_REPO_URL, type BenchmarkItem, type HealthResponse, type RoutePath } from '../types';

interface OverviewPageProps {
  health: HealthResponse | null;
  benchmarks: BenchmarkItem[];
  onNavigate: (path: RoutePath) => void;
  onLaunchBenchmark: (benchmarkId: string) => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({
  health,
  benchmarks,
  onNavigate,
  onLaunchBenchmark,
}) => {
  return (
    <main className="container">
      <section className="hero">
        <div>
          <div className="eyebrow">Turwin Labs · Open Research Prototype (MIT)</div>
          <h1 className="hero-title">Formal bounds for generative reasoning.</h1>
          <p className="hero-lead">
            Large language models can synthesize complex algorithms and scientific protocols in seconds—yet
            will just as confidently propose perpetual motion machines or linear-time comparison sorts.
            The <strong>Universal Bounds Kernel (UBK)</strong> wraps untrusted generative proposals inside
            auditable mathematical invariants, SMT solving, a 12-domain axiom database, and deterministic
            impossibility certificates.
          </p>
          <div className="cta-row">
            <button
              type="button"
              className="btn-primary"
              data-testid="hero-open-workbench"
              onClick={() => onNavigate('/workbench')}
            >
              Open Live Workbench →
            </button>
            <button
              type="button"
              className="btn-secondary"
              data-testid="hero-open-research"
              onClick={() => onNavigate('/research')}
            >
              Read the Research
            </button>
            <a
              className="btn-secondary"
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
            >
              GitHub Repo (MIT) ↗
            </a>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 22 }}>
            <span className={`pill ${health?.ok ? 'ok' : ''}`} data-testid="overview-health">
              {health?.ok
                ? `ONLINE · ${health.runtime === 'node' ? 'NODE Z3 WASM' : 'EDGE SMT KERNEL'}`
                : 'CONNECTING...'}
            </span>
            <span className="pill">12 SCIENTIFIC AXIOM DOMAINS</span>
            <span className="pill">ZERO CLOUD LOCK-IN</span>
            <span className="pill">MIT LICENSE</span>
          </div>
        </div>

        <div className="hero-visual" aria-label="Universal Bounds Kernel pipeline diagram">
          <div className="hero-visual-header">
            <span>UBK v4.0-FS · EXECUTION PIPELINE</span>
            <span>DETERMINISTIC GATE</span>
          </div>
          <div className="diagram-step">
            <span className="step-num">01</span>
            <div>
              <div className="step-title">Constraint Formalization (Cir + Umap)</div>
              <div className="step-desc">
                Extracts hard constraints into SMT-LIB2 formulas and explicitly logs unformalized
                unknown regions instead of hiding them.
              </div>
            </div>
          </div>
          <div className="diagram-step">
            <span className="step-num">02</span>
            <div>
              <div className="step-title">5-Invariant + Z3 SMT + 12-Domain Axioms</div>
              <div className="step-desc">
                Verifies Provenance, TypeOK, ASTOK, GoalOK, CycleFree, Z3 satisfiability, scientific
                laws, and quantum no-cloning resource flow.
              </div>
            </div>
          </div>
          <div className="diagram-step">
            <span className="step-num">03</span>
            <div>
              <div className="step-title">BoundedCertificate &amp; ImpCert Minting</div>
              <div className="step-desc">
                Classifies every bounded run as <code>Unique-Correct</code>,{' '}
                <code>Unresolved-Within-Bounds</code>, or <code>Failure</code> with a SHA-256 fingerprint.
              </div>
            </div>
          </div>
          <div className="diagram-step">
            <span className="step-num">04</span>
            <div>
              <div className="step-title">Protocol-to-AST Execution Workbench</div>
              <div className="step-desc">
                Compiles verified protocols into executable CompositeDoc AST DAGs and inspectable
                verification packets.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <h2 className="section-title">Try a live formal proof in one click</h2>
            <p className="section-sub">
              Each benchmark executes the real UBK kernel, axiom database, and AST planner in deterministic
              replay mode—no account or API key required.
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={() => onNavigate('/workbench')}>
            Custom Objective →
          </button>
        </div>

        <div className="card-grid-2">
          {benchmarks.map((item) => (
            <button
              key={item.id}
              type="button"
              className="bench-preview"
              data-testid={`overview-benchmark-${item.id}`}
              onClick={() => onLaunchBenchmark(item.id)}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.96rem', color: 'var(--text)' }}>
                    {item.title}
                  </span>
                  <span className={`badge ${item.expectedStatus}`}>{item.expectedStatus}</span>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--muted)', marginTop: 4 }}>
                  {item.domain}
                </div>
                <p style={{ marginTop: 10, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                  {item.summary}
                </p>
              </div>
              <div style={{ fontSize: '0.82rem', fontWeight: 650, color: 'var(--accent)' }}>
                Run in Workbench →
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <h2 className="section-title">Built for reproducible open science</h2>
            <p className="section-sub">
              Extracted as a clean-room MIT codebase so any researcher can audit every line, run Z3 locally,
              or plug in their own model.
            </p>
          </div>
        </div>

        <div className="card-grid-3">
          <div className="card">
            <h3>Honest Soundness Boundaries</h3>
            <p>
              Never silently fakes verification. Every result distinguishes mathematically sound SMT/axiom
              proofs (<code>SOUND</code>) from unformalized regions (<code>Umap</code>) and fails loudly if a live
              API key is missing.
            </p>
          </div>
          <div className="card">
            <h3>12-Domain Scientific Axiom DB</h3>
            <p>
              Ships structured JSON axiom sets spanning complexity theory, thermodynamics, quantum mechanics,
              relativity, information theory, mathematics, biology, electrical, mechanical, control, materials,
              and reliability.
            </p>
          </div>
          <div className="card">
            <h3>Clone &amp; Run in 3 Commands</h3>
            <p>
              Zero Firebase, zero auth walls, zero proprietary services. Run offline with full local Node Z3
              WASM in replay mode, or bring your own Gemini API key (BYOK) for live protocol synthesis.
            </p>
            <div style={{ marginTop: 12 }}>
              <button type="button" className="icon-btn" onClick={() => onNavigate('/open-source')}>
                Explore the GitHub Repo in Simple Terms →
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
};
