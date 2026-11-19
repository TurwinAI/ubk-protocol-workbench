/**
 * Linear Resource-Flow Logic Parser for Quantum No-Cloning Verification
 * =====================================================================
 *
 * Parses step-by-step protocol text for arbitrary non-clonable quantum state
 * identifiers (Unicode `|ψ⟩`, `|φ⟩`, ASCII `|psi>`, `|phi>`, `|alpha>`, `|x>`)
 * and checks linear resource conservation: no unitary step may emit more copies
 * of an unknown quantum state than it consumes.
 */

export interface ResourceState {
  id: string;
  count: number;
}

export interface TransitionStep {
  id: number;
  inputResources: ResourceState[];
  outputResources: ResourceState[];
}

function normalizeKetName(raw: string): string {
  const cleaned = raw.trim().toLowerCase();
  if (cleaned === 'ψ' || cleaned === 'psi') return 'psi';
  if (cleaned === 'φ' || cleaned === 'ϕ' || cleaned === 'phi') return 'phi';
  if (cleaned === 'α' || cleaned === 'alpha') return 'alpha';
  if (cleaned === 'β' || cleaned === 'beta') return 'beta';
  return cleaned;
}

/**
 * Extract all ket-state multiplicities from an expression string.
 * Supports Unicode kets (`|ψ⟩`), ASCII kets (`|psi>`), tensor products (`⊗`, `*`, `tensor`),
 * and explicit multipliers (`2 |psi>`).
 */
function parseResources(text: string): ResourceState[] {
  const counts = new Map<string, number>();

  // Linear-time ket scanner (no nested quantifiers / zero ReDoS risk):
  // Matches `|psi>`, `|ψ⟩`, and checks immediately preceding multiplier like `2 |psi>` or `2*|psi>`.
  const ketRegex = /\|([A-Za-z0-9_ψφϕαβ]{1,32})(?:⟩|>)/g;
  let match: RegExpExecArray | null;
  while ((match = ketRegex.exec(text)) !== null) {
    let mult = 1;
    // Plain linear backward scan for optional integer multiplier (e.g. `2 |psi>` or `2*|psi>`)
    let cursor = match.index - 1;
    while (cursor >= 0 && (text[cursor] === ' ' || text[cursor] === '\t')) cursor -= 1;
    if (cursor >= 0 && text[cursor] === '*') {
      cursor -= 1;
      while (cursor >= 0 && (text[cursor] === ' ' || text[cursor] === '\t')) cursor -= 1;
    }
    const digitEnd = cursor + 1;
    while (cursor >= 0 && text[cursor] >= '0' && text[cursor] <= '9') cursor -= 1;
    const digitStart = cursor + 1;
    const boundaryOk =
      digitStart === 0 || !/[A-Za-z0-9_]/.test(text[digitStart - 1]);
    if (boundaryOk && digitEnd > digitStart && digitEnd - digitStart <= 6) {
      mult = Math.max(1, parseInt(text.slice(digitStart, digitEnd), 10));
    }
    const stateId = `quantum_state_${normalizeKetName(match[1])}`;
    counts.set(stateId, (counts.get(stateId) || 0) + mult);
  }

  return Array.from(counts.entries()).map(([id, count]) => ({ id, count }));
}

/**
 * Parses a textual protocol into transition steps with explicit input/output resource counts.
 * Also supports single-line transformation syntax like `|psi> -> |psi> ⊗ |psi>`.
 */
export function parseRecipeToLogic(recipeText: string): TransitionStep[] | null {
  const steps: TransitionStep[] = [];

  const stepRegex = /(?:^|\n)\s*(?:#+\s*)?(?:step|STEP|Step)\s*(\d+)[:.]/gi;
  const matches = [...recipeText.matchAll(stepRegex)];

  for (let i = 0; i < matches.length; i += 1) {
    const startIdx = matches[i].index! + matches[i][0].length;
    const endIdx = i < matches.length - 1 ? matches[i + 1].index : recipeText.length;
    const block = recipeText.substring(startIdx, endIdx);

    const lines = block.split('\n');
    let inputs: ResourceState[] = [];
    let outputs: ResourceState[] = [];

    for (const line of lines) {
      const lineLower = line.toLowerCase();
      if (lineLower.includes('input:') || lineLower.includes('inputs:')) {
        const parts = line.split(/inputs?:/i);
        if (parts.length > 1 && parts[1]) {
          inputs = parseResources(parts[1]);
        }
      } else if (lineLower.includes('output:') || lineLower.includes('outputs:')) {
        const parts = line.split(/outputs?:/i);
        if (parts.length > 1 && parts[1]) {
          outputs = parseResources(parts[1]);
        }
      } else if (/(?:->|→|↦|into)\s*/i.test(line) && /\|[A-Za-z0-9_ψφϕαβ]+(?:⟩|>)/.test(line)) {
        const parts = line.split(/(?:->|→|↦|\binto\b)/i);
        if (parts.length >= 2) {
          const lhs = parseResources(parts[0]);
          const rhs = parseResources(parts.slice(1).join(' '));
          if (lhs.length > 0 || rhs.length > 0) {
            inputs = lhs;
            outputs = rhs;
          }
        }
      }
    }

    if (inputs.length > 0 || outputs.length > 0) {
      const stepNum = parseInt(matches[i][1], 10);
      steps.push({ id: stepNum, inputResources: inputs, outputResources: outputs });
    }
  }

  // Fallback: single-line transition outside numbered Step blocks (`|psi> -> |psi> ⊗ |psi>` or `clone |psi> into |psi> ⊗ |psi>`)
  if (steps.length === 0) {
    const arrowParts = recipeText.split(/(?:->|→|↦|\binto\b)/i);
    if (arrowParts.length >= 2) {
      const lhs = parseResources(arrowParts[0]);
      const rhs = parseResources(arrowParts.slice(1).join(' '));
      if (lhs.length > 0 && rhs.length > 0) {
        steps.push({ id: 1, inputResources: lhs, outputResources: rhs });
      }
    }
  }

  return steps.length > 0 ? steps : null;
}

/**
 * Verifies Quantum No-Cloning Theorem via Linear Resource Conservation.
 * For every unknown quantum state identifier s, no unitary transition may satisfy
 * outputCount(s) > inputCount(s).
 */
export function verifyNoCloning(steps: TransitionStep[]): {
  passed: boolean;
  violationStep?: number;
  violatedState?: string;
  inputCount?: number;
  outputCount?: number;
} {
  for (const step of steps) {
    const inputMap = new Map(step.inputResources.map((r) => [r.id, r.count]));
    for (const outRes of step.outputResources) {
      const inCount = inputMap.get(outRes.id) || 0;
      if (outRes.count > inCount) {
        return {
          passed: false,
          violationStep: step.id,
          violatedState: outRes.id,
          inputCount: inCount,
          outputCount: outRes.count,
        };
      }
    }
  }

  return { passed: true };
}
