import React, { useEffect, useState } from 'react';
import type { BenchmarkItem, HealthResponse, RunResult } from '../types';

interface WorkbenchPageProps {
  health: HealthResponse | null;
  benchmarks: BenchmarkItem[];
  initialBenchmarkId?: string | null;
  autoRunTrigger?: number;
}

type ResultTab = 'verdict' | 'constraints' | 'dag' | 'trace';

export const WorkbenchPage: React.FC<WorkbenchPageProps> = ({
  health,
  benchmarks,
  initialBenchmarkId,
  autoRunTrigger = 0,
}) => {
  const [selectedBenchmarkId, setSelectedBenchmarkId] = useState<string>('');
  const [objective, setObjective] = useState<string>('');
  const [protocolMarkdown, setProtocolMarkdown] = useState<string>('');
  const [mode, setMode] = useState<'replay' | 'live'>('replay');
  const [apiKey, setApiKey] = useState<string>('');
  const [running, setRunning] = useState<boolean>(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [activeTab, setActiveTab] = useState<ResultTab>('verdict');

  const executeRun = async (params: {
    obj: string;
    proto: string;
    runMode: 'replay' | 'live';
    benchId?: string;
    key?: string;
  }) => {
    if (!params.obj.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/protocol/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: params.obj,
          protocolMarkdown: params.proto,
          mode: params.runMode,
          benchmarkId: params.benchId || undefined,
          ...(params.runMode === 'live' && params.key?.trim() ? { apiKey: params.key.trim() } : {}),
        }),
      });

      const data = await response.json();
      if (!response.ok || !data?.ok) {
        setError({
          code: data?.code || `HTTP_${response.status}`,
          message: data?.error || `Verification request failed (HTTP ${response.status})`,
        });
        return;
      }

      setResult(data as RunResult);
      setActiveTab('verdict');
    } catch (err) {
      setError({
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (benchmarks.length === 0) return;
    const target =
      (initialBenchmarkId ? benchmarks.find((b) => b.id === initialBenchmarkId) : null) ||
      benchmarks[0];

    if (!selectedBenchmarkId || (initialBenchmarkId && selectedBenchmarkId !== initialBenchmarkId)) {
      setSelectedBenchmarkId(target.id);
      setObjective(target.objective);
      setProtocolMarkdown(target.protocolMarkdown);
    }
  }, [benchmarks, initialBenchmarkId]);

  useEffect(() => {
    if (autoRunTrigger <= 0 || !initialBenchmarkId || benchmarks.length === 0) return;
    const target = benchmarks.find((b) => b.id === initialBenchmarkId);
    if (!target) return;
    setSelectedBenchmarkId(target.id);
    setObjective(target.objective);
    setProtocolMarkdown(target.protocolMarkdown);
    setMode('replay');
    void executeRun({
      obj: target.objective,
      proto: target.protocolMarkdown,
      runMode: 'replay',
      benchId: target.id,
    });
  }, [autoRunTrigger, initialBenchmarkId, benchmarks]);

  const selectBenchmark = (item: BenchmarkItem) => {
    setSelectedBenchmarkId(item.id);
    setObjective(item.objective);
    setProtocolMarkdown(item.protocolMarkdown);
    setError(null);
  };

  const handleRun = () => {
    void executeRun({
      obj: objective,
      proto: protocolMarkdown,
      runMode: mode,
      benchId: selectedBenchmarkId || undefined,
      key: apiKey,
    });
  };

  const exportJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.runId}-verification-packet.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="container">
      <div className="wb-header">
        <div>
          <h1 className="section-title" style={{ fontSize: '2rem' }}>
            Verification &amp; Protocol Workbench
          </h1>
          <p className="section-sub">
            Run deterministic formal proofs against the Universal Bounds Kernel, inspect SMT-LIB2
            encodings, or test live synthesis with your own Gemini API key.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <span className={`pill ${health?.ok ? 'ok' : ''}`} data-testid="health-status">
            {health?.ok ? 'API: ONLINE' : 'API: CONNECTING'}
          </span>
          <span className={`pill ${health?.z3Enabled ? 'ok' : ''}`}>
            {health?.runtime === 'node'
              ? 'SOLVER: Z3 WASM (NODE)'
              : 'SOLVER: EDGE SMT + AXIOM KERNEL'}
          </span>
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert" data-testid="error-banner">
          <strong>{error.code || 'ERROR'}:</strong> {error.message}
        </div>
      )}

      <div className="wb-grid">
        <section className="card">
          <h3 style={{ marginBottom: 12 }}>1. Curated Research Benchmarks</h3>

          <div className="benchmark-list">
            {benchmarks.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid={`benchmark-${item.id}`}
                className={`benchmark-btn ${selectedBenchmarkId === item.id ? 'active' : ''}`}
                onClick={() => selectBenchmark(item)}
              >
                <div className="benchmark-top">
                  <span>{item.title}</span>
                  <span className={`badge ${item.expectedStatus}`}>{item.expectedStatus}</span>
                </div>
                <div className="benchmark-meta">{item.domain}</div>
              </button>
            ))}
          </div>

          <div className="label-caps">2. Execution Mode</div>
          <div className="mode-row">
            <button
              type="button"
              data-testid="mode-replay"
              className={`mode-btn ${mode === 'replay' ? 'active' : ''}`}
              onClick={() => {
                setMode('replay');
                setError(null);
              }}
            >
              Replay (Zero-Key + Formal)
            </button>
            <button
              type="button"
              data-testid="mode-live"
              className={`mode-btn ${mode === 'live' ? 'active' : ''}`}
              onClick={() => {
                setMode('live');
                setError(null);
              }}
            >
              Live BYOK (Gemini)
            </button>
          </div>

          {mode === 'live' && (
            <div className="field">
              <label htmlFor="apiKeyInput">
                Gemini API Key (sent only for this request; never stored)
              </label>
              <input
                id="apiKeyInput"
                data-testid="api-key-input"
                type="password"
                placeholder="Enter GEMINI_API_KEY or leave blank to verify fail-loudly behavior"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="objectiveInput">Research Objective / Claim</label>
            <input
              id="objectiveInput"
              data-testid="objective-input"
              type="text"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="protocolInput">Structured Protocol (Markdown)</label>
            <textarea
              id="protocolInput"
              data-testid="protocol-input"
              rows={8}
              value={protocolMarkdown}
              onChange={(e) => setProtocolMarkdown(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="run-btn"
            data-testid="run-button"
            disabled={running || !objective.trim()}
            onClick={handleRun}
          >
            {running ? 'Running Formal Verification...' : 'Run Formal Verification & Protocol'}
          </button>
        </section>

        <section className="card">
          {!result ? (
            <div style={{ textAlign: 'center', padding: '56px 20px', color: 'var(--muted)' }} data-testid="empty-state">
              <p style={{ fontSize: '0.98rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                Select any benchmark on the left or write your own claim, then click{' '}
                <strong>Run Formal Verification &amp; Protocol</strong>.
              </p>
              <p style={{ fontSize: '0.86rem' }}>
                Every run produces a cryptographically fingerprinted <code>BoundedCertificate</code>,
                formal SMT-LIB2 constraints, a CompositeDoc AST execution plan, and a step-by-step
                kernel trace.
              </p>
            </div>
          ) : (
            <div data-testid="result-panel">
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  paddingBottom: 14,
                  borderBottom: '1px solid var(--border)',
                  marginBottom: 14,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={`badge ${result.ubk.status}`} data-testid="verdict-badge">
                    {result.ubk.status}
                  </span>
                  <span className="pill" data-testid="certificate-type">
                    {result.ubk.certificate.certificate_type}
                  </span>
                  <span className="pill">
                    {result.mode.toUpperCase()} · {result.timingMs.total}ms
                  </span>
                </div>
                <button type="button" className="icon-btn" onClick={exportJson}>
                  Export JSON Packet
                </button>
              </div>

              <div className="tabs">
                <button
                  type="button"
                  className={`tab-btn ${activeTab === 'verdict' ? 'active' : ''}`}
                  onClick={() => setActiveTab('verdict')}
                >
                  Verdict &amp; Certificate
                </button>
                <button
                  type="button"
                  className={`tab-btn ${activeTab === 'constraints' ? 'active' : ''}`}
                  onClick={() => setActiveTab('constraints')}
                >
                  Constraint IR ({result.ubk.state.Cir.constraints.length})
                </button>
                <button
                  type="button"
                  className={`tab-btn ${activeTab === 'dag' ? 'active' : ''}`}
                  onClick={() => setActiveTab('dag')}
                >
                  AST Plan &amp; Artifacts ({result.artifacts.length})
                </button>
                <button
                  type="button"
                  className={`tab-btn ${activeTab === 'trace' ? 'active' : ''}`}
                  onClick={() => setActiveTab('trace')}
                >
                  Kernel Trace ({result.ubk.traceLog.length})
                </button>
              </div>

              {activeTab === 'verdict' && (
                <div>
                  <div className="kv-grid">
                    <div className="kv">
                      <div className="kv-label">SMT Verdict</div>
                      <div className="kv-val" data-testid="smt-verdict">
                        {result.smtResult.verdict} ({result.smtResult.soundness})
                      </div>
                    </div>
                    <div className="kv">
                      <div className="kv-label">Axiom Classification</div>
                      <div className="kv-val">{result.scientificValidation.classification}</div>
                    </div>
                    <div className="kv">
                      <div className="kv-label">Stop Reason</div>
                      <div className="kv-val">{result.ubk.stopReason}</div>
                    </div>
                    <div className="kv">
                      <div className="kv-label">Certificate Fingerprint</div>
                      <div className="kv-val">{result.ubk.certificate.fingerprint.slice(0, 16)}...</div>
                    </div>
                  </div>

                  <div className="label-caps">SMT Proof / Solver Evaluation</div>
                  <pre className="code-block" data-testid="smt-proof">
                    {result.smtResult.proof || 'No proof trace emitted.'}
                  </pre>

                  <div className="label-caps">12-Domain Scientific Axiom Validation</div>
                  <pre className="code-block">
                    {result.scientificValidation.reasoning_summary}
                  </pre>

                  {result.ubk.artifactBundle.impossibilityCertificates.length > 0 && (
                    <>
                      <div className="label-caps">Impossibility Certificates (ImpCert)</div>
                      {result.ubk.artifactBundle.impossibilityCertificates.map((cert, i) => (
                        <div className="artifact-card" key={i} data-testid="imp-cert-card">
                          <div><strong>Reason:</strong> {cert.reason}</div>
                          <div><strong>Boundary:</strong> <code>{cert.boundary}</code></div>
                          <div><strong>Logic:</strong> <code>{cert.logic}</code></div>
                        </div>
                      ))}
                    </>
                  )}

                  {result.ubk.artifactBundle.witnesses.length > 0 && (
                    <>
                      <div className="label-caps">Counterexample Witnesses</div>
                      {result.ubk.artifactBundle.witnesses.map((w, i) => (
                        <div className="artifact-card" key={i}>
                          <div><strong>Constraint:</strong> <code>{w.constraintViolated}</code></div>
                          <div>{w.counterExample}</div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}

              {activeTab === 'constraints' && (
                <div>
                  {result.ubk.state.Cir.constraints.length === 0 ? (
                    <p style={{ color: 'var(--muted)' }}>
                      No formalizable SMT constraints extracted for this objective; check Umap below.
                    </p>
                  ) : (
                    result.ubk.state.Cir.constraints.map((c) => (
                      <div className="artifact-card" key={c.id}>
                        <div>
                          <strong>{c.id}</strong> · <span>{c.domain}</span> · confidence{' '}
                          {c.confidence.toFixed(2)}
                        </div>
                        <div style={{ fontSize: '0.86rem', marginTop: 4 }}>{c.expression}</div>
                        {c.smtlib && <pre className="code-block">{c.smtlib.trim()}</pre>}
                      </div>
                    ))
                  )}

                  {result.ubk.state.Umap.length > 0 && (
                    <>
                      <div className="label-caps">Explicit Unknown Regions (Umap)</div>
                      {result.ubk.state.Umap.map((u, i) => (
                        <div className="artifact-card" key={i}>
                          <strong>{u.code}</strong>: {u.reason}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}

              {activeTab === 'dag' && (
                <div>
                  <div className="label-caps">Planned Execution DAG ({result.plan.nodes.length} nodes)</div>
                  {result.plan.nodes.map((node) => (
                    <div className="artifact-card" key={node.id}>
                      <div>
                        <strong>{node.id}</strong> — {node.name}{' '}
                        <span className="pill">{node.modality}</span>
                      </div>
                      <div style={{ fontSize: '0.84rem', color: 'var(--muted)', marginTop: 4 }}>
                        {node.description}
                      </div>
                    </div>
                  ))}

                  <div className="label-caps">Generated Artifacts</div>
                  {result.artifacts.map((art, i) => (
                    <div className="artifact-card" key={art.id || i}>
                      <div>
                        <strong>{art.title || art.id || `Artifact ${i + 1}`}</strong>{' '}
                        <span className="pill">{art.type}</span>
                      </div>
                      <pre className="code-block">{art.content}</pre>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'trace' && (
                <div>
                  <div className="label-caps">Turwin v4.0-FS Kernel Trace</div>
                  <pre className="code-block">{result.ubk.traceLog.join('\n')}</pre>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
};
