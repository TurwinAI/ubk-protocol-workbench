import { GoogleGenAI } from '@google/genai';
import { constraintEncoder } from '../core-engine/constraintEncoder';
import { SMTVerifier, type SMTResult } from '../core-engine/smtVerifier';
import { validateScientificClaim, type ValidationResult } from '../core-engine/scientificValidationService';
import { executeUniversalBoundsKernel, type UBKExecutionResult } from '../core-engine/ubkKernel';
import { getZ3VerificationService, type DAGVerificationResult } from '../core-engine/z3VerificationService';
import { getModelConfigSync, setRuntimeGeminiApiKey } from '../config/modelConfig';
import { planCompositeDocAstWithGemini } from '../core/execution/astPlanner';
import { buildExecutionPlanFromAst, buildExecutionPlanFromRecipeText, type ExecutionPlan } from '../core/execution/planBuilder';
import { GeminiToolExecutor } from '../core/execution/GeminiToolExecutor';
import type { Artifact, ExecutionContextState, NodeExecutionState } from '../core/execution/types';
import { ToolRegistry } from '../core/toolInvention/ToolRegistry';
import { autoRegisterProtocolTools } from '../core/toolInvention/toolAutoRegistration';
import { buildLiveVerificationPacket } from '../services/superagent/liveVerificationPacket';
import type { VerificationPublicPacket } from '../services/superagent/verificationPacket';
import { getBenchmarkById, RESEARCH_BENCHMARKS } from './benchmarks';

export type ExecutionMode = 'replay' | 'live';

export interface ProtocolRunRequest {
  objective: string;
  protocolMarkdown?: string;
  mode?: ExecutionMode;
  apiKey?: string;
  benchmarkId?: string;
  maxIterations?: number;
  smtTimeoutMs?: number;
}

export interface ProtocolRunResponse {
  runId: string;
  mode: ExecutionMode;
  objective: string;
  protocolMarkdown: string;
  smtResult: SMTResult;
  scientificValidation: ValidationResult;
  ubk: UBKExecutionResult;
  plan: ExecutionPlan;
  dagVerification: DAGVerificationResult;
  artifacts: Artifact[];
  verificationPacket: VerificationPublicPacket;
  timingMs: {
    total: number;
    smt: number;
    kernel: number;
    execution: number;
  };
}

export class ApiValidationError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 400, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ApiValidationError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function buildDefaultProtocolMarkdown(objective: string): string {
  return [
    '# Title',
    `Research Verification Protocol: ${objective.slice(0, 72)}`,
    '',
    '## Goal',
    objective,
    '',
    '## Steps',
    `1. Formalize domain constraints and invariants for: ${objective}`,
    '2. Generate a structured technical candidate solution satisfying all hard bounds.',
    '3. Run Z3 SMT solving, 12-domain scientific axiom checks, and synthesize a bounded verification report.',
  ].join('\n');
}

function buildReplayCandidate(objective: string, protocolMarkdown: string, benchmarkId?: string): string {
  const benchmark = getBenchmarkById(benchmarkId);
  if (benchmark && benchmark.objective.trim().toLowerCase() === objective.trim().toLowerCase()) {
    return benchmark.replayCandidateOutput;
  }
  const byObjective = RESEARCH_BENCHMARKS.find(
    (b) => b.objective.trim().toLowerCase() === objective.trim().toLowerCase()
  );
  if (byObjective) {
    return byObjective.replayCandidateOutput;
  }
  return `Structured technical protocol for objective "${objective}":\n${protocolMarkdown.slice(0, 1200)}`;
}

async function generateCandidateWithGemini(
  objective: string,
  protocolMarkdown: string,
  apiKey: string
): Promise<string> {
  const config = getModelConfigSync(apiKey);
  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.generateContent({
    model: config.defaultModel,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Produce a concise, technically rigorous solution for the following objective and protocol.\n\nObjective:\n${objective}\n\nProtocol:\n${protocolMarkdown}`,
          },
        ],
      },
    ],
    config: { temperature: 0.2, maxOutputTokens: 1200 },
  });

  const text =
    typeof response.text === 'string'
      ? response.text.trim()
      : (response.candidates?.[0]?.content?.parts ?? [])
          .map((p: { text?: string }) => p.text ?? '')
          .join('\n')
          .trim();

  if (!text) {
    throw new ApiValidationError('Gemini API returned an empty response.', 502, 'UPSTREAM_EMPTY_RESPONSE');
  }
  return text;
}

export async function runProtocolWorkbench(req: ProtocolRunRequest): Promise<ProtocolRunResponse> {
  const totalStart = Date.now();
  const objective = String(req.objective || '').trim();
  if (!objective) {
    throw new ApiValidationError('Objective is required and must be a non-empty string.', 400, 'MISSING_OBJECTIVE');
  }

  const mode: ExecutionMode = req.mode === 'live' ? 'live' : 'replay';
  const benchmark = getBenchmarkById(req.benchmarkId);
  const protocolMarkdown =
    String(req.protocolMarkdown || '').trim() ||
    benchmark?.protocolMarkdown ||
    buildDefaultProtocolMarkdown(objective);

  const resolvedApiKey =
    req.apiKey?.trim() ||
    (typeof process !== 'undefined' ? (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim() : '');

  if (mode === 'live' && !resolvedApiKey) {
    throw new ApiValidationError(
      'Live BYOK mode requires a GEMINI_API_KEY (set GEMINI_API_KEY in .env or provide an API key in the request). Switch to Replay mode for offline deterministic verification.',
      400,
      'MISSING_API_KEY'
    );
  }

  const runId = `run_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const smtTimeoutMs = Math.max(250, Math.min(10_000, Number(req.smtTimeoutMs || 2500)));
  const maxIterations = Math.max(1, Math.min(8, Number(req.maxIterations || 3)));

  // 1. Acquire candidate solution (live BYOK fails loudly; replay uses deterministic fixture)
  let candidateSolution: string;
  if (mode === 'live') {
    setRuntimeGeminiApiKey(resolvedApiKey);
    try {
      candidateSolution = await generateCandidateWithGemini(objective, protocolMarkdown, resolvedApiKey);
    } catch (err) {
      if (err instanceof ApiValidationError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const isAuth = /api[_\s-]?key|unauthenticated|permission|401|403|invalid/i.test(msg);
      throw new ApiValidationError(
        `Live Gemini API call failed: ${msg}`,
        isAuth ? 401 : 502,
        isAuth ? 'INVALID_API_KEY' : 'UPSTREAM_LLM_ERROR'
      );
    } finally {
      setRuntimeGeminiApiKey(undefined);
    }
  } else {
    candidateSolution = buildReplayCandidate(objective, protocolMarkdown, req.benchmarkId);
  }

  // 2. Direct real Z3 WASM SMT verification + 12-domain scientific claim validation
  const smtStart = Date.now();
  const smtVerifier = new SMTVerifier({
    useFullSolver: true,
    timeoutMs: smtTimeoutMs,
    enableCache: false,
  });
  const smtResult = await smtVerifier.verifyConstraint(objective, candidateSolution);
  const scientificValidation = await validateScientificClaim(`${objective}\n${candidateSolution}`);
  const smtElapsed = Date.now() - smtStart;

  // 3. Universal Bounds Kernel -> Turwin v4.0-FS Kernel (real bounded certificate + ImpCerts)
  const kernelStart = Date.now();
  const ubk = await executeUniversalBoundsKernel(
    {
      objective,
      userInput: objective,
      generator: async () => candidateSolution,
    },
    {
      config: {
        resourceLimits: {
          timeLimitMs: 15_000,
          memoryLimitMB: 512,
          maxIterations,
          maxPaths: 5,
          maxFail: 2,
        },
        noveltyPolicy: {
          enabled: true,
          minScore: 0.2,
          maxSimilarity: 0.92,
          minContentLength: 120,
          compareLimit: 100,
          gateStage: 'pre-verify',
        },
        smt: {
          useFullSolver: true,
          timeoutMs: smtTimeoutMs,
        },
      },
      dependencies: {
        encodeConstraints: (goalText: string) => constraintEncoder.extractAll(goalText),
      },
    }
  );
  const kernelElapsed = Date.now() - kernelStart;

  // 4. Protocol-to-AST Execution Plan & Artifact Fulfillment
  const execStart = Date.now();
  const toolRegistry = new ToolRegistry();

  let plan: ExecutionPlan;
  const artifacts: Artifact[] = [];
  const nodeStates: Record<string, NodeExecutionState> = {};

  if (mode === 'live') {
    setRuntimeGeminiApiKey(resolvedApiKey);
    try {
      const plannedAst = await planCompositeDocAstWithGemini({
        intent: objective,
        recipeText: protocolMarkdown,
        maxNodes: 4,
        apiKey: resolvedApiKey,
      });
      plan = buildExecutionPlanFromAst({
        ast: plannedAst,
        intent: objective,
        recipeText: protocolMarkdown,
      });
      autoRegisterProtocolTools({ registry: toolRegistry, plan, recipeText: protocolMarkdown });

      const executor = new GeminiToolExecutor(toolRegistry);
      const context: ExecutionContextState = {
        nodes: {},
        provenance: [],
      };

      for (const node of plan.nodes) {
        const execResult = await executor.executeGeminiNode(node, context, {
          recipeIntent: objective,
          recipeText: protocolMarkdown,
        });
        const nodeArtifacts = execResult.artifacts ?? [];
        const nodeState: NodeExecutionState = {
          id: node.id,
          status: execResult.status ?? 'completed',
          startTime: execResult.startTime ?? execStart,
          endTime: execResult.endTime ?? Date.now(),
          attempts: execResult.attempts ?? 1,
          result: execResult.result,
          error: execResult.error,
          artifacts: nodeArtifacts,
        };
        nodeStates[node.id] = nodeState;
        context.nodes[node.id] = nodeState;
        artifacts.push(...nodeArtifacts);
      }
    } finally {
      setRuntimeGeminiApiKey(undefined);
    }
  } else {
    plan = buildExecutionPlanFromRecipeText({
      recipeText: protocolMarkdown,
      intent: objective,
    });
    autoRegisterProtocolTools({ registry: toolRegistry, plan, recipeText: protocolMarkdown });

    for (const node of plan.nodes) {
      const content = [
        `### ${node.name}`,
        '',
        `**Mode:** Deterministic Replay (Real Z3 WASM + 12-Domain Axiom Verification)`,
        `**Objective:** ${objective}`,
        '',
        node.description,
        '',
        `**Verified Candidate Output:**`,
        candidateSolution,
      ].join('\n');

      const artifact: Artifact = {
        id: `art_${node.id}`,
        type: node.outputType === 'code' ? 'code' : 'report',
        title: node.name,
        content,
        metadata: {
          nodeId: node.id,
          mode: 'replay',
          createdAt: new Date().toISOString(),
        },
      };
      artifacts.push(artifact);
      nodeStates[node.id] = {
        id: node.id,
        status: 'completed',
        startTime: execStart,
        endTime: Date.now(),
        attempts: 1,
        result: content,
        artifacts: [artifact],
      };
    }
  }

  // 4b. Real Z3 SAT DAG Acyclicity Verification over compiled CompositeDocAst nodes
  const dagSteps = plan.nodes.map((node, idx) => ({
    id: node.id,
    dependencies:
      Array.isArray((node as { dependencies?: string[] }).dependencies) &&
      ((node as { dependencies?: string[] }).dependencies?.length ?? 0) > 0
        ? (node as { dependencies?: string[] }).dependencies!
        : idx > 0
          ? [plan.nodes[idx - 1].id]
          : [],
    inputs: [],
    outputs: [node.outputType || 'report'],
  }));
  const dagVerification = await getZ3VerificationService().verifyAcyclicDAG(dagSteps);

  // Append canonical Verification Summary report artifact
  const summaryReport: Artifact = {
    id: `art_verification_summary_${runId}`,
    type: 'report',
    title: 'Formal Verification & Synthesis Summary',
    content: [
      '# Formal Verification Summary',
      '',
      `- **UBK Status:** \`${ubk.status}\` (Run: \`${ubk.runStatus}\`, Stop Reason: \`${ubk.stopReason}\`)`,
      `- **Certificate Type:** \`${ubk.certificate.certificate_type}\` (\`${ubk.certificate.fingerprint.slice(0, 16)}...\`)`,
      `- **Z3 SMT Verdict:** \`${smtResult.verdict}\` (${smtResult.soundness}, ${smtResult.timeMs}ms) — ${smtResult.proof || 'No proof string'}`,
      `- **Scientific Axiom Validation:** \`${scientificValidation.classification}\` — ${scientificValidation.reasoning_summary}`,
      `- **Constraints Formalized:** ${ubk.state.Cir.constraints.length}`,
      `- **Impossibility Certificates:** ${ubk.artifactBundle.impossibilityCertificates.length}`,
      `- **Witnesses:** ${ubk.artifactBundle.witnesses.length}`,
      '',
      '## Candidate Output',
      candidateSolution,
    ].join('\n'),
    metadata: {
      nodeId: 'verification_summary',
      mode,
      createdAt: new Date().toISOString(),
    },
  };
  artifacts.push(summaryReport);

  const verificationPacket = buildLiveVerificationPacket({
    runId,
    intent: objective,
    plan,
    snapshot: {
      artifacts,
      ast: plan.ast,
      nodes: Object.fromEntries(Object.entries(nodeStates).map(([k, v]) => [k, { status: v.status }])),
    },
    kernelResult: {
      status: ubk.kernelStatus,
      stopReason: ubk.stopReason,
      certificate: ubk.certificate,
      icSet: ubk.artifactBundle.impossibilityCertificates.filter(
        (a): a is Extract<typeof a, { type: 'IMP_CERT' }> => a.type === 'IMP_CERT'
      ),
      witnessOutput: ubk.artifactBundle.witnesses
        .map((w) => ('counterExample' in w ? w.counterExample : ''))
        .filter(Boolean)
        .join('\n'),
    },
  });

  const execElapsed = Date.now() - execStart;

  return {
    runId,
    mode,
    objective,
    protocolMarkdown,
    smtResult,
    scientificValidation,
    ubk,
    plan,
    dagVerification,
    artifacts,
    verificationPacket,
    timingMs: {
      total: Date.now() - totalStart,
      smt: smtElapsed,
      kernel: kernelElapsed,
      execution: execElapsed,
    },
  };
}
