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
  const [maxIterations, setMaxIterations] = useState<number>(3);
  const [smtTimeoutMs, setSmtTimeoutMs] = useState<number>(2500);
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
    iterations?: number;
    timeout?: number;
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
          maxIterations: params.iterations ?? maxIterations,
          smtTimeoutMs: params.timeout ?? smtTimeoutMs,
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
      iterations: maxIterations,
      timeout: smtTimeoutMs,
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
    <main className="wb-shell">
      <div className="wb-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 500, fontSize: '0.96rem', letterSpacing: '-0.01em' }}>
            UBK Verification Workbench
          </span>
          <span
            className="status-inline"
            style={{ display: 'inline-flex', color: 'var(--text-secondary)' }}
            data-testid="health-status"
          >
            <span className={`dot ${health?.ok ? 'ok' : ''}`} />
            {health?.ok ? 'API: ONLINE' : 'API: CONNECTING'}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
            {health?.runtime === 'node' ? 'Z3 WASM (NODE.JS)' : 'EDGE SMT + 12 AXIOM DOMAINS'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="mode-group" role="group" aria-label="Execution mode">
            <button
              type="button"
              data-testid="mode-replay"
              className={`mode-btn ${mode === 'replay' ? 'active' : ''}`}
              onClick={() => {
                setMode('replay');
                setError(null);
              }}
            >
              Replay
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
              Live BYOK
            </button>
          </div>
          <button
            type="button"
            className="btn-primary btn-primary-sm"
            data-testid="run-button"
            disabled={running || !objective.trim()}
            onClick={handleRun}
          >
            {running ? 'Running Kernel...' : 'Run Verification'}
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert" data-testid="error-banner">
          <strong>{error.code || 'ERROR'}:</strong> {error.message}
        </div>
      )}

      <div className="wb-layout">
        <aside className="wb-rail">
          <div className="rail-section">
            <div className="rail-heading">Reference Cases</div>
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
          </div>

          <div className="rail-section">
            <div className="rail-heading">Kernel Resource Bounds</div>
            <div className="slider-row">
              <div className="slider-label">
                <span>Max Iterations (I_max)</span>
                <span>{maxIterations}</span>
              </div>
              <input
                type="range"
                min={1}
                max={8}
                step={1}
                aria-label="Max iterations"
                value={maxIterations}
                onChange={(e) => setMaxIterations(Number(e.target.value))}
              />
            </div>
            <div className="slider-row">
              <div className="slider-label">
                <span>SMT Timeout</span>
                <span>{smtTimeoutMs} ms</span>
              </div>
              <input
                type="range"
                min={500}
                max={5000}
                step={250}
                aria-label="SMT timeout milliseconds"
                value={smtTimeoutMs}
                onChange={(e) => setSmtTimeoutMs(Number(e.target.value))}
              />
            </div>
          </div>

          {mode === 'live' && (
            <div className="rail-section">
              <div className="rail-heading">Live BYOK Key</div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="apiKeyInput">Gemini API Key (per request)</label>
                <input
                  id="apiKeyInput"
                  data-testid="api-key-input"
                  type="password"
                  placeholder="Optional if set in server .env"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
            </div>
          )}
        </aside>

        <div className="wb-main">
          <section className="wb-editor-band">
            <div className="field">
              <label htmlFor="objectiveInput">Objective / Formal Claim</label>
              <input
                id="objectiveInput"
                data-testid="objective-input"
                type="text"
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
              />
            </div>

            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="protocolInput">Protocol Specification (Markdown)</label>
              <textarea
                id="protocolInput"
                data-testid="protocol-input"
                rows={6}
                value={protocolMarkdown}
                onChange={(e) => setProtocolMarkdown(e.target.value)}
              />
            </div>
          </section>

          <section className="wb-result-band">
            {!result ? (
              <div
                style={{ padding: '48px 0', color: 'var(--muted)' }}
                data-testid="empty-state"
              >
                <p style={{ margin: '0 0 6px', color: 'var(--text-secondary)', fontSize: '0.96rem' }}>
                  Select a reference case or edit the specification, then select Run Verification.
                </p>
                <p style={{ margin: 0, fontSize: '0.84rem', fontFamily: 'var(--font-mono)' }}>
                  REPLAY MODE EXECUTES OFFLINE WITH DETERMINISTIC CANDIDATES AND FORMAL CHECKS.
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
                    gap: 12,
                    marginBottom: 16,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span className={`badge ${result.ubk.status}`} data-testid="verdict-badge">
                      {result.ubk.status}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.76rem',
                        color: 'var(--text)',
                      }}
                      data-testid="certificate-type"
                    >
                      {result.ubk.certificate.certificate_type}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
                      {result.mode.toUpperCase()} · {result.timingMs.total} MS
                    </span>
                  </div>
                  <button type="button" className="btn-ghost" onClick={exportJson}>
                    Export JSON
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
                    SMT-LIB2 ({result.ubk.state.Cir.constraints.length})
                  </button>
                  <button
                    type="button"
                    className={`tab-btn ${activeTab === 'dag' ? 'active' : ''}`}
                    onClick={() => setActiveTab('dag')}
                  >
                    Execution Graph ({result.plan.nodes.length})
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
                        <div className="kv-label">Axiom Check</div>
                        <div className="kv-val">{result.scientificValidation.classification}</div>
                      </div>
                      <div className="kv">
                        <div className="kv-label">Stop Reason</div>
                        <div className="kv-val">{result.ubk.stopReason}</div>
                      </div>
                      <div className="kv">
                        <div className="kv-label">Fingerprint</div>
                        <div className="kv-val">{result.ubk.certificate.fingerprint.slice(0, 16)}...</div>
                      </div>
                    </div>

                    <div className="label-caps">SMT Proof Evaluation</div>
                    <pre className="code-block" data-testid="smt-proof">
                      {result.smtResult.proof || 'No proof string returned.'}
                    </pre>

                    <div className="label-caps">Scientific Axiom Summary</div>
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
                      <p style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>
                        No formalizable SMT constraints extracted. Inspect Umap below.
                      </p>
                    ) : (
                      result.ubk.state.Cir.constraints.map((c) => (
                        <div className="artifact-card" key={c.id}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                            <strong>{c.id}</strong> · {c.domain} · confidence {c.confidence.toFixed(2)}
                          </div>
                          <div style={{ fontSize: '0.86rem', marginTop: 4 }}>{c.expression}</div>
                          {c.smtlib && <pre className="code-block" style={{ marginTop: 10 }}>{c.smtlib.trim()}</pre>}
                        </div>
                      ))
                    )}

                    {result.ubk.state.Umap.length > 0 && (
                      <>
                        <div className="label-caps">Unknown Region Map (Umap)</div>
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
                    <div className="dot-canvas" style={{ marginBottom: 20, border: '1px solid var(--line)' }}>
                      <div className="dag-flow">
                        {result.plan.nodes.map((node, idx) => (
                          <React.Fragment key={node.id}>
                            <div className="dag-node">
                              <div className="dag-node-top">
                                <strong>{node.id} · {node.name}</strong>
                                <span style={{ color: 'var(--muted)' }}>{node.modality}</span>
                              </div>
                              <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                                {node.description}
                              </div>
                            </div>
                            {idx < result.plan.nodes.length - 1 && <div className="dag-connector" />}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>

                    <div className="label-caps">Emitted Artifacts ({result.artifacts.length})</div>
                    {result.artifacts.map((art, i) => (
                      <div className="artifact-card" key={art.id || i}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', marginBottom: 8 }}>
                          <strong>{art.title || art.id || `Artifact ${i + 1}`}</strong> · {art.type}
                        </div>
                        <pre className="code-block" style={{ marginBottom: 0 }}>{art.content}</pre>
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === 'trace' && (
                  <div>
                    <div className="label-caps">Turwin v4.0-FS Kernel Log</div>
                    <pre className="code-block" style={{ marginBottom: 0 }}>
                      {result.ubk.traceLog.join('\n')}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
};
