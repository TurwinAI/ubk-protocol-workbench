import { GoogleGenAI } from '@google/genai';
import type {
  Artifact,
  ArtifactType,
  ExecutionContextState,
  ExecutionNode,
  NodeExecutionState,
  VisualAspectRatio,
  VisualPlan,
  VisualRenderMode
} from './types';
import { getModelConfig } from '../../config/modelConfig';
import type { ExecutionContext, ToolRegistry } from '../toolInvention/ToolRegistry';
import { z } from 'zod';
import { semanticSearch } from '../../services/vectorSearch';
import { extractMermaidCode } from '../../lib/mermaid';
import { generateGeminiContentWithRateControl } from './geminiRateControl';

const ARTIFACT_TYPES: ArtifactType[] = ['text', 'code', 'json', 'html', 'image', 'diagram', 'chart', 'table', 'audio', 'video', 'file', 'report'];
const VISUAL_ASPECT_RATIOS: VisualAspectRatio[] = ['1:1', '3:4', '4:3', '16:9', '9:16'];
const VISUAL_RENDER_MODES: VisualRenderMode[] = ['image', 'mermaid', 'chartSpec'];
const RESERVED_TOOL_BINDINGS = new Set(['fileSearch', 'googleSearch', 'codeExecution', 'urlContext', '__audit', '__audit__']);

const ArtifactSchema = z.object({
  type: z.enum(ARTIFACT_TYPES as [ArtifactType, ...ArtifactType[]]),
  title: z.string().optional(),
  content: z.string(),
  language: z.string().optional(),
  mimeType: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

const VisualPlanSchema = z
  .object({
    renderMode: z.enum(VISUAL_RENDER_MODES as [VisualRenderMode, ...VisualRenderMode[]]).optional(),
    prompt: z.string().optional(),
    style: z.string().optional(),
    aspectRatio: z.enum(VISUAL_ASPECT_RATIOS as [VisualAspectRatio, ...VisualAspectRatio[]]).optional(),
    mermaid: z.string().optional(),
    chartSpec: z.union([z.string(), z.record(z.unknown())]).optional(),
    chartSpecFormat: z.string().optional()
  })
  .passthrough();

const FulfillmentSchema = z.object({
  artifacts: z.array(ArtifactSchema).min(1)
});

const getJsonCandidate = (raw: string): string => {
  const text = (raw || '').trim();
  if (!text) return text;
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) return text.slice(first, last + 1);
  return text;
};

const collectNonThoughtText = (response: any): string => {
  const parts: any[] = response?.candidates?.[0]?.content?.parts ?? [];
  const texts = parts
    .filter(p => p && typeof p.text === 'string' && !p.thought)
    .map(p => String(p.text));
  return texts.join('\n').trim();
};

const parseArtifactsFromLegacyMarkers = (raw: string, nodeName: string): Artifact[] => {
  const artifacts: Artifact[] = [];
  const artifactRegex = /\[ARTIFACT:(.*?)\]([\s\S]*?)\[\/ARTIFACT\]/g;
  let match: RegExpExecArray | null;
  while ((match = artifactRegex.exec(raw)) !== null) {
    const type = String(match[1] || '').trim() as ArtifactType;
    const content = String(match[2] || '').trim();
    if (!content) continue;
    artifacts.push({
      type: (ARTIFACT_TYPES.includes(type) ? type : 'text') as ArtifactType,
      content,
      title: `Output from ${nodeName}`,
      ...(type === 'code' ? { language: 'typescript' } : {})
    });
  }
  return artifacts;
};

const parseArtifactsFromCodeFences = (raw: string): Artifact[] => {
  const artifacts: Artifact[] = [];
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(raw)) !== null) {
    const lang = (match[1] || 'text').trim();
    const content = String(match[2] || '').trim();
    if (!content) continue;
    artifacts.push({
      type: 'code',
      content,
      language: lang
    });
  }
  return artifacts;
};

const expectsHtmlOutput = (text: string): boolean =>
  /\b(html|web\s?page|landing\s?page|ui\s?preview|rendered\s?page)\b/i.test(text || '');

const expectsStrictJsonOutput = (text: string): boolean =>
  [
    /\bstrict\s+json\b/i,
    /\bjson\s+(schema|object|array|payload|response|contract|document|artifact|output)\b/i,
    /\bmachine[-\s]?readable\b/i,
    /\bprogrammatic\b/i,
    /\bapi\b.{0,40}\b(payload|response|contract|request|json)\b/i,
    /\b(consumed|ingested|parsed)\b.{0,40}\b(parser|automation|api|system|script)\b/i,
  ].some((pattern) => pattern.test(text || ''));

const toContextText = (node: ExecutionNode): string => `${node.name || ''}\n${node.description || ''}`.trim();

export const choosePrimaryArtifactType = (node: ExecutionNode, expectedType: ArtifactType): ArtifactType => {
  if (expectedType !== 'json') return expectedType;
  const text = toContextText(node);
  if (expectsStrictJsonOutput(text)) return 'json';
  if (expectsHtmlOutput(text)) return 'html';
  return 'report';
};

const WEBSITE_APP_EXECUTION_MODEL = 'gemini-3.1-pro-preview';
const WEBSITE_APP_HINT_RE =
  /\b(website|web\s?app|webpage|landing\s?page|frontend|ui\s?prototype|interface|html|react|next(?:\.js)?)\b/i;

export const selectExecutionModelForNode = (
  node: ExecutionNode,
  expectedType: ArtifactType,
  preferredPrimaryType: ArtifactType,
  fallbackModel: string
): string => {
  if (
    expectedType === 'html' ||
    expectedType === 'code' ||
    preferredPrimaryType === 'html' ||
    preferredPrimaryType === 'code'
  ) {
    return WEBSITE_APP_EXECUTION_MODEL;
  }

  const contextText = toContextText(node);
  if ((expectedType === 'text' || expectedType === 'report') && WEBSITE_APP_HINT_RE.test(contextText)) {
    return WEBSITE_APP_EXECUTION_MODEL;
  }

  return fallbackModel;
};

const toShortLabel = (value: string): string =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const extractHttpStatus = (err: unknown): number | null => {
  const anyErr = err as any;
  const direct =
    (typeof anyErr?.status === 'number' && anyErr.status) ||
    (typeof anyErr?.code === 'number' && anyErr.code) ||
    (typeof anyErr?.error?.code === 'number' && anyErr.error.code);
  if (typeof direct === 'number' && direct >= 100 && direct < 600) return direct;

  const msg = String(anyErr?.message ?? err ?? '');
  const m1 = msg.match(/got status:\s*(\d{3})/i);
  if (m1) return Number(m1[1]);
  const m2 = msg.match(/"code"\s*:\s*(\d{3})/i);
  if (m2) return Number(m2[1]);
  return null;
};

const isRetriableExecutionError = (err: unknown): boolean => {
  const status = extractHttpStatus(err);
  if (status && [408, 429, 500, 502, 503, 504].includes(status)) return true;
  const message = String((err as any)?.message ?? err ?? '').toLowerCase();
  return message.includes('unavailable') || message.includes('overloaded') || message.includes('resource exhausted');
};

const formatScalar = (value: unknown): string => {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'string') return value.trim() || 'N/A';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return `\`${JSON.stringify(value)}\``;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderObjectAsMarkdown = (value: Record<string, unknown>, depth = 0): string[] => {
  const entries = Object.entries(value);
  if (entries.length === 0) return ['- _No fields present._'];

  const lines: string[] = [];
  for (const [key, entryValue] of entries.slice(0, 24)) {
    const label = toShortLabel(key);
    const indent = '  '.repeat(depth);
    if (entryValue && typeof entryValue === 'object' && !Array.isArray(entryValue)) {
      lines.push(`${indent}- **${label}:**`);
      lines.push(...renderObjectAsMarkdown(entryValue as Record<string, unknown>, depth + 1));
      continue;
    }

    if (Array.isArray(entryValue)) {
      if (entryValue.length === 0) {
        lines.push(`${indent}- **${label}:** _None_`);
      } else {
        const preview = entryValue
          .slice(0, 8)
          .map((item) => `${'  '.repeat(depth + 1)}- ${formatScalar(item)}`);
        lines.push(`${indent}- **${label}:**`);
        lines.push(...preview);
        if (entryValue.length > 8) {
          lines.push(`${'  '.repeat(depth + 1)}- _${entryValue.length - 8} more item(s)_`);
        }
      }
      continue;
    }

    lines.push(`${indent}- **${label}:** ${formatScalar(entryValue)}`);
  }
  if (entries.length > 24) lines.push(`- _${entries.length - 24} additional field(s) omitted for brevity._`);
  return lines;
};

const jsonToMarkdown = (raw: string, title: string): string => {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return [`## ${title}`, '', ...renderObjectAsMarkdown(parsed as Record<string, unknown>)].join('\n');
    }
    if (Array.isArray(parsed)) {
      const lines = parsed
        .slice(0, 12)
        .map((item) => `- ${formatScalar(item)}`);
      return [`## ${title}`, '', ...lines, parsed.length > 12 ? `- _${parsed.length - 12} more item(s)_` : '']
        .filter(Boolean)
        .join('\n');
    }
    return [`## ${title}`, '', `- ${formatScalar(parsed)}`].join('\n');
  } catch {
    const trimmed = raw.trim();
    if (!trimmed) return `## ${title}\n\n_No structured content provided._`;
    return [`## ${title}`, '', '```', trimmed.slice(0, 12_000), '```'].join('\n');
  }
};

const markdownToSimpleHtml = (markdown: string, title: string): string => {
  const escapedTitle = escapeHtml(title || 'Generated Output');
  const escapedBody = escapeHtml(markdown || '').replace(/\n/g, '<br/>');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    `  <title>${escapedTitle}</title>`,
    '</head>',
    '<body style="font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, &quot;Helvetica Neue&quot;, Helvetica, Arial, sans-serif); line-height: 1.55; margin: 24px; color: #dbe6ff; background: #0b1120;">',
    `  <h1 style="font-size: 20px; margin-bottom: 16px;">${escapedTitle}</h1>`,
    `  <div>${escapedBody}</div>`,
    '</body>',
    '</html>',
  ].join('\n');
};

const convertJsonArtifactToReadable = (artifact: Artifact, preferredPrimaryType: ArtifactType, fallbackTitle: string): Artifact => {
  const title = artifact.title?.trim() || fallbackTitle || 'Structured Output';
  const markdown = jsonToMarkdown(artifact.content || '', title);

  if (preferredPrimaryType === 'html') {
    return {
      ...artifact,
      type: 'html',
      content: markdownToSimpleHtml(markdown, title),
      mimeType: 'text/html',
      language: undefined,
    };
  }

  return {
    ...artifact,
    type: 'report',
    content: markdown,
    mimeType: 'text/markdown',
    language: undefined,
  };
};

export const normalizeArtifactsForPreferredOutput = (input: {
  node: ExecutionNode;
  artifacts: Artifact[];
  expectedType: ArtifactType;
  preferredPrimaryType: ArtifactType;
  strictJsonRequired: boolean;
}): Artifact[] => {
  const { node, artifacts, expectedType, preferredPrimaryType, strictJsonRequired } = input;
  if (!Array.isArray(artifacts) || artifacts.length === 0) return artifacts;
  if (expectedType !== 'json' || strictJsonRequired) return artifacts;

  const normalized = artifacts.map((artifact, index) => {
    if (artifact.type !== 'json') return artifact;
    return convertJsonArtifactToReadable(artifact, index === 0 ? preferredPrimaryType : 'report', node.name || 'Structured Output');
  });

  const first = normalized[0];
  if (!first) return normalized;

  if (first.type !== preferredPrimaryType) {
    if (preferredPrimaryType === 'report' && (first.type === 'text' || first.type === 'code')) {
      normalized[0] = { ...first, type: 'report', mimeType: first.mimeType || 'text/markdown' };
    } else if (preferredPrimaryType === 'html' && first.type !== 'html') {
      const markdown = first.content || '';
      normalized[0] = {
        ...first,
        type: 'html',
        content: markdownToSimpleHtml(markdown, first.title || node.name || 'Output'),
        mimeType: 'text/html',
        language: undefined,
      };
    }
  }

  return normalized;
};

const toVisualArtifactType = (expectedType: ArtifactType): 'image' | 'diagram' | 'chart' => {
  if (expectedType === 'diagram') return 'diagram';
  if (expectedType === 'chart') return 'chart';
  return 'image';
};

const normalizeVisualRenderMode = (value: unknown): VisualRenderMode | null => {
  if (typeof value !== 'string') return null;
  const lowered = value.trim().toLowerCase();
  if (!lowered) return null;
  if (lowered === 'mermaid') return 'mermaid';
  if (lowered === 'image' || lowered === 'img') return 'image';
  if (lowered === 'chartspec' || lowered === 'chart-spec' || lowered === 'chart') return 'chartSpec';
  return null;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const normalizeVisualPlan = (value: unknown): VisualPlan | null => {
  const candidate = asRecord(value);
  if (!candidate) return null;

  const aliased: Record<string, unknown> = { ...candidate };
  const aliasMode = normalizeVisualRenderMode(candidate.renderMode ?? candidate.renderer ?? candidate.mode);
  if (aliasMode) aliased.renderMode = aliasMode;

  const parsed = VisualPlanSchema.safeParse(aliased);
  if (!parsed.success) return null;

  const plan = { ...parsed.data } as VisualPlan;
  if (!plan.renderMode) {
    if (typeof plan.mermaid === 'string' && plan.mermaid.trim()) {
      plan.renderMode = 'mermaid';
    } else if (plan.chartSpec !== undefined) {
      plan.renderMode = 'chartSpec';
    } else {
      plan.renderMode = 'image';
    }
  }

  const mermaid = typeof plan.mermaid === 'string' ? extractMermaidCode(plan.mermaid) : null;
  if (mermaid) {
    plan.mermaid = mermaid;
    if (!plan.renderMode || plan.renderMode === 'image') plan.renderMode = 'mermaid';
  }

  if (plan.renderMode === 'chartSpec' && plan.chartSpec === undefined) {
    return null;
  }

  return plan;
};

const stringifyChartSpec = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed;
  }
  const record = asRecord(value);
  if (!record) return null;
  try {
    return JSON.stringify(record, null, 2);
  } catch {
    return null;
  }
};

const getVisualPlanCandidate = (node: ExecutionNode, variables: Record<string, any>): unknown => {
  const nodeMetadata = asRecord(node.metadata);
  if (nodeMetadata?.visualPlan) return nodeMetadata.visualPlan;

  const toolArgs = asRecord(node.toolBinding?.arguments);
  if (toolArgs?.visualPlan) return toolArgs.visualPlan;
  if (toolArgs?.visual) return toolArgs.visual;
  if (variables && typeof variables === 'object') {
    const vars = variables as Record<string, unknown>;
    if (vars.visualPlan) return vars.visualPlan;
  }
  return null;
};

export const resolveVisualPlanForNode = (
  node: ExecutionNode,
  variables: Record<string, any>,
  expectedType: ArtifactType
): VisualPlan | null => {
  const explicit = normalizeVisualPlan(getVisualPlanCandidate(node, variables));
  if (explicit) return explicit;

  // Always check for embedded Mermaid code in the description, regardless of expected type.
  // This catches cases where the planner classified a node as 'text' but the description
  // actually contains Mermaid syntax (e.g., "flowchart TD\n  A --> B").
  const descriptionMermaid = extractMermaidCode(node.description || '');
  if (descriptionMermaid) {
    return {
      renderMode: 'mermaid',
      mermaid: descriptionMermaid
    };
  }

  return null;
};

type VisualImageRequest = {
  prompt: string;
  style: string;
  aspectRatio: VisualAspectRatio;
};

export type VisualExecutionDecision = {
  mode: VisualRenderMode;
  artifactType: 'image' | 'diagram' | 'chart';
  content: string | null;
  mimeType: string | null;
  imageRequest: VisualImageRequest | null;
  visualPlan: VisualPlan;
};

const defaultStyleByType = (type: 'image' | 'diagram' | 'chart'): string => {
  if (type === 'diagram') {
    return 'modern technical diagram, clean architecture blocks, precise connectors, high legibility, subtle gradients';
  }
  if (type === 'chart') {
    return 'publication-quality analytical chart, clean grid, high contrast labels, enterprise dashboard aesthetic';
  }
  return 'modern technical illustration, clean enterprise diagram, subtle gradients';
};

const defaultAspectRatioByType = (type: 'image' | 'diagram' | 'chart'): VisualAspectRatio => {
  if (type === 'chart') return '16:9';
  if (type === 'diagram') return '16:9';
  return '4:3';
};

const normalizeArtifactVisualPlan = (artifact: Artifact, fallback: VisualPlan | null): VisualPlan | null => {
  const own = normalizeVisualPlan(artifact.metadata?.visualPlan);
  if (own) return own;
  if (fallback) return fallback;
  if (artifact.type === 'diagram') {
    const mermaid = extractMermaidCode(artifact.content || '');
    if (mermaid) return { renderMode: 'mermaid', mermaid };
  }
  if (artifact.type === 'chart') {
    const chartSpec = stringifyChartSpec(artifact.content);
    if (chartSpec) return { renderMode: 'chartSpec', chartSpec, chartSpecFormat: 'json' };
  }
  if (artifact.type === 'image') return { renderMode: 'image' };
  return null;
};

const resolveNodeSpecificSystemInstruction = (node: ExecutionNode): string => {
  if (!node.metadata || typeof node.metadata !== 'object' || Array.isArray(node.metadata)) {
    return '';
  }
  const metadata = node.metadata as Record<string, unknown>;
  const value = metadata.systemInstruction;
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed;
};

export const buildVisualExecutionDecision = (input: {
  node: ExecutionNode;
  dependencyContext: string;
  expectedType: ArtifactType;
  visualPlan: VisualPlan | null;
}): VisualExecutionDecision => {
  const { node, dependencyContext, expectedType, visualPlan } = input;
  const artifactType = toVisualArtifactType(expectedType);

  if (visualPlan?.renderMode === 'mermaid') {
    const mermaid = extractMermaidCode(String(visualPlan.mermaid || ''));
    if (mermaid) {
      return {
        mode: 'mermaid',
        artifactType: 'diagram',
        content: mermaid,
        mimeType: 'text/plain',
        imageRequest: null,
        visualPlan: { ...visualPlan, renderMode: 'mermaid', mermaid }
      };
    }
  }

  if (visualPlan?.renderMode === 'chartSpec') {
    const chartSpec = stringifyChartSpec(visualPlan.chartSpec);
    if (chartSpec) {
      return {
        mode: 'chartSpec',
        artifactType: 'chart',
        content: chartSpec,
        mimeType: 'application/json',
        imageRequest: null,
        visualPlan: {
          ...visualPlan,
          renderMode: 'chartSpec',
          chartSpec,
          chartSpecFormat: visualPlan.chartSpecFormat || 'json'
        }
      };
    }
  }

  const prompt = [
    `Title: ${node.name}`,
    dependencyContext,
    `Spec:\n${node.description}`,
    visualPlan?.prompt ? `Visual Prompt:\n${visualPlan.prompt}` : '',
    node.toolBinding ? `Tool params:\n${JSON.stringify(node.toolBinding.arguments)}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');

  const style = typeof visualPlan?.style === 'string' && visualPlan.style.trim()
    ? visualPlan.style.trim()
    : defaultStyleByType(artifactType);
  const aspectRatio = visualPlan?.aspectRatio || defaultAspectRatioByType(artifactType);

  return {
    mode: 'image',
    artifactType,
    content: null,
    mimeType: null,
    imageRequest: {
      prompt,
      style,
      aspectRatio
    },
    visualPlan: {
      ...(visualPlan || {}),
      renderMode: 'image',
      style,
      aspectRatio
    }
  };
};

const isImageLikeNode = (node: ExecutionNode): boolean => {
  const t = node.outputType;
  const m = node.modality;
  return (
    m === 'image' ||
    m === 'diagram' ||
    t === 'image' ||
    t === 'diagram' ||
    t === 'chart'
  );
};

const buildDependencyContext = (node: ExecutionNode, context: ExecutionContextState): string => {
  const deps = node.dependencies ?? [];
  if (deps.length === 0) return '';

  const lines: string[] = [];
  for (const depId of deps) {
    const depNode = context.nodes[depId];
    const payload = depNode?.result;
    if (payload == null) continue;
    const snippet =
      typeof payload === 'string'
        ? payload.slice(0, 1000)
        : JSON.stringify(payload).slice(0, 1000);
    lines.push(`- ${depId}: ${snippet}`);
  }

  if (lines.length === 0) return '';
  return ['Inputs from dependencies:', ...lines].join('\n');
};

const buildToolList = (node: ExecutionNode, context: ExecutionContextState): any[] | undefined => {
  let tools = node.tools ?? [];
  
  // Enforce boundary if present
  if (context.boundary && Array.isArray(context.boundary.allowedTools)) {
    if (context.boundary.allowedTools.length > 0) {
      tools = tools.filter(t => context.boundary!.allowedTools.includes(t));
    }
  }

  if (tools.length === 0) return undefined;

  // NOTE: We are using the Gemini API (NOT Vertex). The Gemini API tool surface in @google/genai
  // currently supports `googleSearch` and `codeExecution` here.
  // We intentionally DO NOT send unknown tool types (e.g. `fileSearch`, `urlContext`) to the API,
  // because it can hard-fail the request. File search is handled via our own retrieval step.
  const list: any[] = [];
  for (const t of tools) {
    if (t === 'googleSearch') list.push({ googleSearch: {} });
    if (t === 'codeExecution') list.push({ codeExecution: {} });
  }
  return list.length > 0 ? list : undefined;
};

const buildFileSearchContext = async (node: ExecutionNode, variables: Record<string, any>): Promise<{
  contextText: string;
  meta: Record<string, unknown>;
} | null> => {
  const wantsFileSearch =
    (node.toolBinding?.toolName === 'fileSearch') ||
    (Array.isArray(node.tools) && node.tools.includes('fileSearch'));
  if (!wantsFileSearch) return null;

  const toolArgs = (node.toolBinding?.arguments && typeof node.toolBinding.arguments === 'object')
    ? (node.toolBinding.arguments as Record<string, any>)
    : {};

  const storeNamesRaw =
    (Array.isArray(toolArgs.fileSearchStoreNames) ? toolArgs.fileSearchStoreNames : null) ||
    (Array.isArray(variables.fileSearchStoreNames) ? variables.fileSearchStoreNames : null) ||
    [];
  const storeNames = storeNamesRaw.map((s: any) => String(s || '').trim()).filter(Boolean);
  if (storeNames.length === 0) return null;

  const query =
    (typeof toolArgs.query === 'string' && toolArgs.query.trim()) ||
    (typeof variables.intent === 'string' ? `${variables.intent}\n\n${node.description}` : node.description);
  const limit = Math.max(1, Math.min(10, Number(toolArgs.limit ?? 8)));

  const hits: Array<{ id: string; text?: string; metadata?: Record<string, any>; workspaceId: string }> = [];
  for (const ws of storeNames) {
    const res = await semanticSearch({ workspaceId: ws, query, limit });
    for (const h of res) {
      hits.push({
        id: String(h.id),
        text: typeof h.text === 'string' ? h.text : undefined,
        metadata: (h.metadata && typeof h.metadata === 'object') ? (h.metadata as Record<string, any>) : undefined,
        workspaceId: ws,
      });
    }
  }

  const pruned = hits
    .filter(h => typeof h.text === 'string' && h.text.trim().length > 0)
    .slice(0, 10);
  if (pruned.length === 0) return null;

  const blocks = pruned.map((h, idx) => {
    const fileName = h.metadata?.fileName || h.metadata?.name || h.metadata?.fileKey || h.id;
    const chunkIndex = h.metadata?.chunkIndex;
    const chunkSuffix = typeof chunkIndex === 'number' ? ` (chunk ${chunkIndex})` : '';
    const snippet = String(h.text || '').trim().slice(0, 1200);
    return `[${idx + 1}] ${String(fileName)}${chunkSuffix}\n${snippet}`;
  });

  return {
    contextText: ['File Search Results (user-provided files):', ...blocks].join('\n\n'),
    meta: {
      fileSearch: {
        stores: storeNames,
        query,
        hitCount: pruned.length,
        hitIds: pruned.map(h => h.id),
      },
    },
  };
};

const arrayBufferToBase64 = (buf: ArrayBuffer): string => {
  if (typeof Buffer !== 'undefined') return Buffer.from(buf).toString('base64');

  const uint8 = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < uint8.length; i += chunkSize) {
    const chunk = uint8.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }

  const btoaFn =
    typeof window !== 'undefined' && typeof window.btoa === 'function'
      ? window.btoa
      : (globalThis as any).btoa;
  if (typeof btoaFn !== 'function') throw new Error('Base64 encoding is not available in this environment.');
  return btoaFn(binary);
};

const normalizeToolArguments = (args: unknown): Record<string, any> => {
  const record = asRecord(args);
  return record ? (record as Record<string, any>) : {};
};

const coerceToolOutputArtifacts = (input: {
  node: ExecutionNode;
  toolName: string;
  toolArgs: Record<string, any>;
  output: unknown;
}): Artifact[] => {
  const { node, toolName, toolArgs, output } = input;
  const outputRecord = asRecord(output);

  let artifacts: Artifact[] | null = null;
  if (outputRecord?.artifacts && Array.isArray(outputRecord.artifacts)) {
    const parsed = FulfillmentSchema.safeParse({ artifacts: outputRecord.artifacts });
    if (parsed.success) artifacts = parsed.data.artifacts as Artifact[];
  }

  if (!artifacts && outputRecord && typeof outputRecord.type === 'string' && typeof outputRecord.content === 'string') {
    const declaredType = outputRecord.type as ArtifactType;
    if (ARTIFACT_TYPES.includes(declaredType)) {
      artifacts = [
        {
          type: declaredType,
          content: String(outputRecord.content),
          ...(typeof outputRecord.title === 'string' ? { title: outputRecord.title } : {}),
          ...(typeof outputRecord.language === 'string' ? { language: outputRecord.language } : {}),
          ...(typeof outputRecord.mimeType === 'string' ? { mimeType: outputRecord.mimeType } : {}),
          ...(asRecord(outputRecord.metadata) ? { metadata: outputRecord.metadata as Record<string, unknown> } : {})
        }
      ];
    }
  }

  if (!artifacts || artifacts.length === 0) {
    const expectedType = node.outputType ?? 'json';
    const fallbackType: ArtifactType =
      expectedType === 'text' || expectedType === 'report'
        ? (typeof output === 'string' ? expectedType : 'json')
        : expectedType;
    const type = ARTIFACT_TYPES.includes(fallbackType) ? fallbackType : 'text';
    const content =
      typeof output === 'string'
        ? output
        : JSON.stringify(output ?? null, null, 2);

    artifacts = [
      {
        type,
        title: node.name,
        content,
        ...(type === 'json' ? { mimeType: 'application/json' } : {})
      }
    ];
  }

  return artifacts.map((artifact, idx) => ({
    ...artifact,
    metadata: {
      ...(artifact.metadata || {}),
      nodeId: node.id,
      toolDispatch: 'registry',
      toolName,
      ...(idx === 0 ? { toolArgs } : {})
    }
  }));
};

export class GeminiToolExecutor {
  private readonly registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  private buildRegistryExecutionContext(
    node: ExecutionNode,
    context: ExecutionContextState,
    variables: Record<string, any>
  ): ExecutionContext {
    const variableMap = new Map<string, any>(Object.entries(variables || {}));
    variableMap.set('__nodeId', node.id);
    variableMap.set('__nodeName', node.name);
    for (const depId of node.dependencies ?? []) {
      const dep = context.nodes[depId];
      if (!dep) continue;
      variableMap.set(`dep_${depId}`, dep.result ?? null);
    }

    const hasFailures = Object.values(context.nodes).some((entry) => entry?.status === 'failed');
    const stepCount = Math.max(0, context.provenance?.length || 0);
    const maxSteps = Math.max(128, stepCount + 16);

    return {
      variables: variableMap,
      state: hasFailures ? 'DEGRADED' : 'RUNNING',
      tape: [],
      headPosition: 0,
      stepCount,
      maxSteps
    };
  }

  private async tryExecuteRegistryBoundTool(
    node: ExecutionNode,
    context: ExecutionContextState,
    variables: Record<string, any>,
    startTime: number
  ): Promise<Partial<NodeExecutionState> | null> {
    const binding = node.toolBinding;
    const toolName = String(binding?.toolName || '').trim();
    if (!toolName) return null;
    if (RESERVED_TOOL_BINDINGS.has(toolName)) return null;

    if (context.boundary && Array.isArray(context.boundary.allowedTools) && context.boundary.allowedTools.length > 0) {
      if (!context.boundary.allowedTools.includes(toolName)) {
        return {
          status: 'failed',
          error: `Tool execution denied by ExecutionBoundary: '${toolName}' is not in allowedTools list.`,
          startTime,
          endTime: Date.now(),
          attempts: 1
        };
      }
    }

    const args = normalizeToolArguments(binding?.arguments);
    const registeredTool = this.registry.getTool(toolName);
    if (!registeredTool) {
      return {
        status: 'failed',
        error: `Custom tool '${toolName}' is not registered in ToolRegistry.`,
        startTime,
        endTime: Date.now(),
        attempts: 1
      };
    }

    try {
      const execContext = this.buildRegistryExecutionContext(node, context, variables);
      const execution = await this.registry.executeTool(toolName, args, execContext);
      const artifacts = coerceToolOutputArtifacts({
        node,
        toolName,
        toolArgs: args,
        output: execution?.output
      });

      return {
        status: 'completed',
        result: execution?.output,
        artifacts,
        startTime,
        endTime: Date.now(),
        attempts: 1
      };
    } catch (error: any) {
      return {
        status: 'failed',
        error: `Custom tool '${toolName}' execution failed: ${error?.message || String(error)}`,
        startTime,
        endTime: Date.now(),
        attempts: 1
      };
    }
  }

  /**
   * Executes a node using model routing based on node output modality.
   * Uses AST-provided routing + tool config (0x5D9B2F1A).
   */
  async executeGeminiNode(
    node: ExecutionNode,
    context: ExecutionContextState,
    variables: Record<string, any>
  ): Promise<Partial<NodeExecutionState>> {
    const startTime = Date.now();

    try {
      const directToolDispatch = await this.tryExecuteRegistryBoundTool(node, context, variables, startTime);
      if (directToolDispatch) return directToolDispatch;

      const config = await getModelConfig();
      const dependencyContext = buildDependencyContext(node, context);
      const expectedType = node.outputType ?? (isImageLikeNode(node) ? 'image' : 'text');
      const preferredPrimaryType = choosePrimaryArtifactType(node, expectedType);
      const strictJsonRequired = expectedType === 'json' && preferredPrimaryType === 'json';
      const tools = buildToolList(node, context);
      const fileSearch = await buildFileSearchContext(node, variables).catch(() => null);
      const fallbackVisualPlan = resolveVisualPlanForNode(node, variables, expectedType);

      if (isImageLikeNode(node)) {
        const decision = buildVisualExecutionDecision({
          node,
          dependencyContext,
          expectedType,
          visualPlan: fallbackVisualPlan
        });
        const baseMetadata = {
          nodeId: node.id,
          visualPlan: decision.visualPlan
        };

        if (decision.mode === 'mermaid' && decision.content) {
          const artifacts: Artifact[] = [
            {
              type: decision.artifactType,
              content: decision.content,
              title: node.name,
              mimeType: decision.mimeType || 'text/plain',
              metadata: baseMetadata
            }
          ];

          return {
            status: 'completed',
            result: { type: artifacts[0]!.type, mode: 'mermaid' },
            artifacts,
            startTime,
            endTime: Date.now(),
            attempts: 1
          };
        }

        if (decision.mode === 'chartSpec' && decision.content) {
          const artifacts: Artifact[] = [
            {
              type: decision.artifactType,
              content: decision.content,
              title: node.name,
              mimeType: decision.mimeType || 'application/json',
              metadata: baseMetadata
            }
          ];

          return {
            status: 'completed',
            result: { type: artifacts[0]!.type, mode: 'chartSpec' },
            artifacts,
            startTime,
            endTime: Date.now(),
            attempts: 1
          };
        }

        if (!decision.imageRequest) {
          throw new Error('Visual decision expected an image request but none was produced.');
        }

        const endpoint = '/api/generateartifactimage';
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: node.name,
            prompt: decision.imageRequest.prompt,
            style: decision.imageRequest.style,
            aspectRatio: decision.imageRequest.aspectRatio
          })
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => 'Unknown error');
          throw new Error(`Image endpoint failed (${response.status}): ${errText}`);
        }

        const imageBuffer = await response.arrayBuffer();
        const base64Image = arrayBufferToBase64(imageBuffer);
        const mimeType = response.headers.get('content-type') || 'image/png';
        const modelHeader = response.headers.get('x-artifact-image-model') || undefined;

        const dataUrl = `data:${mimeType};base64,${base64Image}`;
        const artifacts: Artifact[] = [
          {
            type: decision.artifactType,
            content: dataUrl,
            title: node.name,
            mimeType,
            metadata: {
              nodeId: node.id,
              prompt: decision.imageRequest.prompt,
              visualPlan: decision.visualPlan,
              ...(modelHeader ? { model: modelHeader } : {})
            }
          }
        ];

        return {
          status: 'completed',
          result: { type: artifacts[0]!.type, url: dataUrl },
          artifacts,
          startTime,
          endTime: Date.now(),
          attempts: 1
        };
      }

      const client = new GoogleGenAI({ apiKey: config.apiKey });
      const baseSystemInstruction = [
        'You are executing a single protocol node and must produce final artifacts.',
        'Return ONLY valid JSON (no markdown, no code fences) matching this TypeScript shape:',
        '{ artifacts: Array<{ type: "text"|"code"|"json"|"html"|"report"|"table"|"audio"|"video"|"file"|"diagram"|"chart"|"image", title?: string, content: string, language?: string, mimeType?: string, metadata?: object }> }',
        'Rules:',
        `- The first artifact MUST have type "${preferredPrimaryType}".`,
        '- content must be non-empty.',
        '- If type="json", content must be valid JSON string.',
        '- Prefer human-readable outputs for narrative content: markdown in type="report" (or type="text"), and semantic HTML in type="html".',
        '- Avoid raw JSON for stakeholder-facing summaries unless strict machine-readable JSON is explicitly required.',
        '- If type="audio" or "video", prefer a direct URL/data URI in content and set mimeType when known.',
        '- For visual artifacts (image|diagram|chart), include metadata.visualPlan when available.',
        '- If you used Google Search, ensure the response is grounded and include citations via the API grounding metadata (no manual footnote formatting needed).'
      ];
      const nodeSpecificSystemInstruction = resolveNodeSpecificSystemInstruction(node);
      const systemInstruction = [
        ...baseSystemInstruction,
        ...(nodeSpecificSystemInstruction
          ? ['', 'Node-specific system constraints:', nodeSpecificSystemInstruction]
          : []),
        ...(context.boundary?.restrictedDataCategories?.length
          ? ['', 'CRITICAL DATA CONSTRAINTS (ExecutionBoundary): Do not include or process data matching the following categories: ' + context.boundary.restrictedDataCategories.join(', ')]
          : []),
      ].join('\n');

      const userPrompt = [
        `Node: ${node.name}`,
        `Expected primary type: ${preferredPrimaryType}`,
        strictJsonRequired ? 'JSON mode: strict machine-readable JSON required.' : 'Output mode: stakeholder-readable markdown/HTML preferred.',
        dependencyContext,
        fileSearch?.contextText,
        `Context Variables:\n${JSON.stringify(variables).slice(0, 5000)}`,
        `Spec:\n${node.description}`,
        node.toolBinding ? `Tool params:\n${JSON.stringify(node.toolBinding.arguments)}` : ''
      ]
        .filter(Boolean)
        .join('\n\n');

      const executionModel = selectExecutionModelForNode(
        node,
        expectedType,
        preferredPrimaryType,
        config.simulationModel
      );

      const response = await generateGeminiContentWithRateControl({
        client,
        context: `gemini-node:${node.id}`,
        request: {
          model: executionModel,
          contents: [
            { role: 'system', parts: [{ text: systemInstruction }] },
            { role: 'user', parts: [{ text: userPrompt }] }
          ],
          config: {
            temperature: 0.2,
            candidateCount: 1,
            responseMimeType: 'application/json',
            maxOutputTokens: context.boundary?.maxTokens ?? undefined,
            ...(tools ? { tools } : {})
          }
        }
      });

      const rawText = collectNonThoughtText(response);
      const candidate = (response as any)?.candidates?.[0];
      const groundingMetadata = candidate?.groundingMetadata;
      const urlContextMetadata = candidate?.urlContextMetadata;

      // Code execution parts (optional)
      const parts: any[] = candidate?.content?.parts ?? [];
      const exec = parts.find(p => p?.executableCode)?.executableCode;
      const execResult = parts.find(p => p?.codeExecutionResult)?.codeExecutionResult;

      let artifacts: Artifact[] = [];
      try {
        const parsedJson = JSON.parse(getJsonCandidate(rawText));
        const validated = FulfillmentSchema.parse(parsedJson);
        artifacts = validated.artifacts as Artifact[];
      } catch {
        artifacts = parseArtifactsFromLegacyMarkers(rawText, node.name);
        if (artifacts.length === 0) artifacts = parseArtifactsFromCodeFences(rawText);
        if (artifacts.length === 0 && rawText.trim()) {
          artifacts = [{ type: preferredPrimaryType, title: node.name, content: rawText.trim() }];
        }
      }

      artifacts = normalizeArtifactsForPreferredOutput({
        node,
        artifacts,
        expectedType,
        preferredPrimaryType,
        strictJsonRequired,
      });

      // Attach provenance/tool metadata to the first artifact (and ensure nodeId is preserved).
      const meta: Record<string, unknown> = {
        nodeId: node.id,
        model: executionModel,
        tools: node.tools ?? [],
        ...(groundingMetadata ? { groundingMetadata } : {}),
        ...(urlContextMetadata ? { urlContextMetadata } : {}),
        ...(fileSearch?.meta ? fileSearch.meta : {})
      };

      artifacts = artifacts.map((a, idx) => ({
        ...a,
        metadata: {
          ...(a.metadata || {}),
          ...(idx === 0 ? meta : { nodeId: node.id }),
          ...(() => {
            const visualPlan = normalizeArtifactVisualPlan(a, fallbackVisualPlan);
            return visualPlan ? { visualPlan } : {};
          })()
        }
      }));

      if (exec?.code) {
        artifacts.push({
          type: 'code',
          title: 'Executable code',
          content: String(exec.code),
          language: String(exec.language || 'python'),
          metadata: { nodeId: node.id, tool: 'codeExecution' }
        });
      }
      if (execResult?.output) {
        artifacts.push({
          type: 'text',
          title: 'Code execution output',
          content: String(execResult.output),
          metadata: { nodeId: node.id, tool: 'codeExecution', outcome: execResult.outcome }
        });
      }

      return {
        status: 'completed',
        result: rawText,
        artifacts,
        startTime,
        endTime: Date.now(),
        attempts: 1
      };

    } catch (error: any) {
      const message = error?.message || 'Unknown execution error';
      if (isRetriableExecutionError(error)) {
        console.warn('Gemini Execution transient failure (eligible for retry):', {
          status: extractHttpStatus(error),
          error: message
        });
      } else {
        console.error('Gemini Execution Failed:', error);
      }
      return {
        status: 'failed',
        error: message,
        startTime,
        endTime: Date.now(),
        attempts: 1
      };
    }
  }
}
