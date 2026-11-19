export const REPORT_SYNTHESIS_SCHEMA_ID = 'idea-factory-commercial-report-v2' as const;
export const REPORT_SYNTHESIS_INSUFFICIENT_INPUT_MARKER = 'INSUFFICIENT_INPUT' as const;

export const REPORT_SYNTHESIS_REQUIRED_HEADINGS = [
  'Decision Brief',
  'Objective and Success Criteria',
  'Concept and Differentiation',
  'Evidence Ledger (Findings)',
  'Feasibility',
  'Commercial Model',
  'Execution Plan',
  'Risks and Kill Criteria',
  'Appendix: Evidence Index',
] as const;

const STEP_DETAIL_FIELDS = ['Parameters', 'Actions', 'Validation', 'Output', 'Owner', 'Date'] as const;

const normalizeHeadingLabel = (value: string): string => {
  return value
    .trim()
    .replace(/^\d+\.\s*/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
};

type ParsedHeading = {
  raw: string;
  normalized: string;
  line: number;
  start: number;
  end: number;
};

const parseTopLevelHeadings = (content: string): ParsedHeading[] => {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const headings: ParsedHeading[] = [];
  let active: ParsedHeading | null = null;

  lines.forEach((line, index) => {
    const match = /^#\s+(.+?)\s*$/.exec(line.trim());
    if (!match) return;

    if (active) {
      active.end = index;
      headings.push(active);
    }

    const raw = (match[1] || '').trim();
    active = {
      raw,
      normalized: normalizeHeadingLabel(raw),
      line: index + 1,
      start: index,
      end: lines.length,
    };
  });

  if (active) {
    headings.push(active);
  }

  return headings;
};

const getSectionBody = (content: string, heading: ParsedHeading): string => {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  return lines.slice(heading.start + 1, heading.end).join('\n').trim();
};

const validateExecutionPlanSection = (body: string): string | null => {
  if (!body.trim()) return 'Execution Plan section cannot be empty.';

  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const numberedDetailLine = lines.find((line) =>
    /^\s*\d+\.\s*(parameters|actions|validation|output|owner|date)\s*:/i.test(line)
  );
  if (numberedDetailLine) {
    return 'Execution Plan detail lines must not be numbered. Number only step headings.';
  }

  const stepHeaderIndexes: Array<{ index: number; number: number }> = [];
  lines.forEach((line, index) => {
    const match = /^\s*(\d+)\.\s+.+$/.exec(line);
    if (!match) return;
    stepHeaderIndexes.push({ index, number: Number(match[1]) });
  });

  if (stepHeaderIndexes.length === 0) {
    return 'Execution Plan must contain numbered step headings (e.g., "1. Step title").';
  }

  for (let i = 0; i < stepHeaderIndexes.length; i += 1) {
    const expected = i + 1;
    if (stepHeaderIndexes[i]!.number !== expected) {
      return `Execution Plan step numbering must be sequential starting at 1 (expected ${expected}).`;
    }
  }

  for (let i = 0; i < stepHeaderIndexes.length; i += 1) {
    const start = stepHeaderIndexes[i]!.index + 1;
    const end = i === stepHeaderIndexes.length - 1 ? lines.length : stepHeaderIndexes[i + 1]!.index;
    const stepLines = lines.slice(start, end);

    for (const field of STEP_DETAIL_FIELDS) {
      const fieldRegex = new RegExp(`^\\s*(?:-\\s*)?${field}\\s*:`, 'i');
      if (!stepLines.some((line) => fieldRegex.test(line))) {
        return `Execution Plan step ${i + 1} is missing required field "${field}:".`;
      }
    }
  }

  return null;
};

const validateFindingsSection = (body: string): string | null => {
  if (!body.trim()) return 'Evidence Ledger (Findings) section cannot be empty.';

  if (!/finding id\s*:/i.test(body)) {
    return 'Evidence Ledger (Findings) must include "Finding ID:" entries.';
  }
  if (!/evidence refs?\s*:/i.test(body)) {
    return 'Evidence Ledger (Findings) must include "Evidence refs:" for each claim.';
  }
  if (!/confidence\s*:/i.test(body)) {
    return 'Evidence Ledger (Findings) must include "Confidence:" for each claim.';
  }

  return null;
};

const validateEvidenceIndexSection = (body: string): string | null => {
  if (!body.trim()) return 'Appendix: Evidence Index section cannot be empty.';
  if (!/\|/.test(body)) {
    return 'Appendix: Evidence Index must include a markdown table mapping artifacts to usage.';
  }
  return null;
};

export type ReportSynthesisContractResult = {
  ok: boolean;
  error?: string;
  insufficientInput?: boolean;
  missingFacts?: string[];
};

export const validateReportSynthesisMarkdown = (content: string): ReportSynthesisContractResult => {
  const trimmed = content.trim();
  if (!trimmed) {
    return { ok: false, error: 'Report synthesis produced empty content.' };
  }

  if (trimmed.startsWith(REPORT_SYNTHESIS_INSUFFICIENT_INPUT_MARKER)) {
    const facts = trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter((line, index) => index > 0 && line.length > 0);
    if (facts.length > 5) {
      return {
        ok: false,
        error: `Report synthesis can list at most 5 missing facts after "${REPORT_SYNTHESIS_INSUFFICIENT_INPUT_MARKER}".`,
      };
    }
    return {
      ok: true,
      insufficientInput: true,
      missingFacts: facts,
    };
  }

  if (!/^#\s+/.test(trimmed)) {
    return {
      ok: false,
      error: `Report synthesis must start with "# ${REPORT_SYNTHESIS_REQUIRED_HEADINGS[0]}".`,
    };
  }

  const headings = parseTopLevelHeadings(trimmed);
  if (headings.length === 0) {
    return { ok: false, error: 'Report synthesis must include top-level markdown headings (# ...).' };
  }

  const expected = REPORT_SYNTHESIS_REQUIRED_HEADINGS.map((heading) => normalizeHeadingLabel(heading));
  const actual = headings.map((heading) => heading.normalized);

  for (let index = 0; index < expected.length; index += 1) {
    const wanted = expected[index]!;
    const found = actual[index];
    if (!found) {
      return {
        ok: false,
        error: `Report synthesis is missing required top-level heading "${REPORT_SYNTHESIS_REQUIRED_HEADINGS[index]}".`,
      };
    }
    if (found !== wanted) {
      const raw = headings[index]?.raw || '(missing)';
      return {
        ok: false,
        error: `Report synthesis headings are out of order or mismatched at position ${index + 1}. Expected "${REPORT_SYNTHESIS_REQUIRED_HEADINGS[index]}", found "${raw}".`,
      };
    }
  }

  if (actual.length > expected.length) {
    const extras = headings.slice(expected.length).map((heading) => heading.raw).join(', ');
    return {
      ok: false,
      error: `Report synthesis has extra top-level headings not allowed by contract: ${extras}.`,
    };
  }

  const bodyByHeading = new Map<string, string>();
  headings.forEach((heading) => {
    bodyByHeading.set(heading.normalized, getSectionBody(trimmed, heading));
  });

  const findingsBody = bodyByHeading.get(normalizeHeadingLabel('Evidence Ledger (Findings)')) || '';
  const findingsError = validateFindingsSection(findingsBody);
  if (findingsError) return { ok: false, error: findingsError };

  const executionPlanBody = bodyByHeading.get(normalizeHeadingLabel('Execution Plan')) || '';
  const executionError = validateExecutionPlanSection(executionPlanBody);
  if (executionError) return { ok: false, error: executionError };

  const evidenceIndexBody = bodyByHeading.get(normalizeHeadingLabel('Appendix: Evidence Index')) || '';
  const evidenceError = validateEvidenceIndexSection(evidenceIndexBody);
  if (evidenceError) return { ok: false, error: evidenceError };

  return { ok: true };
};

export const REPORT_SYNTHESIS_SYSTEM_PROMPT = [
  'You are the Idea Factory Report Synthesizer.',
  'Goal: compile one coherent, commercially useful report from execution evidence.',
  '',
  'Non-negotiables:',
  '- Produce ONE integrated report, not multiple mini-reports.',
  '- Exactly one top-level decision summary (no per-artifact executive summaries).',
  '- Do not repeat claims across sections.',
  '- Every major claim must cite evidence references.',
  '- If a claim cannot be grounded, label it "Assumption:".',
  '- Do not mention internal decision engines, kernels, or algorithms in the user-facing narrative.',
  '- Do not invent tools, metrics, files, or outcomes absent from input.',
  '',
  'Output format (Markdown):',
  '- Use exactly these top-level headings in this order and no additional top-level headings:',
  ...REPORT_SYNTHESIS_REQUIRED_HEADINGS.map((heading, index) => `  ${index + 1}. # ${heading}`),
  '',
  'Section contract:',
  '- "Decision Brief": decision, ask, expected return/risk, what changed.',
  '- "Objective and Success Criteria": goal, measurable thresholds, scope boundaries.',
  '- "Concept and Differentiation": concept and why it is better than alternatives now.',
  '- "Evidence Ledger (Findings)": each finding includes "Finding ID:", "Claim", "Why it matters", "Evidence refs:", "Confidence:".',
  '- "Feasibility": technical, operational, and compliance readiness.',
  '- "Commercial Model": market, unit economics, adoption assumptions, sensitivity drivers.',
  '- "Execution Plan": numbered step headings only (1., 2., ...).',
  '- For each step include unnumbered detail lines: "- Parameters:", "- Actions:", "- Validation:", "- Output:", "- Owner:", "- Date:".',
  '- Never number detail lines inside a step.',
  '- "Risks and Kill Criteria": top risks, indicators, explicit stop conditions.',
  '- "Appendix: Evidence Index": markdown table mapping artifact IDs to contribution and where used.',
  '',
  `If required information is missing, output exactly "${REPORT_SYNTHESIS_INSUFFICIENT_INPUT_MARKER}" on line 1,`,
  'followed by at most 5 missing facts needed to complete the report.',
].join('\n');
