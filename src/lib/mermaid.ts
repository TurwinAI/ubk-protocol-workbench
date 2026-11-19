const MERMAID_DIRECTIVE_PATTERN =
  '(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|mindmap|timeline|pie|gitGraph|sankey-beta|block-beta|requirementDiagram|quadrantChart|xychart-beta|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|zenuml)';

const MERMAID_DIRECTIVE_RE = new RegExp(`^${MERMAID_DIRECTIVE_PATTERN}\\b`, 'i');
const MERMAID_DIRECTIVE_LINE_RE = new RegExp(`^\\s*${MERMAID_DIRECTIVE_PATTERN}\\b`, 'i');
const MERMAID_FLOWCHART_DIRECTIVE_LINE_RE = /^\s*flowchart(?:\s+(?:TB|TD|BT|RL|LR))?\s*;?\s*$/i;
const MERMAID_GRAPH_DIRECTIVE_LINE_RE = /^\s*graph(?:\s+(?:TB|TD|BT|RL|LR))?\s*;?\s*$/i;
const MERMAID_EDGE_LINE_RE = /\b[A-Za-z_][\w-]*\b\s*(-->|==>|-.->|---)\s*\b[A-Za-z_][\w-]*\b/;
const MERMAID_SEQUENCE_LINE_RE = /\b[A-Za-z_][\w-]*\s*(?:-+|=+)(?:>|x)\s*[A-Za-z_][\w-]*/;
const MERMAID_SHAPE_LINE_RE =
  /^\s*[A-Za-z_][\w-]*\s*(?:\[[^\]]+\]|\[\[[^\]]+\]\]|\(\([^)]+\)\)|\([^)]+\)|\{[^}]+\}|>\[[^\]]+\]|\(\[[^\]]+\]\))/;
const MERMAID_STATEMENT_LINE_RE =
  /^\s*(?:subgraph|end|classDef|class|style|linkStyle|click|section|title|participant|actor|state|note|loop|alt|opt|par|critical|break|rect|%%)\b/i;
const MERMAID_PIE_DATA_LINE_RE = /^\s*[^:]+:\s*-?\d+(?:\.\d+)?\s*$/;
const MERMAID_FENCED_RE = /```mermaid\s*([\s\S]*?)```/im;
const MERMAID_INIT_RE = /^%%\{.*\}%%$/;

const normalizeLineEndings = (value: string): string => value.replace(/\r\n?/g, '\n');

const isValidMermaidDirectiveLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^flowchart\b/i.test(trimmed)) return MERMAID_FLOWCHART_DIRECTIVE_LINE_RE.test(trimmed);
  if (/^graph\b/i.test(trimmed)) return MERMAID_GRAPH_DIRECTIVE_LINE_RE.test(trimmed);
  return MERMAID_DIRECTIVE_LINE_RE.test(trimmed);
};

const hasMermaidBodySignal = (lines: string[]): boolean => {
  return lines.some((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (MERMAID_EDGE_LINE_RE.test(trimmed)) return true;
    if (MERMAID_SEQUENCE_LINE_RE.test(trimmed)) return true;
    if (MERMAID_SHAPE_LINE_RE.test(trimmed)) return true;
    if (MERMAID_STATEMENT_LINE_RE.test(trimmed)) return true;
    if (MERMAID_PIE_DATA_LINE_RE.test(trimmed)) return true;
    return false;
  });
};

const isValidMermaidSnippet = (code: string): boolean => {
  const lines = normalizeLineEndings(code)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => !!line.trim());
  if (lines.length === 0) return false;

  let directiveIndex = 0;
  while (directiveIndex < lines.length && MERMAID_INIT_RE.test(lines[directiveIndex]?.trim() || '')) {
    directiveIndex += 1;
  }

  const directiveLine = lines[directiveIndex]?.trim() || '';
  if (!isValidMermaidDirectiveLine(directiveLine)) return false;
  if (lines.length <= directiveIndex + 1) return false;

  return hasMermaidBodySignal(lines.slice(directiveIndex + 1));
};

const findDirectiveStart = (lines: string[]): number => {
  for (let i = 0; i < lines.length; i += 1) {
    if (isValidMermaidDirectiveLine(lines[i]?.trim() || '')) return i;
  }

  for (let i = 0; i < lines.length; i += 1) {
    if (!MERMAID_INIT_RE.test(lines[i]?.trim() || '')) continue;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (isValidMermaidDirectiveLine(lines[j]?.trim() || '')) return i;
    }
  }

  return -1;
};

export const extractMermaidCode = (value: string): string | null => {
  const normalized = normalizeLineEndings(value || '').trim();
  if (!normalized) return null;

  const fenced = MERMAID_FENCED_RE.exec(normalized);
  if (fenced?.[1]) {
    const code = fenced[1].trim();
    return code && isValidMermaidSnippet(code) ? code : null;
  }

  if (MERMAID_DIRECTIVE_RE.test(normalized) && isValidMermaidSnippet(normalized)) return normalized;

  const lines = normalized.split('\n');
  const directiveStart = findDirectiveStart(lines);
  if (directiveStart >= 0) {
    const code = lines.slice(directiveStart).join('\n').trim();
    return code && isValidMermaidSnippet(code) ? code : null;
  }

  const edgeStart = lines.findIndex((line) => MERMAID_EDGE_LINE_RE.test(line.trim()));
  if (edgeStart >= 0) {
    const snippet = lines
      .slice(edgeStart)
      .map((line) => line.trimEnd())
      .filter((line) => !!line.trim())
      .join('\n')
      .trim();
    if (!snippet) return null;
    return `flowchart TD\n${snippet}`;
  }

  return null;
};

export const looksLikeMermaidCode = (value: string): boolean => {
  return extractMermaidCode(value) !== null;
};
