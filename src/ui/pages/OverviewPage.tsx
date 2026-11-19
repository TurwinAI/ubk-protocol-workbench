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
  'carnot-feasible-sat': 'Carnot 40% (600K/300K)',
  'carnot-infeasible-unsat': 'Carnot 65% (600K/300K)',
  'nyquist-undersampling-unsat': 'Nyquist 20kHz @ 30kHz',
  'quantum-no-cloning': 'Quantum No-Cloning',
  'unformalized-prose-abstain': 'Unformalized Policy',
};

const HERO_CASE_IDS = [
  'carnot-feasible-sat',
  'carnot-infeasible-unsat',
  'nyquist-undersampling-unsat',
  'unformalized-prose-abstain',
];

const MECHANISM_STAGES = [
  {
    num: '01',
    title: 'Encode Quantitative Bounds',
    summary:
      'The encoder extracts real numeric values and physical laws into QF_LRA or QF_LIA formulas for Z3. Claims without a formal model enter an open region list called Umap.',
    artifactLabel: 'SMT-LIB2 ENCODING (CARNOT QF_LRA)',
    code: `; Carnot Thermal Efficiency Bound (QF_LRA)
; Reservoirs T_hot = 600 K, T_cold = 300 K (limit 50.00%)
(declare-const T_hot Real)
(declare-const T_cold Real)
(declare-const eta_claimed Real)
(declare-const eta_carnot Real)
(assert (= T_hot 600.0))
(assert (= T_cold 300.0))
(assert (= eta_claimed 0.4))
(assert (= (* eta_carnot T_hot) (- T_hot T_cold)))
(assert (<= eta_claimed eta_carnot))
(check-sat)`,
  },
  {
    num: '02',
    title: 'Check Solvers and Structure',
    summary:
      'Each candidate meets recorded structural invariants, quantitative Z3 solving, linear resource-flow checks for quantum states, and open-conjecture flags without LLM self-judging.',
    artifactLabel: 'EPISTEMIC EVIDENCE RECORD',
    code: `{
  "target_rule_set_id": "TURWIN-INV-v4.0-FS",
  "soundness_grade": "FORMAL_SMT",
  "invariant_checks": {
    "Prov": true,
    "TypeOK": true,
    "ASTOK": true,
    "GoalOK": true,
    "CycleFree": true
  },
  "dag_acyclicity": "z3-sat (acyclic)"
}`,
  },
  {
    num: '03',
    title: 'Mint Deterministic Certificate',
    summary:
      'Execution halts inside fixed step and failure limits. The kernel signs one of three outcomes with deterministic SHA-256: Bounded-Verified, Refuted, or Unverified-Within-Bounds.',
    artifactLabel: 'BOUNDED CERTIFICATE OUTPUT',
    code: `{
  "certificate_type": "Bounded-Verified",
  "certificate_version": "2.0",
  "declared_bounds": { "max_paths": 5, "max_steps_per_path": 3 },
  "proof_artifact": { "proof_type": "BoundedVerifiedProof", "pass_count": 1 },
  "determinism_claim": "Identical bounds and input yield identical SHA-256."
}`,
  },
  {
    num: '04',
    title: 'Verify Execution Graph',
    summary:
      'Protocols compile into a schema-checked node graph (CompositeDocAst). Z3 solves integer order constraints across every dependency edge to prove the graph contains no cycles.',
    artifactLabel: 'Z3 DAG ACYCLICITY PROOF',
    code: `=== Z3 SAT DAG Acyclicity Verification ===
Edge constraint: order[node_01] < order[node_02]
Edge constraint: order[node_02] < order[node_03]
SAT - DAG is acyclic
Topological order: node_01 -> node_02 -> node_03`,
  },
];

const BifurcationTrace: React.FC<{ status?: string; running: boolean }> = ({ status, running }) => {
  const isPass = status === 'PASS';
  const isUnverified = status === 'UNVERIFIED' || status === 'UNKNOWN';
  const isImpossible = status === 'IMPOSSIBLE' || status === 'FAIL';

  return (
    <svg
      className="trace-svg"
      viewBox="0 0 360 190"
      role="img"
      aria-label="Kernel decision trace"
    >
      {/* Entry spine: CLAIM -> ENCODE -> GATE */}
      <line x1="16" y1="95" x2="174" y2="95" stroke="var(--cobalt)" strokeWidth="2" />

      {/* Upper branch: PASS / BOUNDED-VERIFIED */}
      <polyline
        points="174,95 224,38 332,38"
        fill="none"
        stroke={isPass ? 'var(--pass-fg)' : 'var(--line)'}
        strokeWidth={isPass ? '2.5' : '1.25'}
      />

      {/* Middle branch: UNVERIFIED / UMAP */}
      <line
        x1="174"
        y1="95"
        x2="332"
        y2="95"
        stroke={isUnverified ? 'var(--warn-fg)' : 'var(--line)'}
        strokeWidth={isUnverified ? '2.5' : '1.25'}
        strokeDasharray="4 4"
      />

      {/* Lower branch: IMPOSSIBLE / REFUTED */}
      <polyline
        points="174,95 224,152 332,152"
        fill="none"
        stroke={isImpossible ? 'var(--signal)' : 'var(--line)'}
        strokeWidth={isImpossible ? '2.5' : '1.25'}
      />

      {/* Nodes */}
      <rect x="12" y="91" width="8" height="8" fill="var(--cobalt)" />
      <rect x="90" y="91" width="8" height="8" fill="var(--cobalt)" />
      <rect x="170" y="91" width="8" height="8" fill={running ? 'var(--amber)' : 'var(--cobalt)'} />

      <rect
        x="328"
        y="34"
        width="8"
        height="8"
        fill={isPass ? 'var(--pass-fg)' : 'var(--bg-recessed)'}
        stroke={isPass ? 'var(--pass-fg)' : 'var(--line-strong)'}
        strokeWidth="1.5"
      />
      <rect
        x="328"
        y="91"
        width="8"
        height="8"
        fill={isUnverified ? 'var(--warn-fg)' : 'var(--bg-recessed)'}
        stroke={isUnverified ? 'var(--warn-fg)' : 'var(--line-strong)'}
        strokeWidth="1.5"
      />
      <rect
        x="328"
        y="148"
        width="8"
        height="8"
        fill={isImpossible ? 'var(--signal)' : 'var(--bg-recessed)'}
        stroke={isImpossible ? 'var(--signal)' : 'var(--line-strong)'}
        strokeWidth="1.5"
      />

      {/* Mono Labels */}
      <text x="12" y="78" fill="var(--muted)" fontFamily="var(--font-mono)" fontSize="9" letterSpacing="0.8">
        CLAIM
      </text>
      <text x="94" y="78" textAnchor="middle" fill="var(--muted)" fontFamily="var(--font-mono)" fontSize="9" letterSpacing="0.8">
        QF_LRA / LIA
      </text>
      <text x="174" y="122" textAnchor="middle" fill="var(--muted)" fontFamily="var(--font-mono)" fontSize="9" letterSpacing="0.8">
        Z3 GATE
      </text>

      <text
        x="336"
        y="24"
        textAnchor="end"
        fill={isPass ? 'var(--pass-fg)' : 'var(--muted)'}
        fontFamily="var(--font-mono)"
        fontSize="9"
        letterSpacing="0.8"
      >
        PASS / BOUNDED-VERIFIED
      </text>
      <text
        x="336"
        y="83"
        textAnchor="end"
        fill={isUnverified ? 'var(--warn-fg)' : 'var(--muted)'}
        fontFamily="var(--font-mono)"
        fontSize="9"
        letterSpacing="0.8"
      >
        UNVERIFIED / UMAP
      </text>
      <text
        x="336"
        y="174"
        textAnchor="end"
        fill={isImpossible ? 'var(--fail-fg)' : 'var(--muted)'}
        fontFamily="var(--font-mono)"
        fontSize="9"
        letterSpacing="0.8"
      >
        IMPOSSIBLE / REFUTED
      </text>
    </svg>
  );
};

export const OverviewPage: React.FC<OverviewPageProps> = ({
  health,
  benchmarks,
  onNavigate,
  onLaunchBenchmark,
}) => {
  const [selectedId, setSelectedId] = useState<string>('carnot-feasible-sat');
  const [claimInput, setClaimInput] = useState<string>(
    'Design a reversible heat engine between a 600 K hot reservoir and a 300 K cold reservoir achieving 40% thermal efficiency'
  );
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
    void runLiveConsole(
      'Design a reversible heat engine between a 600 K hot reservoir and a 300 K cold reservoir achieving 40% thermal efficiency',
      'carnot-feasible-sat'
    );
  }, []);

  const handleSelectCase = (item: BenchmarkItem) => {
    setSelectedId(item.id);
    setClaimInput(item.objective);
    void runLiveConsole(item.objective, item.id);
  };

  const heroCases = benchmarks.filter((b) => HERO_CASE_IDS.includes(b.id));
  const displayedHeroCases = heroCases.length > 0 ? heroCases : benchmarks.slice(0, 4);
  const stage = MECHANISM_STAGES[activeStage];

  return (
    <main className="container">
      <section className="hero-band">
        <div className="section-code">00 / TURWIN LABS · OPEN RESEARCH PROTOTYPE · MIT LICENSE</div>

        <div className="hero-headline-row">
          <h1 className="hero-h1">Formal bounds for generative reasoning.</h1>

          <div className="hero-side">
            <p className="hero-copy">
              Language models draft code and technical plans fast, yet they often propose designs
              that violate physical laws or known mathematical bounds. The Universal Bounds Kernel
              checks concrete numeric claims with Z3 SMT solving and linear resource checks before
              accepting a plan.
            </p>
            <p className="hero-copy">
              When a claim lacks a formal model, the kernel refuses to guess. It returns a signed
              bounded certificate, a disproof witness, or an explicit unverified map called Umap.
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
                className="link-action"
                data-testid="hero-open-research"
                onClick={() => onNavigate('/research')}
              >
                Read Research Note
              </button>
              <a className="link-action" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
                Source on GitHub
              </a>
            </div>
          </div>
        </div>

        <div className="console-instrument" data-testid="hero-console">
          <div className="console-head">
            <span>LIVE KERNEL INSTRUMENT · CHANGE ANY NUMBER TO TEST SOLVER</span>
            <div className="console-head-right">
              <span>{running ? 'SOLVING...' : liveResult ? `${liveResult.timingMs.total} MS` : 'READY'}</span>
              <span>
                {health?.runtime === 'node' ? 'Z3 WASM (NODE)' : 'EXACT ARITHMETIC EDGE + LOCAL Z3'}
              </span>
            </div>
          </div>

          <div className="case-strip">
            {displayedHeroCases.map((item) => (
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

          <div className="console-grid">
            <div className="console-left">
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
                  className="btn-primary btn-primary-sm"
                  data-testid="hero-verify-btn"
                  disabled={running || !claimInput.trim()}
                  onClick={() => void runLiveConsole(claimInput, selectedId || undefined)}
                >
                  {running ? 'Checking' : 'Verify'}
                </button>
              </div>

              {liveError && <div className="error-banner">{liveError}</div>}

              {liveResult && (
                <>
                  <div className="ledger-row">
                    <div className="ledger-cell">
                      <div className="kv-label">Verdict</div>
                      <div className="kv-val">
                        <span className={`badge ${liveResult.ubk.status}`}>
                          {liveResult.ubk.status}
                        </span>
                      </div>
                    </div>
                    <div className="ledger-cell">
                      <div className="kv-label">Certificate</div>
                      <div className="kv-val">{liveResult.ubk.certificate.certificate_type}</div>
                    </div>
                    <div className="ledger-cell">
                      <div className="kv-label">Evidence Tier</div>
                      <div className="kv-val">
                        {liveResult.smtResult.verdict} ({liveResult.smtResult.soundness})
                      </div>
                    </div>
                  </div>

                  <div className="kv-label">Solver Proof Trace</div>
                  <pre className="console-trace">
                    {liveResult.smtResult.proof || liveResult.scientificValidation.reasoning_summary}
                  </pre>

                  <div className="console-foot">
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
                      SHA-256 · {liveResult.ubk.certificate.fingerprint.slice(0, 24)}...
                    </span>
                    <button
                      type="button"
                      className="link-action"
                      style={{ minHeight: 32, fontSize: '0.7rem' }}
                      onClick={() => onLaunchBenchmark(selectedId || 'carnot-feasible-sat')}
                    >
                      Inspect Full Run in Workbench
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="console-right">
              <div className="kv-label" style={{ marginBottom: 8 }}>
                DECISION TRACE · TURWIN-INV-V4.0-FS
              </div>
              <BifurcationTrace status={liveResult?.ubk.status} running={running} />
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.68rem',
                  color: 'var(--muted)',
                  borderTop: '1px solid var(--line)',
                  paddingTop: 10,
                }}
              >
                {liveResult
                  ? `STOP: ${liveResult.ubk.stopReason} · UMAP: ${liveResult.ubk.state.Umap.length} · DAG: ${liveResult.dagVerification?.isAcyclic ? 'ACYCLIC' : 'CHECKED'}`
                  : 'AWAITING EVALUATION'}
              </div>
            </div>
          </div>
        </div>

        <div className="spec-strip">
          <div className="spec-cell">
            <div className="spec-k">Solver Engine</div>
            <div className="spec-v">
              {health?.runtime === 'node' ? 'Z3 WebAssembly (Node)' : 'Exact Edge SMT + Local Z3'}
            </div>
          </div>
          <div className="spec-cell">
            <div className="spec-k">Soundness Policy</div>
            <div className="spec-v">Abstains via Umap on Prose</div>
          </div>
          <div className="spec-cell">
            <div className="spec-k">Reference Suite</div>
            <div className="spec-v">{benchmarks.length || 5} Counterfactual Cases</div>
          </div>
          <div className="spec-cell">
            <div className="spec-k">Distribution</div>
            <div className="spec-v">MIT Open Source</div>
          </div>
        </div>
      </section>

      <section className="section-band">
        <div className="section-code">01 / MECHANISM</div>
        <div className="section-head-split">
          <h2 className="section-heading">Verification Pipeline</h2>
          <p className="section-intro">
            Select a stage to inspect the formal artifacts passed between the language model and
            the verified execution graph.
          </p>
        </div>

        <div className="stepper-grid">
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

          <div className="dot-canvas">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
                paddingBottom: 12,
                borderBottom: '1px solid var(--line)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.7rem',
                letterSpacing: '0.1em',
                color: 'var(--muted)',
              }}
            >
              <span>STAGE {stage.num} · {stage.artifactLabel}</span>
              <span>DETERMINISTIC ARTIFACT</span>
            </div>
            <pre className="code-block" style={{ margin: 0, flex: 1 }}>
              {stage.code}
            </pre>
          </div>
        </div>
      </section>

      <section className="section-band">
        <div className="section-code">02 / BENCHMARKS</div>
        <div className="section-head-split">
          <div>
            <h2 className="section-heading">Reference Test Suite</h2>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
            <p className="section-intro">
              Five counterfactual and abstention cases ship in the MIT repo. Edit any numeric bound
              to test solver sensitivity offline or with a Gemini API key.
            </p>
            <button type="button" className="link-action" onClick={() => onNavigate('/open-source')}>
              Read Repository Guide
            </button>
          </div>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>No.</th>
              <th>Case</th>
              <th>Domain</th>
              <th>Expected</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {benchmarks.map((item, idx) => (
              <tr key={item.id}>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--muted)', width: 52 }}>
                  0{idx + 1}
                </td>
                <td>
                  <div style={{ fontWeight: 500, fontSize: '0.96rem' }}>{item.title}</div>
                  <div style={{ fontSize: '0.84rem', color: 'var(--muted)', marginTop: 4 }}>
                    {item.summary}
                  </div>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
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
                    Open Case
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
