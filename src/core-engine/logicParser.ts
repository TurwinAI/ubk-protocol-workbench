/**
 * Logic Parser for Scientific Axiom Verification
 * 
 * Implements resource-flow analysis to detect violations that escape simple regex matching.
 * Specifically designed to catch "No-Cloning" violations in quantum recipes.
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

/**
 * Parses a textual recipe into a logical resource flow (v3.3-IF improved)
 * Now case-insensitive and handles multiline inputs/outputs robustly
 */
export function parseRecipeToLogic(recipeText: string): TransitionStep[] | null {
  const steps: TransitionStep[] = [];

  // Robust parser: Case-insensitive step detection with multiple formats
  // Matches: "Step 1:", "step 1:", "STEP 1:", "1.", "# Step 1", etc.
  const stepRegex = /(?:^|\n)\s*(?:#+\s*)?(?:step|STEP|Step)\s*(\d+)[:.]/gi;
  const matches = [...recipeText.matchAll(stepRegex)];

  if (matches.length === 0) {
    // No steps found - not a step-by-step recipe
    return null;
  }

  // Extract blocks between step markers
  for (let i = 0; i < matches.length; i++) {
    const startIdx = matches[i].index! + matches[i][0].length;
    const endIdx = i < matches.length - 1 ? matches[i + 1].index : recipeText.length;
    const block = recipeText.substring(startIdx, endIdx);

    const lines = block.split('\n');
    let inputs: ResourceState[] = [];
    let outputs: ResourceState[] = [];

    for (const line of lines) {
      const lineLower = line.toLowerCase();

      // Case-insensitive input matching
      if (lineLower.includes('input:') || lineLower.includes('inputs:')) {
        const parts = line.split(/inputs?:/i);
        if (parts.length > 1 && parts[1]) {
          inputs = parseResources(parts[1]);
        }
      }

      // Case-insensitive output matching
      if (lineLower.includes('output:') || lineLower.includes('outputs:')) {
        const parts = line.split(/outputs?:/i);
        if (parts.length > 1 && parts[1]) {
          outputs = parseResources(parts[1]);
        }
      }
    }

    if (inputs.length > 0 || outputs.length > 0) {
      const stepNum = parseInt(matches[i][1]);
      steps.push({ id: stepNum, inputResources: inputs, outputResources: outputs });
    }
  }

  return steps.length > 0 ? steps : null;
}

function parseResources(text: string): ResourceState[] {
  const resources: ResourceState[] = [];
  const unknownStateMatches = text.match(/\|ψ⟩/g);
  
  if (unknownStateMatches) {
    resources.push({ id: 'unknown_quantum_state_ψ', count: unknownStateMatches.length });
  }
  
  // Catch tensor product notation |ψ⟩ ⊗ |ψ⟩ which indicates two copies
  const tensorMatches = text.match(/\|ψ⟩\s*⊗\s*\|ψ⟩/g);
  if (tensorMatches) {
    // This counts as at least 2, possibly more if regex matches multiple times
    // We explicitly add 2 for each tensor pair found to be safe, 
    // effectively overriding the single match above if it captured them too.
    // For robust logic, we'd need a full parser, but this catches the specific violation.
    const currentCount = resources.find(r => r.id === 'unknown_quantum_state_ψ')?.count || 0;
    // If we see X ⊗ X, that's 2 copies.
    if (tensorMatches.length > 0 && currentCount < 2 * tensorMatches.length) {
       // Correct the count
       const res = resources.find(r => r.id === 'unknown_quantum_state_ψ');
       if (res) res.count = 2 * tensorMatches.length;
       else resources.push({ id: 'unknown_quantum_state_ψ', count: 2 * tensorMatches.length });
    }
  }

  return resources;
}

/**
 * Verifies Quantum No-Cloning Theorem via Resource Counting
 * Theorem: Unknown state |ψ⟩ cannot increase in count.
 */
export function verifyNoCloning(steps: TransitionStep[]): { passed: boolean; violationStep?: number } {
  let globalPsiCount = 1; // Assuming we start with 1 unknown state
  
  for (const step of steps) {
    const inputPsi = step.inputResources.find(r => r.id === 'unknown_quantum_state_ψ')?.count || 0;
    const outputPsi = step.outputResources.find(r => r.id === 'unknown_quantum_state_ψ')?.count || 0;
    
    // Violation: Output has MORE copies of |ψ⟩ than Input
    if (outputPsi > inputPsi) {
      return { passed: false, violationStep: step.id };
    }
    
    // Track global state (implied)
    // If step consumes 1 and outputs 2, that's a violation locally.
    // This simple check is usually sufficient for step-by-step recipes.
  }
  
  return { passed: true };
}
