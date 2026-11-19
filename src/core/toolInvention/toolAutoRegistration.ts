import type { JSONSchema7, JSONSchema7Definition } from 'json-schema';

import type { ExecutionPlan } from '../execution/planBuilder';
import { extractMermaidCode } from '../../lib/mermaid';
import type { ToolCallback, ToolDefinition, ToolRegistry } from './ToolRegistry';

const SAFE_TOOL_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{1,63}$/;
const SAFE_PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const SAFE_TYPE_SET = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);
const MAX_TOOL_PROPERTIES = 24;
const MAX_AUTO_REGISTERED_TOOLS = 40;
const SAFE_IMAGE_ASPECT_RATIOS = new Set(['1:1', '3:4', '4:3', '16:9', '9:16']);
const RESERVED_TOOL_NAMES = new Set(['fileSearch', 'googleSearch', 'codeExecution', 'urlContext', '__audit', '__audit__']);
const UNSAFE_TOOL_NAMES = new Set(['constructor', 'prototype', '__proto__']);

type ToolCallbackKind =
  | 'http_request_callback'
  | 'html_parser_callback'
  | 'price_extractor_callback'
  | 'math_average_callback'
  | 'data_processing_callback'
  | 'batch_processing_callback'
  | 'mermaid_diagram_callback'
  | 'artifact_image_callback'
  | 'generic_callback';

type ExtractedToolDefinition = {
  name: string;
  description?: string;
  schema?: unknown;
  callback?: string;
  paramNames?: string[];
  paramSamples?: Record<string, unknown>;
  source: string;
};

type MergedToolDefinition = {
  name: string;
  description: string;
  schemaCandidate: unknown;
  callbackHint: string;
  paramNames: Set<string>;
  paramSamples: Record<string, unknown>;
  sources: Set<string>;
};

export type AutoRegistrationSkipReason =
  | 'invalid_name'
  | 'reserved_name'
  | 'already_registered'
  | 'register_error'
  | 'max_limit_reached';

export interface AutoRegistrationSkip {
  name: string;
  reason: AutoRegistrationSkipReason;
  detail?: string;
}

export interface AutoRegistrationResult {
  extractedCount: number;
  registered: string[];
  skipped: AutoRegistrationSkip[];
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const toNonEmptyString = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const safeJsonParse = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const toDefinitionRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value === 'string') return asRecord(safeJsonParse(value));
  return asRecord(value);
};

const normalizeParamSamples = (value: unknown): Record<string, unknown> => {
  const record = asRecord(value);
  if (!record) return {};

  const output: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(record)) {
    if (!SAFE_PARAM_NAME_RE.test(key)) continue;
    output[key] = entryValue;
    if (Object.keys(output).length >= MAX_TOOL_PROPERTIES) break;
  }
  return output;
};

const normalizeParamNames = (params: Iterable<string>): string[] => {
  return Array.from(new Set(Array.from(params, (param) => param.trim()).filter(Boolean)))
    .filter((param) => SAFE_PARAM_NAME_RE.test(param))
    .slice(0, MAX_TOOL_PROPERTIES);
};

const parseParamNamesFromInlineArgs = (rawArgs: string): string[] => {
  if (!rawArgs.trim()) return [];
  const names: string[] = [];
  for (const part of rawArgs.split(',')) {
    const token = part.trim();
    if (!token) continue;
    const eqIdx = token.indexOf('=');
    const key = eqIdx >= 0 ? token.slice(0, eqIdx).trim() : token;
    if (SAFE_PARAM_NAME_RE.test(key)) names.push(key);
  }
  return normalizeParamNames(names);
};

const extractInlineToolDefinitions = (input: string, source: string): ExtractedToolDefinition[] => {
  const defs: ExtractedToolDefinition[] = [];
  const re = /^\s*(?:[-*]\s*)?Tool:\s*([A-Za-z][A-Za-z0-9_-]{1,63})\s*\(([^)]*)\)/gim;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    defs.push({
      name: match[1] || '',
      paramNames: parseParamNamesFromInlineArgs(match[2] || ''),
      source,
    });
  }
  return defs;
};

const extractLegacyDefineToolDefinitions = (recipeText: string): ExtractedToolDefinition[] => {
  const defs: ExtractedToolDefinition[] = [];
  const nameRe = /Define Tool\s*\([^)]*name:\s*"([^"]+)"[^)]*\)/gim;
  let nameMatch: RegExpExecArray | null;
  while ((nameMatch = nameRe.exec(recipeText)) !== null) {
    const full = nameMatch[0] || '';
    const callbackMatch = /callback:\s*([A-Za-z0-9_.$-]+)/i.exec(full);
    const schemaMatch = /schema:\s*(\{[\s\S]*\})\s*,?\s*callback:/i.exec(full) || /schema:\s*(\{[\s\S]*\})/i.exec(full);
    defs.push({
      name: nameMatch[1] || '',
      callback: callbackMatch?.[1] || '',
      schema: schemaMatch?.[1] ? safeJsonParse(schemaMatch[1]) : null,
      source: 'legacy_define_tool',
    });
  }
  return defs;
};

const extractYamlToolDefinitions = (recipeText: string): ExtractedToolDefinition[] => {
  const defs: ExtractedToolDefinition[] = [];
  const sectionMatch = recipeText.match(/(?:^|\n)Tool Definitions?:\s*\n([\s\S]*?)(?=\n(?:[A-Z][A-Za-z ]{2,32}:|##\s|###\s|$))/i);
  if (!sectionMatch?.[1]) return defs;
  const section = sectionMatch[1];

  const entryRe = /(?:^|\n)-\s*name:\s*([A-Za-z][A-Za-z0-9_-]{1,63})\s*([\s\S]*?)(?=\n-\s*name:|$)/gim;
  let entry: RegExpExecArray | null;
  while ((entry = entryRe.exec(section)) !== null) {
    const body = entry[2] || '';
    const description = /(?:^|\n)\s*description:\s*(.+)$/im.exec(body)?.[1]?.trim() || '';
    const callback = /(?:^|\n)\s*callback:\s*([A-Za-z0-9_.$-]+)/im.exec(body)?.[1]?.trim() || '';
    const schemaText = /(?:^|\n)\s*schema:\s*(\{[\s\S]*?\})\s*(?:\n|$)/im.exec(body)?.[1] || '';
    const schema = schemaText ? safeJsonParse(schemaText) : null;

    defs.push({
      name: entry[1] || '',
      description,
      callback,
      schema,
      source: 'yaml_tool_definitions',
    });
  }

  return defs;
};

const extractAstToolDefinitions = (plan: ExecutionPlan): ExtractedToolDefinition[] => {
  const defs: ExtractedToolDefinition[] = [];
  const astMetadata = asRecord(plan.ast.metadata);
  const metadataLists = [astMetadata?.['toolDefinitions'], astMetadata?.['tools']];

  for (const candidateList of metadataLists) {
    if (!Array.isArray(candidateList)) continue;
    for (const candidate of candidateList) {
      const record = toDefinitionRecord(candidate);
      if (!record) continue;
      const name = toNonEmptyString(record['name']);
      if (!name) continue;
      defs.push({
        name,
        description: toNonEmptyString(record['description']),
        schema: typeof record['schema'] === 'string' ? safeJsonParse(record['schema']) : record['schema'],
        callback: toNonEmptyString(record['callback']),
        paramSamples: normalizeParamSamples(record['arguments']),
        source: 'ast_metadata',
      });
    }
  }

  for (const node of plan.ast.nodes) {
    const nodeMetadata = asRecord(node.metadata);
    const list = nodeMetadata?.['toolDefinitions'];
    if (Array.isArray(list)) {
      for (const candidate of list) {
        const record = toDefinitionRecord(candidate);
        if (!record) continue;
        const name = toNonEmptyString(record['name']);
        if (!name) continue;
        defs.push({
          name,
          description: toNonEmptyString(record['description']) || `Auto-registered from node ${node.id}`,
          schema: typeof record['schema'] === 'string' ? safeJsonParse(record['schema']) : record['schema'],
          callback: toNonEmptyString(record['callback']),
          paramSamples: normalizeParamSamples(record['arguments']),
          source: `ast_node:${node.id}`,
        });
      }
    }

    const single = toDefinitionRecord(nodeMetadata?.['toolDefinition']);
    if (single) {
      const name = toNonEmptyString(single['name']);
      if (name) {
        defs.push({
          name,
          description: toNonEmptyString(single['description']) || `Auto-registered from node ${node.id}`,
          schema: typeof single['schema'] === 'string' ? safeJsonParse(single['schema']) : single['schema'],
          callback: toNonEmptyString(single['callback']),
          paramSamples: normalizeParamSamples(single['arguments']),
          source: `ast_node:${node.id}`,
        });
      }
    }
  }

  return defs;
};

const extractPlanToolBindingDefinitions = (plan: ExecutionPlan): ExtractedToolDefinition[] => {
  const defs: ExtractedToolDefinition[] = [];
  for (const node of plan.nodes) {
    const binding = node.toolBinding;
    const toolName = toNonEmptyString(binding?.toolName);
    if (!toolName || RESERVED_TOOL_NAMES.has(toolName)) continue;
    const args = normalizeParamSamples(binding?.arguments);
    const paramNames = normalizeParamNames(Object.keys(args));
    defs.push({
      name: toolName,
      description: `Auto-registered for node ${node.id}: ${node.name}`,
      schema: null,
      callback: '',
      paramNames,
      paramSamples: args,
      source: `plan_binding:${node.id}`,
    });
  }
  return defs;
};

const sanitizePropertySchema = (candidate: unknown): JSONSchema7Definition => {
  const record = asRecord(candidate);
  if (!record) return { type: 'string' };

  const rawType = toNonEmptyString(record['type']).toLowerCase();
  const type = SAFE_TYPE_SET.has(rawType) ? rawType : 'string';
  const out: Record<string, unknown> = { type };

  const description = toNonEmptyString(record['description']);
  if (description) out['description'] = description.slice(0, 280);

  if (Array.isArray(record['enum']) && record['enum'].length > 0 && record['enum'].length <= 20) {
    const filteredEnum = record['enum'].filter((entry) => ['string', 'number', 'boolean'].includes(typeof entry));
    if (filteredEnum.length > 0) out['enum'] = filteredEnum;
  }

  if (type === 'array') {
    const itemCandidate = asRecord(record['items']);
    if (itemCandidate) {
      const itemTypeRaw = toNonEmptyString(itemCandidate['type']).toLowerCase();
      out['items'] = { type: SAFE_TYPE_SET.has(itemTypeRaw) ? itemTypeRaw : 'string' };
    } else {
      out['items'] = { type: 'string' };
    }
  }

  if (type === 'object') {
    out['additionalProperties'] = false;
  }

  return out as JSONSchema7Definition;
};

const inferSchemaFromSample = (value: unknown): JSONSchema7Definition => {
  if (typeof value === 'string') return { type: 'string' };
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (Array.isArray(value)) {
    const firstDefined = value.find((entry) => entry !== undefined && entry !== null);
    const items: JSONSchema7Definition =
      firstDefined === undefined ? ({ type: 'string' } as const) : inferSchemaFromSample(firstDefined);
    return { type: 'array', items };
  }
  if (value && typeof value === 'object') return { type: 'object', additionalProperties: true };
  return { type: 'string' };
};

const normalizeSchemaCandidate = (schemaCandidate: unknown): Record<string, unknown> | null => {
  if (typeof schemaCandidate === 'string') {
    return asRecord(safeJsonParse(schemaCandidate));
  }
  return asRecord(schemaCandidate);
};

const buildSafeSchema = (
  schemaCandidate: unknown,
  paramNames: Iterable<string>,
  paramSamples: Record<string, unknown>
): JSONSchema7 => {
  const sampleParams = normalizeParamSamples(paramSamples);
  const inferredParams = normalizeParamNames([...paramNames, ...Object.keys(sampleParams)]);
  const base = normalizeSchemaCandidate(schemaCandidate);
  const properties: Record<string, JSONSchema7Definition> = {};
  const required: string[] = [];

  if (base && toNonEmptyString(base['type']).toLowerCase() === 'object') {
    const rawProps = asRecord(base['properties']);
    if (rawProps) {
      for (const [key, value] of Object.entries(rawProps)) {
        if (!SAFE_PARAM_NAME_RE.test(key)) continue;
        if (Object.keys(properties).length >= MAX_TOOL_PROPERTIES) break;
        properties[key] = sanitizePropertySchema(value);
      }
    }

    if (Array.isArray(base['required'])) {
      for (const req of base['required']) {
        const key = toNonEmptyString(req);
        if (key && SAFE_PARAM_NAME_RE.test(key) && key in properties) required.push(key);
      }
    }
  }

  for (const param of inferredParams) {
    if (!(param in properties)) {
      properties[param] = inferSchemaFromSample(sampleParams[param]);
    }
  }

  if (Object.keys(properties).length === 0) {
    properties['input'] = { type: 'string' };
  }

  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? { required: Array.from(new Set(required)) } : {}),
  };
};

const resolveCallbackKind = (input: {
  toolName: string;
  description: string;
  callbackHint: string;
}): ToolCallbackKind => {
  const haystack = `${input.toolName} ${input.description} ${input.callbackHint}`.toLowerCase();
  const normalizedHaystack = haystack.replace(/[_-]+/g, ' ');
  if (normalizedHaystack.includes('http request callback') || /\b(http|fetch|url|web|request|api)\b/.test(normalizedHaystack)) {
    return 'http_request_callback';
  }
  if (normalizedHaystack.includes('html parser callback') || /\b(html|selector|parse|scrape)\b/.test(normalizedHaystack)) {
    return 'html_parser_callback';
  }
  if (normalizedHaystack.includes('price extractor callback') || /\b(price|cost|quote|amount)\b/.test(normalizedHaystack)) {
    return 'price_extractor_callback';
  }
  if (normalizedHaystack.includes('math average callback') || /\b(average|mean|math)\b/.test(normalizedHaystack)) {
    return 'math_average_callback';
  }
  if (normalizedHaystack.includes('batch processing callback') || /\b(batch|chunk)\b/.test(normalizedHaystack)) {
    return 'batch_processing_callback';
  }
  if (normalizedHaystack.includes('data processing callback') || /\b(data|transform|filter|map|reduce)\b/.test(normalizedHaystack)) {
    return 'data_processing_callback';
  }
  if (/\b(mermaid|diagram|flowchart|graph)\b/.test(normalizedHaystack)) {
    return 'mermaid_diagram_callback';
  }
  if (/\b(image|illustrat|render|sketch|picture|photo)\b/.test(normalizedHaystack)) {
    return 'artifact_image_callback';
  }
  return 'generic_callback';
};

const delegateToBuiltin = async (
  registry: ToolRegistry,
  builtinToolName: string,
  args: Record<string, unknown>,
  context: Parameters<ToolCallback['execute']>[1]
): Promise<unknown> => {
  const builtin = registry.getTool(builtinToolName);
  if (!builtin) throw new Error(`Required builtin '${builtinToolName}' is unavailable`);
  return builtin.callback.execute(args, context);
};

const arrayBufferToBase64 = (buf: ArrayBuffer): string => {
  if (typeof Buffer !== 'undefined') return Buffer.from(buf).toString('base64');
  const uint8 = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < uint8.length; i += 1) {
    binary += String.fromCharCode(uint8[i] || 0);
  }
  const btoaFn =
    typeof window !== 'undefined' && typeof window.btoa === 'function'
      ? window.btoa
      : (globalThis as { btoa?: (input: string) => string }).btoa;
  if (!btoaFn) throw new Error('Base64 encoding is unavailable in this environment');
  return btoaFn(binary);
};

const buildSafeCallback = (input: {
  kind: ToolCallbackKind;
  toolName: string;
  registry: ToolRegistry;
}): ToolCallback => {
  const { kind, toolName, registry } = input;

  if (kind === 'http_request_callback') {
    return {
      async execute(params, context) {
        const args = {
          url: toNonEmptyString(params['url']) || toNonEmptyString(params['endpoint']),
          method: toNonEmptyString(params['method']) || 'GET',
          headers: asRecord(params['headers']) || {},
          timeout: typeof params['timeout'] === 'number' ? params['timeout'] : 10000,
        };
        return delegateToBuiltin(registry, 'http_fetch', args, context);
      },
    };
  }

  if (kind === 'html_parser_callback') {
    return {
      async execute(params, context) {
        const args = {
          html: toNonEmptyString(params['html']),
          selector: toNonEmptyString(params['selector']) || toNonEmptyString(params['query']),
          attribute: toNonEmptyString(params['attribute']) || '',
        };
        return delegateToBuiltin(registry, 'html_parser', args, context);
      },
    };
  }

  if (kind === 'price_extractor_callback') {
    return {
      async execute(params, context) {
        const args = {
          text: toNonEmptyString(params['text']) || JSON.stringify(params),
          currency: toNonEmptyString(params['currency']) || 'USD',
        };
        return delegateToBuiltin(registry, 'price_extractor', args, context);
      },
    };
  }

  if (kind === 'math_average_callback') {
    return {
      async execute(params, context) {
        const rawValues = Array.isArray(params['values']) ? params['values'] : Array.isArray(params['data']) ? params['data'] : [];
        const values = rawValues
          .map((value) => (typeof value === 'number' ? value : Number(value)))
          .filter((value) => Number.isFinite(value));
        if (values.length === 0) throw new Error('math_average requires numeric values');
        return delegateToBuiltin(registry, 'math_average', { values }, context);
      },
    };
  }

  if (kind === 'data_processing_callback') {
    return {
      async execute(params) {
        const source = Array.isArray(params['data']) ? params['data'] : Array.isArray(params['values']) ? params['values'] : [];
        const operation = toNonEmptyString(params['operation']).toLowerCase() || 'identity';
        const numbers = source.map((value) => (typeof value === 'number' ? value : Number(value))).filter((value) => Number.isFinite(value));
        const field = toNonEmptyString(params['field']);
        const equals = params['equals'];

        if (operation === 'sum') return { operation, result: numbers.reduce((acc, value) => acc + value, 0), count: numbers.length };
        if (operation === 'average' || operation === 'mean') {
          if (numbers.length === 0) return { operation, result: null, count: 0 };
          return { operation, result: numbers.reduce((acc, value) => acc + value, 0) / numbers.length, count: numbers.length };
        }
        if (operation === 'count') return { operation, result: source.length };
        if (operation === 'unique') return { operation, result: Array.from(new Set(source as unknown[])) };
        if (operation === 'sort') return { operation, result: [...(source as unknown[])].sort() };
        if (operation === 'map' && field) {
          const mapped = (source as unknown[]).map((row) => {
            const record = asRecord(row);
            return record ? record[field] : null;
          });
          return { operation, result: mapped };
        }
        if (operation === 'filter' && field) {
          const filtered = (source as unknown[]).filter((row) => {
            const record = asRecord(row);
            if (!record) return false;
            if (equals !== undefined) return record[field] === equals;
            return Boolean(record[field]);
          });
          return { operation, result: filtered, count: filtered.length };
        }

        return { operation: 'identity', result: source };
      },
    };
  }

  if (kind === 'batch_processing_callback') {
    return {
      async execute(params) {
        const source = Array.isArray(params['items']) ? params['items'] : Array.isArray(params['data']) ? params['data'] : [];
        const requestedSize = Number(params['batch_size'] ?? params['batchSize'] ?? 10);
        const batchSize = Number.isFinite(requestedSize) ? Math.max(1, Math.min(100, Math.floor(requestedSize))) : 10;
        const batches: unknown[][] = [];
        for (let i = 0; i < source.length; i += batchSize) {
          batches.push(source.slice(i, i + batchSize));
        }
        return {
          operation: 'batch',
          batchSize,
          batchCount: batches.length,
          batches,
        };
      },
    };
  }

  if (kind === 'mermaid_diagram_callback') {
    return {
      async execute(params) {
        const rawCode =
          toNonEmptyString(params['mermaid']) ||
          toNonEmptyString(params['diagram']) ||
          toNonEmptyString(params['graph']) ||
          toNonEmptyString(params['code']) ||
          toNonEmptyString(params['spec']);
        const mermaid = extractMermaidCode(rawCode) || 'flowchart TD\nA[Input] --> B[Output]';
        return {
          artifacts: [
            {
              type: 'diagram',
              title: toNonEmptyString(params['title']) || toolName,
              content: mermaid,
              mimeType: 'text/plain',
              metadata: {
                visualPlan: {
                  renderMode: 'mermaid',
                  mermaid,
                },
                autoRegistered: true,
              },
            },
          ],
        };
      },
    };
  }

  if (kind === 'artifact_image_callback') {
    return {
      async execute(params) {
        const prompt =
          toNonEmptyString(params['prompt']) ||
          toNonEmptyString(params['description']) ||
          toNonEmptyString(params['spec']) ||
          JSON.stringify(params);
        if (!prompt) throw new Error('Image callback requires a prompt');

        const style = toNonEmptyString(params['style']) || 'modern technical illustration';
        const aspectRatioCandidate = toNonEmptyString(params['aspectRatio']) || '4:3';
        const aspectRatio = SAFE_IMAGE_ASPECT_RATIOS.has(aspectRatioCandidate) ? aspectRatioCandidate : '4:3';
        const title = toNonEmptyString(params['title']) || toolName;

        const response = await fetch('/api/generateartifactimage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, prompt, style, aspectRatio }),
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => 'Unknown error');
          throw new Error(`Image generation failed (${response.status}): ${detail}`);
        }
        const mimeType = response.headers.get('content-type') || 'image/png';
        const model = response.headers.get('x-artifact-image-model') || '';
        const base64 = arrayBufferToBase64(await response.arrayBuffer());
        const dataUrl = `data:${mimeType};base64,${base64}`;

        return {
          artifacts: [
            {
              type: 'image',
              title,
              content: dataUrl,
              mimeType,
              metadata: {
                model,
                autoRegistered: true,
                visualPlan: {
                  renderMode: 'image',
                  prompt,
                  style,
                  aspectRatio,
                },
              },
            },
          ],
        };
      },
    };
  }

  return {
    async execute(params) {
      return {
        tool: toolName,
        status: 'ok',
        received: params,
      };
    },
  };
};

const mergeDefinitions = (definitions: ExtractedToolDefinition[]): MergedToolDefinition[] => {
  const merged = new Map<string, MergedToolDefinition>();
  for (const def of definitions) {
    const name = toNonEmptyString(def.name);
    if (!name) continue;
    const existing = merged.get(name);
    if (!existing) {
      merged.set(name, {
        name,
        description: toNonEmptyString(def.description) || `Auto-registered protocol tool: ${name}`,
        schemaCandidate: def.schema || null,
        callbackHint: toNonEmptyString(def.callback),
        paramNames: new Set(normalizeParamNames(def.paramNames || [])),
        paramSamples: normalizeParamSamples(def.paramSamples),
        sources: new Set([def.source]),
      });
      continue;
    }

    if (!existing.description || existing.description.startsWith('Auto-registered protocol tool:')) {
      const description = toNonEmptyString(def.description);
      if (description) existing.description = description;
    }
    if (!existing.schemaCandidate && def.schema) existing.schemaCandidate = def.schema;
    if (!existing.callbackHint) {
      const callbackHint = toNonEmptyString(def.callback);
      if (callbackHint) existing.callbackHint = callbackHint;
    }
    for (const param of normalizeParamNames(def.paramNames || [])) {
      existing.paramNames.add(param);
    }
    const paramSamples = normalizeParamSamples(def.paramSamples);
    for (const [key, entryValue] of Object.entries(paramSamples)) {
      if (!(key in existing.paramSamples)) {
        existing.paramSamples[key] = entryValue;
      }
    }
    existing.sources.add(def.source);
  }
  return Array.from(merged.values());
};

const extractDefinitionsFromProtocol = (plan: ExecutionPlan, recipeText: string): ExtractedToolDefinition[] => {
  const defs: ExtractedToolDefinition[] = [];
  defs.push(...extractAstToolDefinitions(plan));
  defs.push(...extractYamlToolDefinitions(recipeText));
  defs.push(...extractLegacyDefineToolDefinitions(recipeText));
  defs.push(...extractInlineToolDefinitions(recipeText, 'inline_recipe_tools'));
  defs.push(...extractPlanToolBindingDefinitions(plan));

  for (const node of plan.nodes) {
    const description = node.description || '';
    defs.push(...extractInlineToolDefinitions(description, `node_description:${node.id}`));
    defs.push(...extractYamlToolDefinitions(description));
    defs.push(...extractLegacyDefineToolDefinitions(description));
  }

  return defs;
};

export const autoRegisterProtocolTools = (input: {
  registry: ToolRegistry;
  plan: ExecutionPlan;
  recipeText: string;
}): AutoRegistrationResult => {
  const { registry, plan, recipeText } = input;
  const extracted = extractDefinitionsFromProtocol(plan, recipeText);
  const merged = mergeDefinitions(extracted);
  const result: AutoRegistrationResult = {
    extractedCount: extracted.length,
    registered: [],
    skipped: [],
  };

  let registeredCount = 0;
  for (const def of merged) {
    const name = def.name;
    if (!SAFE_TOOL_NAME_RE.test(name) || UNSAFE_TOOL_NAMES.has(name.toLowerCase())) {
      result.skipped.push({ name, reason: 'invalid_name', detail: 'Tool name failed safety validation' });
      continue;
    }
    if (RESERVED_TOOL_NAMES.has(name)) {
      result.skipped.push({ name, reason: 'reserved_name', detail: 'Reserved tool names are managed by runtime' });
      continue;
    }
    if (registry.getTool(name)) {
      result.skipped.push({ name, reason: 'already_registered', detail: 'Tool already exists in registry' });
      continue;
    }
    if (registeredCount >= MAX_AUTO_REGISTERED_TOOLS) {
      result.skipped.push({ name, reason: 'max_limit_reached', detail: `Exceeded ${MAX_AUTO_REGISTERED_TOOLS} auto-registered tools` });
      continue;
    }

    const callbackKind = resolveCallbackKind({
      toolName: name,
      description: def.description,
      callbackHint: def.callbackHint,
    });
    const callback = buildSafeCallback({ kind: callbackKind, toolName: name, registry });
    const schema = buildSafeSchema(def.schemaCandidate, def.paramNames, def.paramSamples);
    const toolDef: ToolDefinition = {
      name,
      description: def.description.slice(0, 280),
      schema,
      callback,
      createdAt: new Date().toISOString(),
      version: '1.0.0',
      metadata: {
        autoRegistered: true,
        callbackKind,
        sources: Array.from(def.sources),
      },
    };

    try {
      registry.registerTool(toolDef);
      registeredCount += 1;
      result.registered.push(name);
    } catch (error: any) {
      result.skipped.push({
        name,
        reason: 'register_error',
        detail: error?.message || String(error),
      });
    }
  }

  return result;
};
