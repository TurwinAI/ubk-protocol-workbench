import Ajv, { type ErrorObject } from 'ajv';
import type { JSONSchema7 } from 'json-schema';
import { GoogleGenAI } from '@google/genai';
import type { CompositeDocAst, CompositeDocNode, GeminiBuiltInTool } from './types';
import { extractText } from './responseHelper';
import { getModelConfig } from '../../config/modelConfig';
import type { ExecutionBoundary } from '../acp/contracts/ExecutionBoundaryContract';
import { generateGeminiContentWithRateControl } from './geminiRateControl';

const COMPOSITE_DOC_AST_SCHEMA: JSONSchema7 = {
  type: 'object',
  additionalProperties: true,
  required: ['id', 'createdAt', 'nodes'],
  properties: {
    id: { type: 'string', minLength: 1 },
    title: { type: 'string' },
    createdAt: { type: 'string', minLength: 4 },
    nodes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['id', 'type', 'status', 'spec'],
        properties: {
          id: { type: 'string', minLength: 1 },
          type: {
            type: 'string',
            enum: ['text', 'code', 'json', 'html', 'image', 'diagram', 'chart', 'table', 'audio', 'video', 'file', 'report']
          },
          title: { type: 'string' },
          status: { type: 'string', enum: ['planned', 'fulfilling', 'fulfilled', 'failed'] },
          placeholder: { type: 'string' },
          spec: { type: 'string', minLength: 1 },
          dependsOn: {
            type: 'array',
            items: { type: 'string' }
          },
          toolBinding: {
            type: 'object',
            additionalProperties: false,
            required: ['toolName', 'arguments'],
            properties: {
              toolName: { type: 'string' },
              arguments: { type: 'object' }
            }
          },
          tools: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['googleSearch', 'urlContext', 'codeExecution', 'fileSearch']
            }
          },
          metadata: { type: 'object' }
        }
      }
    },
    metadata: { type: 'object' }
  }
};

const getJsonCandidate = (raw: string): string => {
  if (!raw) return raw;
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    return text.slice(first, last + 1);
  }
  return text;
};

const formatAjvErrors = (errors: ErrorObject[] | null | undefined): string => {
  if (!errors || errors.length === 0) return 'Unknown schema error';
  return errors
    .map(e => `${e.instancePath || '(root)'} ${e.message || 'invalid'}${e.params ? ` (${JSON.stringify(e.params)})` : ''}`)
    .join('\n');
};

const GEMINI_BUILTIN_TOOLS: GeminiBuiltInTool[] = ['googleSearch', 'urlContext', 'codeExecution', 'fileSearch'];

const isGeminiBuiltInTool = (value: string): value is GeminiBuiltInTool =>
  (GEMINI_BUILTIN_TOOLS as string[]).includes(value);

const expectsHtmlOutput = (text: string): boolean =>
  /\b(html|web\s?page|landing\s?page|ui\s?preview|rendered\s?page)\b/i.test(text || '');

const expectsJsonOutput = (text: string): boolean =>
  [
    /\bstrict\s+json\b/i,
    /\bjson\s+(schema|object|array|payload|document|response|artifact|output)\b/i,
    /\bmachine[-\s]?readable\b/i,
    /\bprogrammatic\b/i,
    /\bapi\b.{0,40}\b(payload|response|contract|request|json)\b/i,
    /\b(consumed|ingested|parsed)\b.{0,40}\b(parser|automation|api|system|script)\b/i,
  ].some((pattern) => pattern.test(text || ''));

const prefersReportOutput = (text: string): boolean =>
  [
    /\breport\b/i,
    /\bsummary\b/i,
    /\bbrief\b/i,
    /\bexecutive\b/i,
    /\brecommendation(s)?\b/i,
    /\bstakeholder(s)?\b/i,
    /\bnarrative\b/i,
    /\bwrite[-\s]?up\b/i,
    /\bdocument\b/i,
  ].some((pattern) => pattern.test(text || ''));

const chooseReadableNodeType = (node: CompositeDocNode): CompositeDocNode['type'] => {
  const text = `${node.title || ''}\n${node.spec || ''}`.trim();
  if (expectsHtmlOutput(text)) return 'html';
  if (prefersReportOutput(text)) return 'report';
  return 'text';
};

export const normalizeNodeTypeForReadableOutput = (node: CompositeDocNode): CompositeDocNode => {
  if (node.type !== 'json') return node;

  const text = `${node.title || ''}\n${node.spec || ''}`.trim();
  if (expectsJsonOutput(text)) return node;

  return {
    ...node,
    type: chooseReadableNodeType(node),
  };
};

const normalizeAst = (ast: CompositeDocAst): CompositeDocAst => {
  const nowIso = new Date().toISOString();
  const id = ast.id?.trim() ? ast.id : `ast_${Date.now()}`;
  const createdAt = ast.createdAt?.trim() ? ast.createdAt : nowIso;
  const title = (ast.title || 'Protocol Execution').trim();
  const nodes = Array.isArray(ast.nodes) ? ast.nodes : [];

  // Ensure unique node IDs; if duplicates exist, suffix them.
  const seen = new Map<string, number>();
  const normalizedNodes = nodes.map((n, idx) => {
    const baseId = (n.id || `node_${idx + 1}`).trim();
    const count = (seen.get(baseId) ?? 0) + 1;
    seen.set(baseId, count);
    const finalId = count > 1 ? `${baseId}_${count}` : baseId;
    const toolsRaw = Array.isArray(n.tools) ? (n.tools as unknown[]) : [];
    const tools = Array.from(
      new Set(
        toolsRaw
          .map(t => String(t).trim())
          .filter(Boolean)
          .filter(isGeminiBuiltInTool)
      )
    );
    const normalizedNode: CompositeDocNode = {
      ...n,
      id: finalId,
      title: n.title?.trim() ? n.title : finalId,
      status: (n.status as any) || 'planned',
      placeholder: n.placeholder ?? 'Queued',
      spec: (n.spec || '').trim(),
      ...(tools.length > 0 ? { tools } : {})
    };

    return normalizeNodeTypeForReadableOutput(normalizedNode);
  });

  // Drop invalid dependencies (only keep ids present in final list).
  const validIds = new Set(normalizedNodes.map(n => n.id));
  for (const n of normalizedNodes) {
    if (Array.isArray((n as any).dependsOn)) {
      (n as any).dependsOn = (n as any).dependsOn.filter((dep: string) => validIds.has(dep));
    }
  }

  return {
    ...ast,
    id,
    title,
    createdAt,
    nodes: normalizedNodes,
    metadata: {
      ...(ast.metadata || {}),
      schema: 'turwin.composite_doc_ast.v1'
    }
  };
};

export const planCompositeDocAstWithGemini = async (input: {
  intent: string;
  recipeText: string;
  titleHint?: string;
  maxNodes?: number;
  fileSearchStoreNames?: string[];
  boundary?: ExecutionBoundary;
  agentId?: string;
  apiKey?: string;
}): Promise<CompositeDocAst> => {
  const { intent, recipeText, titleHint, maxNodes = 8, fileSearchStoreNames, boundary, apiKey } = input;
  const config = await getModelConfig(apiKey);

  if (!config.apiKey) {
    throw new Error('GEMINI_API_KEY is required for live CompositeDoc AST planning.');
  }

  const client = new GoogleGenAI({ apiKey: config.apiKey });

  const recipeSnippet = recipeText.trim().slice(0, 12_000);
  const schemaJson = JSON.stringify(COMPOSITE_DOC_AST_SCHEMA);
  const fileSearchStores = Array.isArray(fileSearchStoreNames) ? fileSearchStoreNames.filter(Boolean) : [];
  const fileSearchHint =
    fileSearchStores.length > 0
      ? `\nFile Search Stores available for this chat/session:\n${JSON.stringify(fileSearchStores)}\n\nIf you need to use user-provided files/attachments, add BOTH:\n- tools: ["fileSearch"]\n- toolBinding: { toolName: "fileSearch", arguments: { query: string, fileSearchStoreNames: ${JSON.stringify(fileSearchStores)}, limit?: number } }\n`
      : '';

  const learningContext = '';

  const system = `
You are a Composite Document AST planner.
Return ONLY valid JSON (no markdown, no code fences) that conforms to the provided JSON Schema.
Every node MUST include a self-contained "spec" that can be executed independently.
Keep the node count <= ${maxNodes}. Prefer 3-7 nodes unless the protocol truly requires more.
You may assign built-in Gemini tools per node using the "tools" array.
`.trim();

  const user = `
User intent:
${intent}

Verified protocol/recipe (may be truncated):
${recipeSnippet}
${learningContext}
Constraints:
- Use this exact node type enum: text|code|json|html|image|diagram|chart|table|audio|video|file|report
- Prefer human-readable outputs by default:
  - Use "report" for narrative/executive content (markdown-friendly).
  - Use "text" for concise plain-language outputs.
  - Use "html" only when webpage/UI output is explicitly requested.
  - Use "json" only when machine-readable payloads are explicitly required.
- Set all node.status = "planned"
- Use stable sequential ids: n1, n2, n3, ...
- If a node depends on previous nodes, set dependsOn to those ids.
- If a node requires external retrieval or computation, set tools to any of:
  - "googleSearch" (up- facts, citations)
  - "urlContext" (use URLs included in the spec)
  - "codeExecution" (math, data transforms, verification)
  - "fileSearch" (search user-provided files; include store names in toolBinding arguments)
- If you propose custom tool usage, include toolBinding { toolName, arguments } (optional).
${boundary && boundary.allowedTools.length > 0 ? `- CRITICAL: ONLY use tools from this allowed list: ${boundary.allowedTools.join(', ')}` : ''}
${boundary && boundary.restrictedDataCategories.length > 0 ? `- CRITICAL DATA CONSTRAINTS: Do not include or process data matching the following categories: ${boundary.restrictedDataCategories.join(', ')}` : ''}
${fileSearchHint}

JSON Schema (must conform):
${schemaJson}

Return the CompositeDocAst JSON now.
`.trim();

  const attemptGenerate = async (prompt: { system: string; user: string }) => {
    const response = await generateGeminiContentWithRateControl({
      client,
      context: 'ast-planner',
      request: {
        model: config.simulationModel,
        contents: [
          { role: 'system', parts: [{ text: prompt.system }] },
          { role: 'user', parts: [{ text: prompt.user }] }
        ],
        config: {
          temperature: 0.2,
          candidateCount: 1,
          responseMimeType: 'application/json'
        }
      }
    });

    const raw = extractText(response) || '';
    const jsonCandidate = getJsonCandidate(raw);
    const parsed = JSON.parse(jsonCandidate) as CompositeDocAst;
    return { parsed, raw, jsonCandidate };
  };

  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(COMPOSITE_DOC_AST_SCHEMA as any);

  try {
    const { parsed } = await attemptGenerate({ system, user });
    const normalized = normalizeAst(parsed);
    const ok = validate(normalized) as boolean;
    if (ok) return normalized;
    const errText = formatAjvErrors(validate.errors);
    throw new Error(`AST validation failed:\n${errText}`);
  } catch (firstError: any) {
    // One repair attempt with schema errors (if any)
    const errText = firstError?.message ? String(firstError.message) : String(firstError);
    const repairSystem = `
You are a JSON repair engine.
Return ONLY valid JSON that conforms to the provided JSON Schema.
Do not include markdown, comments, or trailing text.
`.trim();

    const repairUser = `
The previous output failed validation or JSON parsing.
Error:
${errText}

Re-emit a corrected CompositeDocAst JSON that conforms to the schema below.
Make sure every node has: id, type, status="planned", spec (non-empty).
Use ids n1..nK and keep node count <= ${maxNodes}.

JSON Schema:
${schemaJson}
`.trim();

    const { parsed: repaired } = await attemptGenerate({ system: repairSystem, user: repairUser });
    const normalized = normalizeAst(repaired);
    const ok = validate(normalized) as boolean;
    if (!ok) {
      const vErr = formatAjvErrors(validate.errors);
      throw new Error(`AST repair validation failed:\n${vErr}`);
    }
    return normalized;
  }
};
