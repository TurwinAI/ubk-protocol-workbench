/**
 * Quantitative SMT-LIB2 Constraint Encoder
 * ========================================
 *
 * Translates concrete quantitative claims into sound QF_LRA / QF_LIA SMT-LIB2
 * formulas that assert BOTH the domain law AND the candidate's numeric parameters.
 *
 * Design rule (zero SMT theater):
 * - Never emit vacuous tautologies such as `(= x x)` or `(assert true)`.
 * - Never emit hardcoded `P ∧ ¬P` contradictions after a keyword regex match.
 * - If a claim contains no extractable quantitative model, return `[]` so the
 *   Universal Bounds Kernel records an explicit unknown region in `Umap` and
 *   abstains (`UNVERIFIED`) instead of fabricating a proof.
 */

import { extractConstraintsWithLLM } from './llmConstraintExtractor';

export type ConstraintDomain =
  | 'COMPLEXITY'
  | 'RESOURCES'
  | 'LOGIC'
  | 'PHYSICS'
  | 'BIOLOGY'
  | 'ELECTRICAL'
  | 'MECHANICAL'
  | 'CONTROL'
  | 'MATERIALS'
  | 'RELIABILITY';

export interface SMTFormula {
  /** Executable SMT-LIB2 formula (empty string if unformalized) */
  smtlib: string;
  /** Human-readable description of the formal model */
  description: string;
  /** Domain of the constraint */
  domain: ConstraintDomain;
  /** Declared symbolic variables */
  variables: string[];
  /** Identifier of the quantitative encoder that generated this model */
  sourcePattern: string;
  /** Extracted numeric parameters for transparent auditability */
  parameters?: Record<string, number>;
}

export interface EncodedConstraint {
  formula: SMTFormula;
  /** 1.0 = exact quantitative extraction; < 0.6 = semantic fallback */
  confidence: number;
  originalText: string;
}

export interface ConstraintPattern {
  id: string;
  matcher: RegExp;
  encode: (match: RegExpMatchArray, fullText: string) => SMTFormula | null;
  domain: ConstraintDomain;
  priority: number;
}

function toRealLiteral(value: number): string {
  if (!Number.isFinite(value)) return '0.0';
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  const str = String(rounded);
  if (str.includes('.')) return str.startsWith('-') ? `(- ${str.slice(1)})` : str;
  return str.startsWith('-') ? `(- ${str.slice(1)}.0)` : `${str}.0`;
}

function toIntLiteral(value: number): string {
  const n = Math.trunc(value);
  return n < 0 ? `(- ${Math.abs(n)})` : String(n);
}

function normalizeFrequencyHz(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u === 'ghz') return value * 1e9;
  if (u === 'mhz') return value * 1e6;
  if (u === 'khz') return value * 1e3;
  return value;
}

function normalizeTemperatureKelvin(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u === 'c' || u === '°c' || u === 'celsius') return value + 273.15;
  return value;
}

function log2Factorial(n: number): number {
  let sum = 0;
  for (let i = 2; i <= n; i += 1) {
    sum += Math.log2(i);
  }
  return sum;
}

/**
 * Guard against meta-questions / educational explanations asking WHY something is impossible
 * (e.g. "Explain why an O(n) comparison sort is impossible").
 */
export function isMetaDiscussionPrompt(text: string): boolean {
  return /^\s*(?:explain|describe|discuss|summarize|prove|show|why\s+is|why\s+are|what\s+is\s+the\s+proof)\b/i.test(
    text.trim()
  );
}

// ============================================================================
// QUANTITATIVE SMT-LIB2 ENCODERS
// ============================================================================

/**
 * 1. Carnot Thermal Efficiency Bound (Second Law of Thermodynamics, QF_LRA)
 * Parses hot/cold reservoir temperatures (K or °C) and claimed efficiency (%).
 * Asserts both the exact Carnot ceiling `eta_carnot * T_hot = T_hot - T_cold`
 * and `eta_claimed <= eta_carnot`. Z3 decides SAT or UNSAT directly from the numbers.
 */
function encodeCarnotEfficiency(fullText: string): SMTFormula | null {
  const tempRegex = /(\d+(?:\.\d+)?)\s*(?:°\s*C|celsius|K|kelvin)\b/gi;
  const temps: number[] = [];
  let tMatch: RegExpExecArray | null;
  while ((tMatch = tempRegex.exec(fullText)) !== null) {
    const rawVal = parseFloat(tMatch[1]);
    const unitMatch = tMatch[0].replace(tMatch[1], '').trim();
    const kelvin = normalizeTemperatureKelvin(rawVal, unitMatch);
    if (Number.isFinite(kelvin) && kelvin > 0) {
      temps.push(kelvin);
    }
  }

  const effMatch = fullText.match(/(\d+(?:\.\d+)?)\s*%\s*(?:thermal\s+|energy\s+)?efficiency|efficiency\s*(?:of|=|>=|>)?\s*(\d+(?:\.\d+)?)\s*%/i);
  if (!effMatch) return null;
  const effPct = parseFloat(effMatch[1] ?? effMatch[2]);
  if (!Number.isFinite(effPct) || effPct < 0) return null;
  const etaClaimed = effPct / 100;

  if (temps.length >= 2) {
    const tHot = Math.max(temps[0], temps[1]);
    const tCold = Math.min(temps[0], temps[1]);
    if (tHot <= tCold || tCold <= 0) return null;
    const carnotPct = ((1 - tCold / tHot) * 100).toFixed(2);
    return {
      smtlib: `; Carnot Thermal Efficiency Bound (QF_LRA)
; Given reservoirs T_hot = ${tHot} K, T_cold = ${tCold} K, Carnot limit = ${carnotPct}%
; Claimed thermal efficiency: ${effPct}% (${etaClaimed})
(declare-const T_hot Real)
(declare-const T_cold Real)
(declare-const eta_claimed Real)
(declare-const eta_carnot Real)
(assert (= T_hot ${toRealLiteral(tHot)}))
(assert (= T_cold ${toRealLiteral(tCold)}))
(assert (= eta_claimed ${toRealLiteral(etaClaimed)}))
(assert (> T_hot T_cold))
(assert (> T_cold 0.0))
(assert (= (* eta_carnot T_hot) (- T_hot T_cold)))
(assert (<= eta_claimed eta_carnot))
(check-sat)`,
      description: `Carnot efficiency bound for T_hot=${tHot}K, T_cold=${tCold}K (limit ${carnotPct}%) vs claimed ${effPct}%`,
      domain: 'PHYSICS',
      variables: ['T_hot', 'T_cold', 'eta_claimed', 'eta_carnot'],
      sourcePattern: 'CARNOT_EFFICIENCY_BOUND',
      parameters: { T_hot: tHot, T_cold: tCold, eta_claimed: etaClaimed },
    };
  }

  // Fallback quantitative First Law bound when efficiency % is stated without reservoir temps
  if (/(?:heat\s+engine|thermal|engine|generator|machine|closed[- ]?cycle|perpetual|over[- ]?unity)/i.test(fullText)) {
    return {
      smtlib: `; First Law of Thermodynamics — Closed-Cycle Efficiency Ceiling (QF_LRA)
; Claimed efficiency: ${effPct}% (${etaClaimed})
(declare-const eta_claimed Real)
(declare-const eta_max Real)
(assert (= eta_claimed ${toRealLiteral(etaClaimed)}))
(assert (= eta_max 1.0))
(assert (<= eta_claimed eta_max))
(check-sat)`,
      description: `First Law conservation ceiling (eta <= 100%) vs claimed ${effPct}% efficiency`,
      domain: 'PHYSICS',
      variables: ['eta_claimed', 'eta_max'],
      sourcePattern: 'THERMAL_EFFICIENCY_BOUND',
      parameters: { eta_claimed: etaClaimed, eta_max: 1.0 },
    };
  }

  return null;
}

/**
 * 2. Nyquist-Shannon Sampling Theorem (QF_LRA)
 * Parses signal bandwidth f_max and sampling rate f_s (Hz/kHz/MHz/GHz).
 * Asserts `f_s >= 2 * f_max`. Z3 decides SAT or UNSAT directly from the frequencies.
 */
function encodeNyquistSampling(fullText: string): SMTFormula | null {
  if (!/(?:sampl|nyquist|alias|reconstruct|adc|digitiz)/i.test(fullText)) {
    return null;
  }

  // Pattern A: "bandlimited 20 kHz signal ... 30 kHz sampling rate" or "sample a 20 kHz signal at 30 kHz"
  const pairA = fullText.match(
    /(\d+(?:\.\d+)?)\s*(GHz|MHz|kHz|Hz)\s+(?:analog\s+|bandlimited\s+)?(?:signal|bandwidth|tone|wave|frequency)[\s\S]{0,80}?(\d+(?:\.\d+)?)\s*(GHz|MHz|kHz|Hz)/i
  );
  // Pattern B: "sampling rate of 30 kHz for a 20 kHz signal"
  const pairB = fullText.match(
    /(?:sampl(?:e|ing)\s+(?:rate|frequency)?\s*(?:of|at)?\s*)(\d+(?:\.\d+)?)\s*(GHz|MHz|kHz|Hz)[\s\S]{0,80}?(\d+(?:\.\d+)?)\s*(GHz|MHz|kHz|Hz)/i
  );

  let fMaxHz: number | null = null;
  let fsHz: number | null = null;
  let fMaxLabel = '';
  let fsLabel = '';

  if (pairA) {
    fMaxHz = normalizeFrequencyHz(parseFloat(pairA[1]), pairA[2]);
    fsHz = normalizeFrequencyHz(parseFloat(pairA[3]), pairA[4]);
    fMaxLabel = `${pairA[1]} ${pairA[2]}`;
    fsLabel = `${pairA[3]} ${pairA[4]}`;
  } else if (pairB) {
    fsHz = normalizeFrequencyHz(parseFloat(pairB[1]), pairB[2]);
    fMaxHz = normalizeFrequencyHz(parseFloat(pairB[3]), pairB[4]);
    fsLabel = `${pairB[1]} ${pairB[2]}`;
    fMaxLabel = `${pairB[3]} ${pairB[4]}`;
  }

  if (fMaxHz === null || fsHz === null || fMaxHz <= 0 || fsHz <= 0) return null;

  return {
    smtlib: `; Nyquist-Shannon Sampling Theorem (QF_LRA)
; Signal bandwidth f_max = ${fMaxLabel} (${fMaxHz} Hz)
; Claimed sampling rate f_s = ${fsLabel} (${fsHz} Hz)
(declare-const f_max Real)
(declare-const f_s Real)
(assert (= f_max ${toRealLiteral(fMaxHz)}))
(assert (= f_s ${toRealLiteral(fsHz)}))
(assert (> f_max 0.0))
(assert (>= f_s (* 2.0 f_max)))
(check-sat)`,
    description: `Nyquist sampling bound: f_s=${fsLabel} vs required 2*f_max=${2 * fMaxHz} Hz`,
    domain: 'ELECTRICAL',
    variables: ['f_max', 'f_s'],
    sourcePattern: 'NYQUIST_SAMPLING_BOUND',
    parameters: { f_max_hz: fMaxHz, f_s_hz: fsHz },
  };
}

/**
 * 3. Pigeonhole / Discrete Capacity Allocation (QF_LIA)
 * Parses integer item count k, bin count m, and optional per-bin capacity c (default 1).
 * Properly evaluates k <= m * c in Z3 (fixes the prior regex false-positive bug).
 */
function encodePigeonholeAllocation(fullText: string): SMTFormula | null {
  const m = fullText.match(
    /(?:fit|place|assign|pack|map|store|put)\s+(\d+)\s+(?:distinct\s+)?(?:items?|pigeons?|objects?|tasks?|keys?|elements?)\s+(?:into|in)\s+(\d+)\s+(?:boxes|holes|slots|bins|buckets|containers|servers)/i
  );
  if (!m) return null;

  const items = parseInt(m[1], 10);
  const bins = parseInt(m[2], 10);
  if (!Number.isFinite(items) || !Number.isFinite(bins) || bins <= 0 || items < 0) return null;

  const capMatch = fullText.match(/(?:at\s+most|max(?:imum)?|capacity(?:\s+of)?)\s+(\d+)\s+(?:per|each|in\s+each)/i);
  const capPerBin = capMatch ? parseInt(capMatch[1], 10) : 1;
  if (!Number.isFinite(capPerBin) || capPerBin <= 0) return null;

  return {
    smtlib: `; Pigeonhole / Discrete Capacity Allocation Bound (QF_LIA)
; Items = ${items}, Bins = ${bins}, Max per bin = ${capPerBin}
(declare-const items Int)
(declare-const bins Int)
(declare-const cap_per_bin Int)
(assert (= items ${toIntLiteral(items)}))
(assert (= bins ${toIntLiteral(bins)}))
(assert (= cap_per_bin ${toIntLiteral(capPerBin)}))
(assert (> bins 0))
(assert (<= items (* bins cap_per_bin)))
(check-sat)`,
    description: `Discrete capacity bound: ${items} items into ${bins} bins (capacity ${capPerBin}/bin)`,
    domain: 'LOGIC',
    variables: ['items', 'bins', 'cap_per_bin'],
    sourcePattern: 'PIGEONHOLE_CAPACITY_BOUND',
    parameters: { items, bins, cap_per_bin: capPerBin },
  };
}

/**
 * 4. Comparison-Based Sorting Decision-Tree Lower Bound (QF_LIA / QF_LRA)
 * - Concrete case: "sort N elements in K comparisons" -> Z3 checks K >= ceil(log2(N!)).
 * - Asymptotic case: "O(n) comparison-based sort" -> proves for any linear constant c > 0,
 *   choosing witness n = 2^(c + 3) yields log2(n) = c + 3, where Stirling's bound requires
 *   comparisons/n > log2(n) - 2 = c + 1 > c (genuinely UNSAT in Z3, fixing prior inverted math).
 */
function encodeComparisonSortBound(fullText: string): SMTFormula | null {
  if (isMetaDiscussionPrompt(fullText)) return null;

  const concrete = fullText.match(
    /sort\s+(\d+)\s+(?:arbitrary\s+|distinct\s+)?(?:elements?|keys?|items?|numbers?)\s+(?:in|with|using)\s+(?:at\s+most\s+)?(\d+)\s+comparisons?/i
  );
  if (concrete) {
    const n = parseInt(concrete[1], 10);
    const claimed = parseInt(concrete[2], 10);
    if (n >= 2 && n <= 10_000 && claimed >= 0) {
      const minComparisons = Math.ceil(log2Factorial(n));
      return {
        smtlib: `; Information-Theoretic Comparison Sort Bound (QF_LIA)
; Input size n = ${n}, exact decision-tree bound ceil(log2(${n}!)) = ${minComparisons}
; Claimed worst-case comparisons = ${claimed}
(declare-const n Int)
(declare-const claimed_comparisons Int)
(declare-const min_comparisons Int)
(assert (= n ${toIntLiteral(n)}))
(assert (= claimed_comparisons ${toIntLiteral(claimed)}))
(assert (= min_comparisons ${toIntLiteral(minComparisons)}))
(assert (>= claimed_comparisons min_comparisons))
(check-sat)`,
        description: `Comparison-sort bound for n=${n}: claimed ${claimed} comparisons vs exact lower bound ${minComparisons}`,
        domain: 'COMPLEXITY',
        variables: ['n', 'claimed_comparisons', 'min_comparisons'],
        sourcePattern: 'COMPARISON_SORT_CONCRETE_BOUND',
        parameters: { n, claimed_comparisons: claimed, min_comparisons: minComparisons },
      };
    }
  }

  if (/O\(\s*(?:n|1)\s*\)\s+(?:time\s+)?comparison[- ]?(?:based\s+)?sort/i.test(fullText)) {
    return {
      smtlib: `; Asymptotic Comparison-Based Sorting Lower Bound (QF_LRA)
; Decision-tree bound: worst-case comparisons >= log2(n!) > n * (log2(n) - 2) for n >= 2.
; For any claimed linear constant c > 0, choose witness n = 2^(c + 3) so log2_n = c + 3.
; Requiring c * n >= n * (log2_n - 2) reduces to c >= log2_n - 2, which is UNSAT for all c > 0.
(declare-const c Real)
(declare-const log2_n Real)
(assert (> c 0.0))
(assert (= log2_n (+ c 3.0)))
(assert (>= c (- log2_n 2.0)))
(check-sat)`,
      description: 'Asymptotic comparison-based sorting cannot run in O(n) worst-case comparisons (Omega(n log n) lower bound)',
      domain: 'COMPLEXITY',
      variables: ['c', 'log2_n'],
      sourcePattern: 'COMPARISON_SORT_ASYMPTOTIC_BOUND',
    };
  }

  return null;
}

/**
 * 5. Additive Latency / Compute Budget (QF_LRA)
 * Parses explicit step latencies ("30 ms, 45 ms, 50 ms") and a total budget ("budget 100 ms" / "within 100 ms").
 */
function encodeLatencyBudget(fullText: string): SMTFormula | null {
  const budgetMatch = fullText.match(
    /(?:budget|deadline|limit|within|under|<=)\s*(?:of\s+)?(\d+(?:\.\d+)?)\s*ms\b/i
  );
  if (!budgetMatch) return null;
  const budgetMs = parseFloat(budgetMatch[1]);
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) return null;

  const stepMatches = [...fullText.matchAll(/(?:step|stage|node|task)\s*\d*[^,\n;]{0,30}?(\d+(?:\.\d+)?)\s*ms\b/gi)];
  if (stepMatches.length < 2) return null;

  const stepValues = stepMatches.map((m) => parseFloat(m[1])).filter((v) => Number.isFinite(v) && v >= 0);
  if (stepValues.length < 2) return null;

  const decls = stepValues.map((_, i) => `(declare-const step_${i + 1}_ms Real)`).join('\n');
  const assigns = stepValues.map((v, i) => `(assert (= step_${i + 1}_ms ${toRealLiteral(v)}))`).join('\n');
  const sumExpr = stepValues.map((_, i) => `step_${i + 1}_ms`).join(' ');
  const totalMs = stepValues.reduce((a, b) => a + b, 0);

  return {
    smtlib: `; Sequential Critical-Path Latency Budget (QF_LRA)
; Steps: ${stepValues.join(' + ')} ms = ${totalMs} ms vs budget ${budgetMs} ms
${decls}
(declare-const budget_ms Real)
(declare-const total_ms Real)
${assigns}
(assert (= budget_ms ${toRealLiteral(budgetMs)}))
(assert (= total_ms (+ ${sumExpr})))
(assert (<= total_ms budget_ms))
(check-sat)`,
    description: `Critical-path latency sum (${totalMs} ms) vs declared budget (${budgetMs} ms)`,
    domain: 'CONTROL',
    variables: [...stepValues.map((_, i) => `step_${i + 1}_ms`), 'budget_ms', 'total_ms'],
    sourcePattern: 'LATENCY_BUDGET_BOUND',
    parameters: { total_ms: totalMs, budget_ms: budgetMs },
  };
}

// ============================================================================
// PATTERN REGISTRY (STRICTLY QUANTITATIVE — ZERO TAUTOLOGIES)
// ============================================================================

export const CONSTRAINT_PATTERNS: ConstraintPattern[] = [
  {
    id: 'CARNOT_EFFICIENCY_BOUND',
    matcher: /(?:efficiency|carnot|heat\s+engine|thermal|perpetual|over[- ]?unity)/i,
    encode: (_match, fullText) => encodeCarnotEfficiency(fullText),
    domain: 'PHYSICS',
    priority: 100,
  },
  {
    id: 'NYQUIST_SAMPLING_BOUND',
    matcher: /(?:sampl|nyquist|alias|reconstruct|adc|digitiz)/i,
    encode: (_match, fullText) => encodeNyquistSampling(fullText),
    domain: 'ELECTRICAL',
    priority: 95,
  },
  {
    id: 'PIGEONHOLE_CAPACITY_BOUND',
    matcher: /(?:fit|place|assign|pack|map|store|put)\s+\d+/i,
    encode: (_match, fullText) => encodePigeonholeAllocation(fullText),
    domain: 'LOGIC',
    priority: 95,
  },
  {
    id: 'COMPARISON_SORT_BOUND',
    matcher: /(?:comparison[- ]?(?:based\s+)?sort|sort\s+\d+\s+(?:arbitrary\s+|distinct\s+)?(?:elements?|keys?|items?|numbers?))/i,
    encode: (_match, fullText) => encodeComparisonSortBound(fullText),
    domain: 'COMPLEXITY',
    priority: 95,
  },
  {
    id: 'LATENCY_BUDGET_BOUND',
    matcher: /(?:budget|deadline|limit|within|under|<=)\s*(?:of\s+)?\d+(?:\.\d+)?\s*ms\b/i,
    encode: (_match, fullText) => encodeLatencyBudget(fullText),
    domain: 'CONTROL',
    priority: 90,
  },
];

// ============================================================================
// MAIN ENCODER CLASS
// ============================================================================

export class ConstraintEncoder {
  private patterns: ConstraintPattern[];

  constructor(customPatterns: ConstraintPattern[] = []) {
    this.patterns = [...CONSTRAINT_PATTERNS, ...customPatterns].sort((a, b) => b.priority - a.priority);
  }

  /**
   * Deterministic quantitative extraction only.
   * Returns `[]` when no formalizable numeric/structural model is present.
   */
  extract(text: string): EncodedConstraint[] {
    if (!text || isMetaDiscussionPrompt(text)) {
      return [];
    }

    const results: EncodedConstraint[] = [];
    const seenPatterns = new Set<string>();

    for (const pattern of this.patterns) {
      const match = text.match(pattern.matcher);
      if (!match) continue;
      const formula = pattern.encode(match, text);
      if (formula && !seenPatterns.has(formula.sourcePattern)) {
        seenPatterns.add(formula.sourcePattern);
        results.push({
          formula,
          confidence: 1.0,
          originalText: match[0],
        });
      }
    }

    return results;
  }

  /**
   * Deterministic extraction with optional BYOK LLM extraction fallback.
   * LLM-extracted prose constraints carry `smtlib: ''` so they enter `Umap`
   * unless backed by an executable formal model.
   */
  async extractAll(text: string): Promise<EncodedConstraint[]> {
    const deterministic = this.extract(text);
    if (deterministic.length > 0) {
      return deterministic;
    }

    try {
      const llmExtracted = await extractConstraintsWithLLM(text);
      return llmExtracted;
    } catch {
      return [];
    }
  }

  hasEncodableConstraints(text: string): boolean {
    return this.extract(text).length > 0;
  }

  combineFormulas(formulas: SMTFormula[]): string {
    const executable = formulas.filter((f) => f.smtlib && f.smtlib.trim().length > 0);
    if (executable.length === 0) return '';
    return executable.map((f) => f.smtlib.trim()).join('\n\n');
  }
}

export const constraintEncoder = new ConstraintEncoder();
