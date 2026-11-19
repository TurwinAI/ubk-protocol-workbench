import React, { useEffect, useState } from 'react';
import {
  GITHUB_REPO_URL,
  type BenchmarkItem,
  type HealthResponse,
  type RoutePath,
  type RunResult,
} from '../types';

interface OverviewPageProps {
  health: HealthResponse | null;
  benchmarks: BenchmarkItem[];
  onNavigate: (path: RoutePath) => void;
  onLaunchBenchmark: (benchmarkId: string) => void;
}

const SHORT_CASE_LABELS: Record<string, string> = {
  'inplace-sort-sat': 'In-Place O(1) Sort',
  'linear-comparison-sort-unsat': 'O(n) Comparison Sort',
  'perpetual-motion-carnot': 'Over-Unity Heat Engine',
  'quantum-no-cloning': 'Quantum State Cloning',
};

const MECHANISM_STAGES = [
  {
    num: '01',
    title: 'Encode Constraints',
    summary:
      'The encoder parses a stated objective into domain tags and SMT-LIB2 formulas with clear confidence scores. Any unformalized claim enters an open region list called Umap.',
    artifactLabel: 'SMT-LIB2 ENCODING (O(1) AUXILIARY SPACE)',
    code: `; Constraint IR: ubk-o1_space-1 (COMPLEXITY)
(declare-const auxiliary_space Int)
(declare-const n Int)
(assert (> n 0))
(assert (forall ((n_val Int))
  (=> (> n_val 0)
      (= auxiliary_space auxiliary_space))))
(check-sat)`,
  },
  {
    num: '02',
    title: 'Check Invariants and Axioms',
    summary:
      'Each candidate meets five structural invariants (Prov, TypeOK, ASTOK, GoalOK, CycleFree), an SMT proof check, twelve domain axiom tables, and a quantum resource flow check.',
    artifactLabel: 'KERNEL INVARIANT LEDGER',
    code: `{
  "target_rule_set_id": "TURWIN-INV-v4.0-FS",
  "invariant_checks": {
    "Prov": true,
    "TypeOK": true,
    "ASTOK": true,
    "GoalOK": true,
    "CycleFree": true
  },
  "axiom_domains_loaded": 12,
  "resource_flow_check": "PASS"
}`,
  },
  {
    num: '03',
    title: 'Mint Bounded Certificate',
    summary:
      'Execution halts inside fixed iteration, branch, and failure limits. The kernel signs one of three verdicts with SHA-256: Unique-Correct, Unresolved-Within-Bounds, or Failure.',
    artifactLabel: 'BOUNDED CERTIFICATE OUTPUT',
    code: `{
  "certificate_type": "Unique-Correct",
  "certificate_version": "2.0",
  "declared_bounds": { "max_paths": 5, "max_steps_per_path": 3 },
  "proof_artifact": { "pass_count": 1, "fail_count": 0 },
  "determinism_claim": "Identical bounds and input yield identical ledger."
}`,
  },
  {
    num: '04',
    title: 'Compile Execution Graph',
    summary:
      'Accepted protocols compile into a schema-checked directed graph (CompositeDocAst). Each node records its modality, dependency order, and proof packet.',
    artifactLabel: 'EXECUTION GRAPH NODES',
    code: `node_01 [Formalize Bounds]       -> modality: text
node_02 [Construct Algorithm]    -> modality: text
node_03 [Verify & Synthesize]    -> modality: text
node_04 [Verification Summary]   -> artifact: report`,
  },
];

export const OverviewPage: React.FC<OverviewPageProps> = ({
  health,
  benchmarks,
  onNavigate,
  onLaunchBenchmark,
}) => {
  const [selectedId, setSelectedId] = useState<string>('inplace-sort-sat');
  const [claimInput, setClaimInput] = useState<string>('Sort an array without any auxiliary space');
  const [running, setRunning] = useState<boolean>(false);
  const [liveResult, setLiveResult] = useState<RunResult | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<number>(0);

  const runLiveConsole = async (objectiveText: string, benchId?: string) => {
    if (!objectiveText.trim()) return;
    setRunning(true);
    setLiveError(null);
    try {
      const resp = await fetch('/api/protocol/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: objectiveText.trim(),
          benchmarkId: benchId,
          mode: 'replay',
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data?.ok) {
        setLiveError(data?.error || `HTTP ${resp.status}`);
        return;
      }
      setLiveResult(data as RunResult);
    } catch (err) {
      setLiveError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    void runLiveConsole('Sort an array without any auxiliary space', 'inplace-sort-sat');
  }, []);

  const handleSelectCase = (item: BenchmarkItem) => {
    setSelectedId(item.id);
    setClaimInput(item.objective);
    void runLiveConsole(item.objective, item.id);
  };

  const stage = MECHANISM_STAGES[activeStage];

  return (
    <main className="container">
      <section className="hero-split">
        <div>
          <div className="kicker">Turwin Labs Technical Prototype · MIT License</div>
          <h1 className="hero-h1">Formal bounds for generative reasoning.</h1>
          <p className="hero-copy">
            Language models draft code and technical procedures fast, yet they often propose designs
            that violate physical laws or known mathematical bounds. The Universal Bounds Kernel
            checks every candidate against formal invariants, SMT proofs, and twelve domain axiom
            tables before any protocol runs.
          </p>
          <p className="hero-copy">
            Each run halts inside fixed iteration and failure caps. The kernel returns a signed
            verification certificate, a disproof witness, or an explicit map of claims that remain
            unproved.
          </p>

          <div className="cta-row">
            <button
              type="button"
              className="btn-primary"
              data-testid="hero-open-workbench"
              onClick={() => onNavigate('/workbench')}
            >
              Open Workbench
            </button>
            <button
              type="button"
              className="btn-secondary"
              data-testid="hero-open-research"
              onClick={() => onNavigate('/research')}
            >
              Read Research Note
            </button>
            <a className="btn-secondary" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
          </div>

          <div className="meta-strip">
            <div>
              SOLVER{' '}
              <strong>
                {health?.runtime === 'node' ? 'Z3 WASM (Node)' : 'Edge SMT + Local Z3'}
              </strong>
            </div>
            <div>
              AXIOMS <strong>12 Domains</strong>
            </div>
            <div>
              BENCHMARKS <strong>{benchmarks.length || 4} Cases</strong>
            </div>
            <div>
              LICENSE <strong>MIT</strong>
            </div>
          </div>
        </div>

        <div className="console-panel" data-testid="hero-console">
          <div className="console-bar">
            <span>LIVE KERNEL CONSOLE · REPLAY MODE</span>
            <span>{running ? 'SOLVING...' : liveResult ? `${liveResult.timingMs.total} ms` : 'READY'}</span>
          </div>
          <div className="console-body">
            <div className="case-tabs">
              {benchmarks.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  title={item.title}
                  data-testid={`hero-case-${item.id}`}
                  className={`case-tab ${selectedId === item.id ? 'active' : ''}`}
                  onClick={() => handleSelectCase(item)}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {SHORT_CASE_LABELS[item.id] || item.title}
                  </span>
                  <span className={`badge ${item.expectedStatus}`}>{item.expectedStatus}</span>
                </button>
              ))}
            </div>

            <div className="console-input-row">
              <input
                type="text"
                className="console-input"
                aria-label="Claim to verify"
                value={claimInput}
                onChange={(e) => {
                  setSelectedId('');
                  setClaimInput(e.target.value);
                }}
              />
              <button
                type="button"
                className="btn-primary"
                disabled={running || !claimInput.trim()}
                onClick={() => void runLiveConsole(claimInput, selectedId || undefined)}
              >
                {running ? 'Checking' : 'Verify'}
              </button>
            </div>

            {liveError && <div className="error-banner">{liveError}</div>}

            {liveResult && (
              <div>
                <div className="kv-grid" style={{ marginBottom: 10 }}>
                  <div className="kv">
                    <div className="kv-label">Verdict</div>
                    <div className="kv-val" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className={`badge ${liveResult.ubk.status}`}>{liveResult.ubk.status}</span>
                    </div>
                  </div>
                  <div className="kv">
                    <div className="kv-label">Certificate</div>
                    <div className="kv-val">{liveResult.ubk.certificate.certificate_type}</div>
                  </div>
                  <div className="kv">
                    <div className="kv-label">SMT Solver</div>
                    <div className="kv-val">
                      {liveResult.smtResult.verdict} ({liveResult.smtResult.soundness})
                    </div>
                  </div>
                </div>

                <div className="label-caps" style={{ marginTop: 8 }}>
                  Solver Proof Trace
                </div>
                <pre className="code-block" style={{ marginBottom: 10 }}>
                  {liveResult.smtResult.proof || liveResult.scientificValidation.reasoning_summary}
                </pre>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)' }}>
                    SHA-256: {liveResult.ubk.certificate.fingerprint.slice(0, 20)}...
                  </span>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => onLaunchBenchmark(selectedId || 'inplace-sort-sat')}
                  >
                    Inspect Full Run in Workbench
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="stepper-section">
        <div>
          <h2 className="section-heading">Verification Pipeline</h2>
          <p className="section-intro">
            Select a stage to inspect the formal data passed between the language model and the
            compiled plan graph.
          </p>
          <div className="step-list">
            {MECHANISM_STAGES.map((s, idx) => (
              <button
                key={s.num}
                type="button"
                data-testid={`stage-${s.num}`}
                className={`step-item ${activeStage === idx ? 'active' : ''}`}
                onClick={() => setActiveStage(idx)}
              >
                <div className="step-item-head">
                  <span>{s.title}</span>
                  <span className="step-index">{s.num}</span>
                </div>
                {activeStage === idx && <div className="step-item-body">{s.summary}</div>}
              </button>
            ))}
          </div>
        </div>

        <div className="dot-canvas">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              color: 'var(--muted)',
            }}
          >
            <span>STAGE {stage.num} · {stage.artifactLabel}</span>
            <span>DETERMINISTIC OUTPUT</span>
          </div>
          <pre className="code-block" style={{ margin: 0 }}>
            {stage.code}
          </pre>
        </div>
      </section>

      <section>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 16,
            marginBottom: 16,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h2 className="section-heading">Reference Test Suite</h2>
            <p className="section-intro" style={{ marginBottom: 0 }}>
              Four benchmark cases ship in the MIT repo. Each runs offline in replay mode or with a
              user-supplied Gemini API key.
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={() => onNavigate('/open-source')}>
            Read Repository Guide
          </button>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>Case</th>
              <th>Domain</th>
              <th>Expected</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {benchmarks.map((item) => (
              <tr key={item.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{item.title}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: 2 }}>
                    {item.summary}
                  </div>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem', color: 'var(--muted)' }}>
                  {item.domain}
                </td>
                <td>
                  <span className={`badge ${item.expectedStatus}`}>{item.expectedStatus}</span>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn-ghost"
                    data-testid={`overview-benchmark-${item.id}`}
                    onClick={() => onLaunchBenchmark(item.id)}
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
};
