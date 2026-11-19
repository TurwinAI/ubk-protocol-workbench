import type { ExecutionNode } from '../../core/execution/types';

export type ProgressiveDisclosurePhase =
  | 'queued'
  | 'planning'
  | 'executing_nodes'
  | 'composing_report'
  | 'hydrating_report'
  | 'interactive_ready'
  | 'failed';

export type ProgressiveStepStatus = 'queued' | 'running' | 'ready' | 'blocked' | 'failed';

export interface ProgressiveExecutionStep {
  id: string;
  label: string;
  detail: string;
  status: ProgressiveStepStatus;
  nodeId?: string;
  artifactHint?: string;
  percentHint?: number;
}

export interface ProgressiveExecutionState {
  version: 1;
  phase: ProgressiveDisclosurePhase;
  phaseLabel: string;
  phaseDetail: string;
  progressPct: number;
  steps: ProgressiveExecutionStep[];
  activeStepId?: string;
  updatedAt: string;
}

const PHASE_LABELS: Record<ProgressiveDisclosurePhase, string> = {
  queued: 'Queued',
  planning: 'Planning',
  executing_nodes: 'Executing Nodes',
  composing_report: 'Composing Report',
  hydrating_report: 'Hydrating Report',
  interactive_ready: 'Interactive Ready',
  failed: 'Failed',
};

const STEP_STATUS_SET: Record<ProgressiveStepStatus, true> = {
  queued: true,
  running: true,
  ready: true,
  blocked: true,
  failed: true,
};

const clampPct = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
};

const nowIso = (): string => new Date().toISOString();

const defaultStepDetail = (label: string, status: ProgressiveStepStatus): string => {
  if (status === 'running') return `Constructing ${label}...`;
  if (status === 'ready') return `${label} is ready.`;
  if (status === 'failed') return `${label} failed.`;
  if (status === 'blocked') return `${label} is blocked.`;
  return `${label} is queued.`;
};

export const resolveProgressivePhaseLabel = (phase: ProgressiveDisclosurePhase): string => PHASE_LABELS[phase];

export const createProgressiveStepsFromPlanNodes = (nodes: ExecutionNode[]): ProgressiveExecutionStep[] =>
  nodes.map((node, index) => {
    const label = (node.name || node.id || `Step ${index + 1}`).trim() || `Step ${index + 1}`;
    return {
      id: `step-${String(index + 1).padStart(2, '0')}`,
      label,
      detail: defaultStepDetail(label, 'queued'),
      status: 'queued',
      nodeId: node.id,
    };
  });

export const upsertProgressiveStepByNode = (
  steps: ProgressiveExecutionStep[],
  nodeId: string,
  status: ProgressiveStepStatus,
  detail?: string,
  artifactHint?: string
): ProgressiveExecutionStep[] =>
  steps.map((step) => {
    if (step.nodeId !== nodeId) return step;
    return {
      ...step,
      status,
      detail: detail && detail.trim().length > 0 ? detail : defaultStepDetail(step.label, status),
      ...(artifactHint ? { artifactHint } : {}),
    };
  });

export const computeProgressPctFromSteps = (
  steps: ProgressiveExecutionStep[],
  rangeStart = 0,
  rangeEnd = 100
): number => {
  const boundedStart = Math.max(0, Math.min(100, rangeStart));
  const boundedEnd = Math.max(boundedStart, Math.min(100, rangeEnd));
  if (steps.length === 0) return clampPct(boundedStart);
  const completedCount = steps.filter(
    (step) => step.status === 'ready' || step.status === 'failed' || step.status === 'blocked'
  ).length;
  const ratio = completedCount / steps.length;
  return clampPct(boundedStart + (boundedEnd - boundedStart) * ratio);
};

export const createProgressiveExecutionState = (input?: {
  phase?: ProgressiveDisclosurePhase;
  phaseDetail?: string;
  progressPct?: number;
  steps?: ProgressiveExecutionStep[];
  activeStepId?: string;
}): ProgressiveExecutionState => {
  const phase = input?.phase ?? 'queued';
  return {
    version: 1,
    phase,
    phaseLabel: resolveProgressivePhaseLabel(phase),
    phaseDetail: input?.phaseDetail?.trim() || 'Ready to execute protocol.',
    progressPct: clampPct(input?.progressPct ?? 0),
    steps: Array.isArray(input?.steps) ? input.steps : [],
    ...(input?.activeStepId ? { activeStepId: input.activeStepId } : {}),
    updatedAt: nowIso(),
  };
};

export const normalizeProgressiveExecutionState = (
  value: unknown,
  fallback?: Partial<Pick<ProgressiveExecutionState, 'phase' | 'phaseDetail' | 'progressPct' | 'steps' | 'activeStepId'>>
): ProgressiveExecutionState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createProgressiveExecutionState({
      phase: fallback?.phase ?? 'queued',
      phaseDetail: fallback?.phaseDetail ?? 'Ready to execute protocol.',
      progressPct: fallback?.progressPct ?? 0,
      steps: fallback?.steps ?? [],
      activeStepId: fallback?.activeStepId,
    });
  }

  const source = value as Record<string, unknown>;
  const sourcePhase = typeof source.phase === 'string' ? source.phase : fallback?.phase;
  const phase = (sourcePhase && sourcePhase in PHASE_LABELS
    ? sourcePhase
    : 'queued') as ProgressiveDisclosurePhase;

  const rawSteps = Array.isArray(source.steps) ? source.steps : fallback?.steps ?? [];
  const steps: ProgressiveExecutionStep[] = rawSteps
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const item = entry as Record<string, unknown>;
      const label = typeof item.label === 'string' && item.label.trim().length > 0 ? item.label.trim() : `Step ${index + 1}`;
      const statusRaw = typeof item.status === 'string' ? item.status : 'queued';
      const status = (statusRaw in STEP_STATUS_SET ? statusRaw : 'queued') as ProgressiveStepStatus;
      return {
        id: typeof item.id === 'string' && item.id.trim().length > 0 ? item.id : `step-${String(index + 1).padStart(2, '0')}`,
        label,
        detail:
          typeof item.detail === 'string' && item.detail.trim().length > 0
            ? item.detail
            : defaultStepDetail(label, status),
        status,
        ...(typeof item.nodeId === 'string' ? { nodeId: item.nodeId } : {}),
        ...(typeof item.artifactHint === 'string' ? { artifactHint: item.artifactHint } : {}),
        ...(typeof item.percentHint === 'number' && Number.isFinite(item.percentHint)
          ? { percentHint: clampPct(item.percentHint) }
          : {}),
      };
    })
    .filter((entry): entry is ProgressiveExecutionStep => entry !== null);

  return {
    version: 1,
    phase,
    phaseLabel: resolveProgressivePhaseLabel(phase),
    phaseDetail:
      (typeof source.phaseDetail === 'string' && source.phaseDetail.trim().length > 0
        ? source.phaseDetail
        : fallback?.phaseDetail) || 'Ready to execute protocol.',
    progressPct: clampPct(
      typeof source.progressPct === 'number'
        ? source.progressPct
        : (typeof fallback?.progressPct === 'number' ? fallback.progressPct : 0)
    ),
    steps,
    ...(typeof source.activeStepId === 'string'
      ? { activeStepId: source.activeStepId }
      : (typeof fallback?.activeStepId === 'string' ? { activeStepId: fallback.activeStepId } : {})),
    updatedAt: typeof source.updatedAt === 'string' && source.updatedAt.length > 0 ? source.updatedAt : nowIso(),
  };
};

