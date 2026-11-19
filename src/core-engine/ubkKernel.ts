import { constraintEncoder, type ConstraintDomain, type EncodedConstraint } from './constraintEncoder';
import {
  executeTurwinKernel,
  type ArtifactRegistry,
  type BoundedCertificate,
  type CanonicalStateBlock,
  type ExecutionStatus,
  type StopReason,
  type TurwinConfig,
  type VerifiedArtifact,
} from './turwinKernel';

export type UBKTerminationStatus = 'PASS' | 'FAIL' | 'IMPOSSIBLE' | 'UNKNOWN';
export type UBKRunStatus = 'SUCCESS' | 'PARTIAL' | 'EXHAUSTED';
export type UBKConstraintHardness = 'HARD' | 'SOFT';
export type UBKConstraintSource = 'DETERMINISTIC' | 'SEMANTIC_FALLBACK';
export type UBKFormalTarget = 'SMT_LIB' | 'ATP' | 'SIMULATION' | 'RULE_ENGINE' | 'UNKNOWN';
export type UBKRuntime = 'node' | 'browser';

export interface UBKConstraint {
  id: string;
  domain: ConstraintDomain;
  expression: string;
  formalTarget: UBKFormalTarget;
  hardness: UBKConstraintHardness;
  source: UBKConstraintSource;
  confidence: number;
  smtlib?: string;
  variables: string[];
}

export interface UBKConstraintIR {
  objective: string;
  constraints: UBKConstraint[];
  domains: ConstraintDomain[];
}

export interface UBKUnknownRegion {
  code: string;
  reason: string;
  relatedConstraintId?: string;
}

export interface UBKResourceLimits {
  timeLimitMs: number;
  memoryLimitMB: number;
  maxIterations: number;
  maxPaths: number;
  maxFail: number;
}

export interface UBKResourceBudget {
  startedAtMs: number;
  elapsedMs: number;
  remainingTimeMs: number;
  memoryLimitMB: number;
  maxIterations: number;
  maxPaths: number;
  maxFail: number;
}

export interface UBKStateVector {
  Cir: UBKConstraintIR;
  Plog: string[];
  Rreg: ArtifactRegistry;
  Brem: UBKResourceBudget;
  Umap: UBKUnknownRegion[];
}

export interface UBKNoveltyPolicy {
  enabled: boolean;
  minScore: number;
  maxSimilarity: number;
  minContentLength: number;
  compareLimit: number;
  gateStage: 'pre-verify' | 'post-verify';
}

export interface UBKSMTPolicy {
  useFullSolver: boolean;
  timeoutMs: number;
}

export interface UBKConfig {
  resourceLimits: UBKResourceLimits;
  noveltyPolicy: UBKNoveltyPolicy;
  smt: UBKSMTPolicy;
}

export interface UBKExecutionInput {
  objective: string;
  generator: (ctx: string, csb: CanonicalStateBlock) => Promise<string>;
  userInput?: string;
  seedRegistry?: VerifiedArtifact[];
}

export interface UBKArtifactBundle {
  registry: VerifiedArtifact[];
  impossibilityCertificates: VerifiedArtifact[];
  witnesses: VerifiedArtifact[];
}

export interface UBKExecutionResult {
  status: UBKTerminationStatus;
  runStatus: UBKRunStatus;
  state: UBKStateVector;
  artifactBundle: UBKArtifactBundle;
  certificate: BoundedCertificate;
  traceLog: string[];
  kernelStatus: ExecutionStatus;
  stopReason: StopReason;
}

export interface UBKIntegrationPoint {
  id: string;
  modulePath: string;
  symbol: string;
  role: string;
}

export interface UBKDependencies {
  encodeConstraints: (goalText: string) => Promise<EncodedConstraint[]>;
  executeKernel: (
    input: string,
    goal: string,
    generator: (ctx: string, csb: CanonicalStateBlock) => Promise<string>,
    config: TurwinConfig,
    seedRegistry: VerifiedArtifact[],
  ) => Promise<{
    output: string;
    witnessOutput: string;
    registry: ArtifactRegistry;
    status: ExecutionStatus;
    stopReason: StopReason;
    traceLog: string[];
    certificate: BoundedCertificate;
  }>;
  detectRuntime: () => UBKRuntime;
  now: () => number;
}

const DEFAULT_RESOURCE_LIMITS: UBKResourceLimits = {
  timeLimitMs: 300_000,
  memoryLimitMB: 2_048,
  maxIterations: 10,
  maxPaths: 100,
  maxFail: 3,
};

const DEFAULT_NOVELTY_POLICY: UBKNoveltyPolicy = {
  enabled: true,
  minScore: 0.35,
  maxSimilarity: 0.85,
  minContentLength: 120,
  compareLimit: 200,
  gateStage: 'pre-verify',
};

const DEFAULT_SMT_POLICY: UBKSMTPolicy = {
  useFullSolver: true,
  timeoutMs: 500,
};

const DEFAULT_CONFIG: UBKConfig = {
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
  noveltyPolicy: DEFAULT_NOVELTY_POLICY,
  smt: DEFAULT_SMT_POLICY,
};

const DEFAULT_DEPENDENCIES: UBKDependencies = {
  encodeConstraints: (goalText: string): Promise<EncodedConstraint[]> => constraintEncoder.extractAll(goalText),
  executeKernel: executeTurwinKernel,
  detectRuntime: (): UBKRuntime => {
    const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
    return isBrowser ? 'browser' : 'node';
  },
  now: (): number => Date.now(),
};

export const UBK_TURWIN_INTEGRATION_POINTS: readonly UBKIntegrationPoint[] = [
  {
    id: 'constraint_formalization',
    modulePath: 'src/core-engine/constraintEncoder.ts',
    symbol: 'constraintEncoder.extractAll',
    role: 'Objective to formal constraints (UIR backbone)',
  },
  {
    id: 'kernel_execution',
    modulePath: 'src/core-engine/turwinKernel.ts',
    symbol: 'executeTurwinKernel',
    role: 'Bounded search and certificate generation',
  },
  {
    id: 'smt_routing',
    modulePath: 'src/core-engine/turwinKernel.ts',
    symbol: 'TurwinConfig.smt',
    role: 'Controls full SMT solver and timeout policy',
  },
  {
    id: 'novelty_gate',
    modulePath: 'src/core-engine/turwinKernel.ts',
    symbol: 'TurwinConfig.noveltyGate',
    role: 'Semantic novelty gating to prevent vertical collapse',
  },
  {
    id: 'bounded_certificate',
    modulePath: 'src/core-engine/turwinKernel.ts',
    symbol: 'BoundedCertificate',
    role: 'Deterministic audit artifact for replay and governance',
  },
] as const;

export interface UBKExecutionOptions {
  config?: Partial<UBKConfig>;
  dependencies?: Partial<UBKDependencies>;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function toFormalTarget(domain: ConstraintDomain): UBKFormalTarget {
  if (domain === 'BIOLOGY') {
    return 'RULE_ENGINE';
  }
  return 'SMT_LIB';
}

function buildConstraintId(encoded: EncodedConstraint, index: number): string {
  const base = encoded.formula.sourcePattern || encoded.formula.domain || 'constraint';
  return `ubk-${base.toLowerCase()}-${index + 1}`;
}

function toUBKConstraint(encoded: EncodedConstraint, index: number): UBKConstraint {
  return {
    id: buildConstraintId(encoded, index),
    domain: encoded.formula.domain,
    expression: encoded.formula.description,
    formalTarget: toFormalTarget(encoded.formula.domain),
    hardness: 'HARD',
    source: encoded.confidence < 0.6 ? 'SEMANTIC_FALLBACK' : 'DETERMINISTIC',
    confidence: clampScore(encoded.confidence),
    smtlib: encoded.formula.smtlib,
    variables: encoded.formula.variables,
  };
}

function deriveUnknownRegions(constraints: UBKConstraint[], runtime: UBKRuntime, useFullSolver: boolean): UBKUnknownRegion[] {
  const unknowns: UBKUnknownRegion[] = [];
  if (constraints.length === 0) {
    unknowns.push({
      code: 'OBJECTIVE_UNFORMALIZED',
      reason: 'No formalizable constraints were extracted from the objective.',
    });
  }

  for (const constraint of constraints) {
    if (!constraint.smtlib || constraint.smtlib.trim().length === 0) {
      unknowns.push({
        code: 'MISSING_FORMAL_EXPRESSION',
        reason: `Constraint "${constraint.id}" has no executable SMT expression.`,
        relatedConstraintId: constraint.id,
      });
    }
    if (constraint.source === 'SEMANTIC_FALLBACK') {
      unknowns.push({
        code: 'SEMANTIC_FALLBACK_ENCODING',
        reason: `Constraint "${constraint.id}" depends on non-deterministic semantic extraction.`,
        relatedConstraintId: constraint.id,
      });
    }
  }

  if (runtime === 'browser' && useFullSolver) {
    unknowns.push({
      code: 'SMT_RUNTIME_DEGRADED',
      reason: 'Full SMT solving is unavailable in browser runtime.',
    });
  }
  return unknowns;
}

function toTurwinConfig(config: UBKConfig): TurwinConfig {
  return {
    tau: 0.5,
    kappa: config.resourceLimits.maxPaths,
    maxFail: config.resourceLimits.maxFail,
    maxSteps: config.resourceLimits.maxIterations,
    maxPaths: config.resourceLimits.maxPaths,
    noveltyGate: config.noveltyPolicy.enabled
      ? {
          minScore: config.noveltyPolicy.minScore,
          maxSimilarity: config.noveltyPolicy.maxSimilarity,
          minContentLength: config.noveltyPolicy.minContentLength,
          compareLimit: config.noveltyPolicy.compareLimit,
          gateStage: config.noveltyPolicy.gateStage,
        }
      : {
          minScore: 0,
          maxSimilarity: 1,
          minContentLength: Number.MAX_SAFE_INTEGER,
          compareLimit: 1,
          gateStage: config.noveltyPolicy.gateStage,
        },
    smt: {
      useFullSolver: config.smt.useFullSolver,
      timeoutMs: config.smt.timeoutMs,
    },
  };
}

function mapKernelRunStatus(kernelStatus: ExecutionStatus): UBKRunStatus {
  if (kernelStatus === 'COMPLETE') return 'SUCCESS';
  if (kernelStatus === 'RESOURCE_EXHAUSTED') return 'EXHAUSTED';
  return 'PARTIAL';
}

function mapTerminationStatus(kernel: {
  status: ExecutionStatus;
  registry: ArtifactRegistry;
  stopReason: StopReason;
}): UBKTerminationStatus {
  const hasImpossibilityCert = kernel.registry.artifacts.some((artifact) => artifact.type === 'IMP_CERT');
  if (hasImpossibilityCert) return 'IMPOSSIBLE';
  if (kernel.status === 'COMPLETE') return 'PASS';
  if (kernel.status === 'ERROR') return 'FAIL';
  if (kernel.stopReason === 'F_MAX' || kernel.stopReason === 'R_MAX' || kernel.stopReason === 'I_MAX') return 'UNKNOWN';
  return 'UNKNOWN';
}

function mergeConfig(config?: Partial<UBKConfig>): UBKConfig {
  return {
    resourceLimits: {
      ...DEFAULT_CONFIG.resourceLimits,
      ...(config?.resourceLimits ?? {}),
    },
    noveltyPolicy: {
      ...DEFAULT_CONFIG.noveltyPolicy,
      ...(config?.noveltyPolicy ?? {}),
    },
    smt: {
      ...DEFAULT_CONFIG.smt,
      ...(config?.smt ?? {}),
    },
  };
}

export function getUBKTurwinIntegrationPoints(): readonly UBKIntegrationPoint[] {
  return UBK_TURWIN_INTEGRATION_POINTS;
}

export async function executeUniversalBoundsKernel(
  input: UBKExecutionInput,
  options: UBKExecutionOptions = {},
): Promise<UBKExecutionResult> {
  const dependencies: UBKDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...(options.dependencies ?? {}),
  };
  const config = mergeConfig(options.config);
  const startedAtMs = dependencies.now();
  const runtime = dependencies.detectRuntime();

  const encodedConstraints = await dependencies.encodeConstraints(input.objective);
  const constraints = encodedConstraints.map((encoded, index) => toUBKConstraint(encoded, index));
  const unknownRegions = deriveUnknownRegions(constraints, runtime, config.smt.useFullSolver);
  const cir: UBKConstraintIR = {
    objective: input.objective,
    constraints,
    domains: Array.from(new Set(constraints.map((constraint) => constraint.domain))),
  };

  const kernelResult = await dependencies.executeKernel(
    input.userInput ?? input.objective,
    input.objective,
    input.generator,
    toTurwinConfig(config),
    input.seedRegistry ?? [],
  );

  const endedAtMs = dependencies.now();
  const elapsedMs = Math.max(0, endedAtMs - startedAtMs);
  const budget: UBKResourceBudget = {
    startedAtMs,
    elapsedMs,
    remainingTimeMs: Math.max(0, config.resourceLimits.timeLimitMs - elapsedMs),
    memoryLimitMB: config.resourceLimits.memoryLimitMB,
    maxIterations: config.resourceLimits.maxIterations,
    maxPaths: config.resourceLimits.maxPaths,
    maxFail: config.resourceLimits.maxFail,
  };

  const provenanceLog = kernelResult.registry.commitLog.map((entry) => `${entry.timestamp}:${entry.hash}`);
  const artifactBundle: UBKArtifactBundle = {
    registry: kernelResult.registry.artifacts,
    impossibilityCertificates: kernelResult.registry.artifacts.filter((artifact) => artifact.type === 'IMP_CERT'),
    witnesses: kernelResult.registry.artifacts.filter((artifact) => artifact.type === 'WITNESS'),
  };

  return {
    status: mapTerminationStatus({
      status: kernelResult.status,
      registry: kernelResult.registry,
      stopReason: kernelResult.stopReason,
    }),
    runStatus: mapKernelRunStatus(kernelResult.status),
    state: {
      Cir: cir,
      Plog: provenanceLog,
      Rreg: kernelResult.registry,
      Brem: budget,
      Umap: unknownRegions,
    },
    artifactBundle,
    certificate: kernelResult.certificate,
    traceLog: kernelResult.traceLog,
    kernelStatus: kernelResult.status,
    stopReason: kernelResult.stopReason,
  };
}

