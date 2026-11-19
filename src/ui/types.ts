export type RoutePath = '/' | '/workbench' | '/research' | '/open-source';

export interface BenchmarkItem {
  id: string;
  title: string;
  domain: string;
  expectedStatus: 'PASS' | 'IMPOSSIBLE';
  summary: string;
  objective: string;
  protocolMarkdown: string;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  runtime: 'node' | 'cloudflare-workers';
  solverEngine?: string;
  z3Enabled: boolean;
  defaultMode: 'replay' | 'live';
  hasServerGeminiKey: boolean;
  benchmarkCount?: number;
}

export interface RunResult {
  ok: true;
  runId: string;
  mode: 'replay' | 'live';
  objective: string;
  smtResult: {
    verdict: string;
    soundness: string;
    timeMs: number;
    proof?: string;
    domain?: string;
  };
  scientificValidation: {
    classification: string;
    reasoning_summary: string;
    domain?: string;
  };
  ubk: {
    status: 'PASS' | 'FAIL' | 'IMPOSSIBLE' | 'UNKNOWN';
    runStatus: string;
    stopReason: string;
    traceLog: string[];
    state: {
      Cir: {
        objective: string;
        domains: string[];
        constraints: Array<{
          id: string;
          domain: string;
          expression: string;
          formalTarget: string;
          confidence: number;
          smtlib?: string;
        }>;
      };
      Umap: Array<{ code: string; reason: string }>;
    };
    artifactBundle: {
      impossibilityCertificates: Array<{
        type: string;
        reason?: string;
        boundary?: string;
        logic?: string;
      }>;
      witnesses: Array<{
        type: string;
        counterExample?: string;
        constraintViolated?: string;
      }>;
    };
    certificate: {
      certificate_type: string;
      certificate_version: string;
      target_rule_set_id: string;
      fingerprint: string;
      verification_ledger: Array<{
        path_id: string;
        status: string;
        reason_code: string;
        invariant_checks: Record<string, boolean>;
      }>;
      compute_accounting: {
        compute_units_consumed: number;
        enumeration_count: number;
        validation_count: number;
      };
    };
  };
  plan: {
    id: string;
    title: string;
    nodes: Array<{
      id: string;
      name: string;
      modality: string;
      outputType?: string;
      description: string;
    }>;
  };
  artifacts: Array<{
    id?: string;
    type: string;
    title?: string;
    content: string;
  }>;
  timingMs: {
    total: number;
    smt: number;
    kernel: number;
    execution: number;
  };
}

export const GITHUB_REPO_URL = 'https://github.com/TurwinAI/ubk-protocol-workbench';
export const SITE_URL = 'https://turwinlabs.org';
