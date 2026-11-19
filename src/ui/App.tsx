import React, { useEffect, useState } from 'react';
import {
  GITHUB_REPO_URL,
  type BenchmarkItem,
  type HealthResponse,
  type RoutePath,
} from './types';
import { OverviewPage } from './pages/OverviewPage';
import { WorkbenchPage } from './pages/WorkbenchPage';
import { ResearchPage } from './pages/ResearchPage';
import { OpenSourcePage } from './pages/OpenSourcePage';

function normalizePath(pathname: string): RoutePath {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/workbench' || clean === '/research' || clean === '/open-source') {
    return clean;
  }
  return '/';
}

const TurwinMark: React.FC = () => (
  <svg
    className="brand-svg"
    viewBox="0 0 24 24"
    width="24"
    height="24"
    preserveAspectRatio="xMidYMid meet"
    shapeRendering="geometricPrecision"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M 18.4556 5.1 L 22 5.1 L 22 2.9 L 17.5444 2.9 L 9.5444 10.9 L 2 10.9 L 2 13.1 L 9.5444 13.1 L 17.5444 21.1 L 21 21.1 L 21 18.9 L 18.4556 18.9 L 11.5556 12 L 18.4556 5.1 Z"
      fill="currentColor"
      fillRule="nonzero"
    />
  </svg>
);

export const App: React.FC = () => {
  const [route, setRoute] = useState<RoutePath>(() => normalizePath(window.location.pathname));
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [benchmarks, setBenchmarks] = useState<BenchmarkItem[]>([]);
  const [launchBenchmarkId, setLaunchBenchmarkId] = useState<string | null>(null);
  const [autoRunTrigger, setAutoRunTrigger] = useState<number>(0);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    const onPopState = () => {
      setRoute(normalizePath(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/health').then((r) => r.json()),
      fetch('/api/benchmarks').then((r) => r.json()),
    ])
      .then(([healthData, benchData]) => {
        if (!active) return;
        setHealth(healthData as HealthResponse);
        setBenchmarks((benchData?.benchmarks || []) as BenchmarkItem[]);
      })
      .catch(() => {
        if (!active) return;
        setHealth(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const navigate = (next: RoutePath) => {
    if (window.location.pathname !== next) {
      window.history.pushState({}, '', next);
    }
    setRoute(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLaunchBenchmark = (benchmarkId: string) => {
    setLaunchBenchmarkId(benchmarkId);
    setAutoRunTrigger((n) => n + 1);
    navigate('/workbench');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="topbar">
        <div className="topbar-inner">
          <button type="button" className="brand-btn" onClick={() => navigate('/')}>
            <TurwinMark />
            <span className="brand-wordmark">TURWIN LABS</span>
            <span className="brand-sep">/</span>
            <span className="brand-domain">UBK</span>
          </button>

          <nav className="nav-links" aria-label="Primary navigation">
            <button
              type="button"
              data-testid="nav-overview"
              className={`nav-link ${route === '/' ? 'active' : ''}`}
              onClick={() => navigate('/')}
            >
              Overview
            </button>
            <button
              type="button"
              data-testid="nav-workbench"
              className={`nav-link ${route === '/workbench' ? 'active' : ''}`}
              onClick={() => navigate('/workbench')}
            >
              Workbench
            </button>
            <button
              type="button"
              data-testid="nav-research"
              className={`nav-link ${route === '/research' ? 'active' : ''}`}
              onClick={() => navigate('/research')}
            >
              Research
            </button>
            <button
              type="button"
              data-testid="nav-open-source"
              className={`nav-link ${route === '/open-source' ? 'active' : ''}`}
              onClick={() => navigate('/open-source')}
            >
              Repository
            </button>
          </nav>

          <div className="topbar-actions">
            <span className="status-inline" data-testid="overview-health">
              <span className={`dot ${health?.ok ? 'ok' : ''}`} />
              {health?.ok
                ? health.runtime === 'node'
                  ? 'ONLINE · Z3'
                  : 'ONLINE · EDGE'
                : 'CONNECTING'}
            </span>
            <button
              type="button"
              className="topbar-util"
              aria-label="Toggle color theme"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? 'Paper' : 'Ink'}
            </button>
            <a className="topbar-util" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <button type="button" className="topbar-cta" onClick={() => navigate('/workbench')}>
              Workbench
            </button>
          </div>
        </div>
      </header>

      <div style={{ flex: 1 }}>
        {route === '/' && (
          <OverviewPage
            health={health}
            benchmarks={benchmarks}
            onNavigate={navigate}
            onLaunchBenchmark={handleLaunchBenchmark}
          />
        )}
        {route === '/workbench' && (
          <WorkbenchPage
            health={health}
            benchmarks={benchmarks}
            initialBenchmarkId={launchBenchmarkId}
            autoRunTrigger={autoRunTrigger}
          />
        )}
        {route === '/research' && <ResearchPage onNavigate={navigate} />}
        {route === '/open-source' && <OpenSourcePage onNavigate={navigate} />}
      </div>

      <footer className="footer">
        <div className="footer-inner">
          <div>TURWIN LABS · UNIVERSAL BOUNDS KERNEL · MIT LICENSE</div>
          <div className="footer-links">
            <button type="button" className="footer-link" onClick={() => navigate('/research')}>
              Research Note
            </button>
            <button type="button" className="footer-link" onClick={() => navigate('/open-source')}>
              Repository
            </button>
            <a className="footer-link" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
              github.com/TurwinAI/ubk-protocol-workbench
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};
