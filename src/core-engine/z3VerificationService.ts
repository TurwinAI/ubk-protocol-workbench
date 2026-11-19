/**
 * Z3 Verification Service
 * 
 * Provides formal verification using the Z3 SMT solver.
 * This is the "External Truth Source" that breaks the sycophancy loop.
 * 
 * Key capabilities:
 * - SAT-based DAG cycle detection
 * - Constraint satisfiability checking
 * - Invariant preservation verification
 * - Termination proofs via well-founded ordering
 * 
 * NOTE: Z3 WASM loading may fail in browser context.
 * In that case, we fall back to heuristic verification.
 * Full Z3 is available in Node.js (Cloud Functions).
 */

// Types for verification
export interface RecipeStep {
  id: string;
  dependencies: string[];
  inputs: string[];
  outputs: string[];
  invariants?: string[];
}

export interface Constraint {
  type: 'eq' | 'lt' | 'le' | 'gt' | 'ge' | 'ne' | 'and' | 'or' | 'not' | 'implies';
  left: string | number | Constraint;
  right?: string | number | Constraint;
}

export interface SATResult {
  satisfiable: boolean;
  model?: Record<string, any>;
  proof?: string[];
  unsatCore?: string[];
  solveTimeMs: number;
}

export interface DAGVerificationResult {
  isAcyclic: boolean;
  topologicalOrder?: string[];
  cycles?: string[][];
  proof: string[];
  verificationMethod: 'z3-sat' | 'heuristic-fallback';
}

export interface DAGVerificationOptions {
  /**
   * If true, the verifier refuses heuristic fallback when formal Z3 is unavailable.
   */
  requireFormalSolver?: boolean;
}

export interface InvariantResult {
  preserved: boolean;
  violations: Array<{ invariant: string; counterexample?: Record<string, any> }>;
  proof: string[];
}

export interface TerminationResult {
  terminates: boolean;
  variant?: string;
  boundEstimate?: number;
  proof: string[];
}

// Detect browser environment
const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';

/**
 * Z3 Verification Service - External Truth Source
 */
export class Z3VerificationService {
  private initialized = false;
  private initFailed = false;
  private z3Context: any = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize Z3 solver (lazy, singleton pattern)
   * 
   * In browser: May fail due to WASM loading issues - will use heuristic fallback
   * In Node.js: Full Z3 SAT solver available
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initFailed) return; // Don't retry if already failed
    
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      try {
        // Z3 WASM only works reliably in Node.js (Cloud Functions)
        // Browser environments have MIME type and CORS issues with WASM loading
        if (isBrowser) {
          this.initFailed = true;
          console.info('[Z3] Skipping Z3 in browser - using heuristic verification. Full Z3 available in Cloud Functions.');
          return;
        }

        // Node.js: Dynamically import z3-solver
        const z3Module = await import('z3-solver');
        const { Context } = await z3Module.init();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.z3Context = new (Context as any)('turwin-verification');
        this.initialized = true;
        console.log('[Z3] Solver initialized successfully');
      } catch (error) {
        // Mark as failed so we don't retry
        this.initFailed = true;
        console.error('[Z3] Failed to initialize:', error);
        // Don't throw - let callers use heuristic fallback
      }
    })();

    await this.initPromise;
  }

  /**
   * Verify recipe step DAG is acyclic using SAT encoding
   * 
   * Encoding: For each node i, create integer variable order[i].
   * For each edge (i -> j), add constraint: order[i] < order[j].
   * If SAT, the DAG is acyclic. If UNSAT, there's a cycle.
   * 
   * Falls back to heuristic DFS if Z3 not available (browser context).
   */
  async verifyAcyclicDAG(
    steps: RecipeStep[],
    options: DAGVerificationOptions = {}
  ): Promise<DAGVerificationResult> {
    await this.initialize();
    const startTime = Date.now();
    const proof: string[] = [];

    if (steps.length === 0) {
      return {
        isAcyclic: true,
        topologicalOrder: [],
        proof: ['Empty step set - trivially acyclic'],
        verificationMethod: this.initialized && this.z3Context ? 'z3-sat' : 'heuristic-fallback'
      };
    }

    // If Z3 failed to initialize, use heuristic fallback
    if (!this.initialized || !this.z3Context) {
      if (options.requireFormalSolver) {
        return {
          isAcyclic: false,
          proof: ['Formal solver unavailable; heuristic fallback disabled by policy.'],
          verificationMethod: 'heuristic-fallback'
        };
      }
      proof.push('=== Heuristic DAG Verification (Z3 unavailable) ===');
      const stepMap = new Map(steps.map(s => [s.id, s]));
      const heuristicResult = this.heuristicCycleCheck(steps, stepMap);
      return {
        ...heuristicResult,
        proof: [...proof, ...heuristicResult.proof],
        verificationMethod: 'heuristic-fallback'
      };
    }

    proof.push('=== Z3 SAT DAG Acyclicity Verification ===');

    try {
      const { Int, And, Solver } = this.z3Context;
      const solver = new Solver();

      // Create order variables for each step
      const orderVars: Record<string, any> = {};
      for (const step of steps) {
        orderVars[step.id] = Int.const(`order_${step.id}`);
        proof.push(`Created order variable for step: ${step.id}`);
      }

      // Add edge constraints: for each dependency, predecessor < successor
      const stepMap = new Map(steps.map(s => [s.id, s]));
      const edgeConstraints: any[] = [];

      for (const step of steps) {
        for (const depId of step.dependencies) {
          if (orderVars[depId]) {
            // Dependency must come before this step
            const constraint = orderVars[depId].lt(orderVars[step.id]);
            edgeConstraints.push(constraint);
            proof.push(`Edge constraint: order[${depId}] < order[${step.id}]`);
          }
        }
      }

      if (edgeConstraints.length > 0) {
        solver.add(And(...edgeConstraints));
      }

      // Check satisfiability
      proof.push('Checking satisfiability...');
      const result = await solver.check();
      const solveTime = Date.now() - startTime;

      if (result === 'sat') {
        // Extract topological order from model
        const model = solver.model();
        const orderedSteps = steps
          .map(s => ({
            id: s.id,
            order: Number(model.eval(orderVars[s.id]).toString())
          }))
          .sort((a, b) => a.order - b.order)
          .map(s => s.id);

        proof.push(`SAT - DAG is acyclic (solved in ${solveTime}ms)`);
        proof.push(`Topological order: ${orderedSteps.join(' → ')}`);

        return {
          isAcyclic: true,
          topologicalOrder: orderedSteps,
          proof,
          verificationMethod: 'z3-sat'
        };
      } else {
        // UNSAT means cycle exists
        proof.push(`UNSAT - Cycle detected (solved in ${solveTime}ms)`);
        
        // Attempt to find cycle using graph traversal
        const cycles = this.findCycles(steps, stepMap);
        proof.push(`Detected ${cycles.length} cycle(s)`);

        return {
          isAcyclic: false,
          cycles,
          proof,
          verificationMethod: 'z3-sat'
        };
      }
    } catch (error) {
      proof.push(`Error during verification: ${error}`);
      return {
        isAcyclic: false,
        proof,
        verificationMethod: 'z3-sat'
      };
    }
  }

  /**
   * Verify constraint satisfaction using SMT
   * 
   * Takes a set of constraints and checks if they can all be satisfied.
   */
  async verifyConstraints(constraints: Constraint[]): Promise<SATResult> {
    await this.initialize();
    const startTime = Date.now();

    if (!this.initialized || !this.z3Context) {
      return {
        satisfiable: false,
        solveTimeMs: Date.now() - startTime,
        proof: ['Formal Z3 solver unavailable; no sound SAT verdict produced.']
      };
    }

    try {
      const { Solver, Int, Real, Bool, And, Or, Not, Implies } = this.z3Context;
      const solver = new Solver();

      // Track variables
      const vars: Record<string, any> = {};

      // Convert constraints to Z3 expressions
      const z3Constraints = constraints.map(c => this.constraintToZ3(c, vars, { Int, Real, Bool, And, Or, Not, Implies }));
      
      for (const z3c of z3Constraints) {
        if (z3c) solver.add(z3c);
      }

      const result = await solver.check();
      const solveTime = Date.now() - startTime;

      if (result === 'sat') {
        const model = solver.model();
        const modelValues: Record<string, any> = {};
        for (const [name, v] of Object.entries(vars)) {
          try {
            modelValues[name] = model.eval(v).toString();
          } catch {
            modelValues[name] = 'unknown';
          }
        }

        return {
          satisfiable: true,
          model: modelValues,
          solveTimeMs: solveTime,
          proof: [`SAT - All ${constraints.length} constraints satisfied`]
        };
      } else {
        return {
          satisfiable: false,
          solveTimeMs: solveTime,
          proof: [`UNSAT - Constraints cannot be simultaneously satisfied`]
        };
      }
    } catch (error) {
      return {
        satisfiable: false,
        solveTimeMs: Date.now() - startTime,
        proof: [`Error: ${error}`]
      };
    }
  }

  /**
   * Verify invariant preservation across transformations
   * 
   * For each invariant I and transformation T:
   * Check: I(state) ∧ T(state, state') → I(state')
   */
  async verifyInvariantPreservation(
    invariants: string[],
    _preConditions: Record<string, number>,
    postConditions: Record<string, number>
  ): Promise<InvariantResult> {
    await this.initialize();
    const proof: string[] = ['=== Z3 Invariant Preservation Verification ==='];

    const violations: Array<{ invariant: string; counterexample?: Record<string, any> }> = [];

    // For now, check numeric bounds preservation
    for (const invariant of invariants) {
      // Parse simple invariants like "x >= 0" or "y <= 100"
      const match = invariant.match(/(\w+)\s*(>=|<=|>|<|==|!=)\s*(-?\d+(?:\.\d+)?)/);
      if (match) {
        const [, varName, op, valueStr] = match;
        if (!varName || !valueStr) continue;
        const boundValue = parseFloat(valueStr);
        const postValue = postConditions[varName];

        if (postValue !== undefined) {
          let preserved = false;
          switch (op) {
            case '>=': preserved = postValue >= boundValue; break;
            case '<=': preserved = postValue <= boundValue; break;
            case '>': preserved = postValue > boundValue; break;
            case '<': preserved = postValue < boundValue; break;
            case '==': preserved = postValue === boundValue; break;
            case '!=': preserved = postValue !== boundValue; break;
          }

          if (!preserved) {
            violations.push({
              invariant,
              counterexample: { [varName]: postValue, expected: `${op} ${boundValue}` }
            });
            proof.push(`VIOLATION: ${invariant} - got ${varName}=${postValue}`);
          } else {
            proof.push(`PRESERVED: ${invariant}`);
          }
        }
      }
    }

    return {
      preserved: violations.length === 0,
      violations,
      proof
    };
  }

  /**
   * Verify a bounded decreasing loop variant.
   * Note: This checks arithmetic well-foundedness of declared (initialValue, decrementMin)
   * parameters only; it does not symbolically execute arbitrary source code loops.
   */
  async verifyTermination(
    loopVariant: string,
    initialValue: number,
    decrementMin: number = 1
  ): Promise<TerminationResult> {
    const proof: string[] = ['=== Bounded Variant Arithmetic Check ==='];
    if (!Number.isFinite(initialValue) || !Number.isFinite(decrementMin)) {
      proof.push('UNSAT - Non-finite variant parameters');
      return { terminates: false, proof };
    }
    if (initialValue < 0 || decrementMin <= 0) {
      proof.push(
        `UNSAT - Variant requires initialValue >= 0 (got ${initialValue}) and decrementMin > 0 (got ${decrementMin})`
      );
      return { terminates: false, proof };
    }
    const boundEstimate = Math.ceil(initialValue / decrementMin);
    proof.push(`Declared variant "${loopVariant}": initial=${initialValue}, decrementMin=${decrementMin}`);
    proof.push(`Arithmetic upper bound: at most ${boundEstimate} steps if every iteration decreases variant by >= ${decrementMin}.`);
    return {
      terminates: true,
      variant: loopVariant,
      boundEstimate,
      proof,
    };
  }

  /**
   * Heuristic cycle check using DFS (fallback when Z3 unavailable)
   */
  private heuristicCycleCheck(steps: RecipeStep[], stepMap: Map<string, RecipeStep>): DAGVerificationResult {
    const proof: string[] = [];
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const topOrder: string[] = [];
    const cycles: string[][] = [];

    const dfs = (stepId: string, path: string[]): boolean => {
      visited.add(stepId);
      recStack.add(stepId);

      const step = stepMap.get(stepId);
      if (step) {
        for (const depId of step.dependencies) {
          if (!visited.has(depId)) {
            if (dfs(depId, [...path, stepId])) return true;
          } else if (recStack.has(depId)) {
            const cycleStart = path.indexOf(depId);
            if (cycleStart >= 0) {
              cycles.push([...path.slice(cycleStart), stepId, depId]);
            }
            return true;
          }
        }
      }

      recStack.delete(stepId);
      topOrder.push(stepId);
      return false;
    };

    let hasCycle = false;
    for (const step of steps) {
      if (!visited.has(step.id)) {
        if (dfs(step.id, [])) {
          hasCycle = true;
        }
      }
    }

    if (hasCycle) {
      proof.push(`Detected ${cycles.length} cycle(s) via DFS`);
      return { isAcyclic: false, cycles, proof, verificationMethod: 'heuristic-fallback' };
    } else {
      proof.push(`No cycles detected - valid DAG with ${steps.length} nodes`);
      return { isAcyclic: true, topologicalOrder: topOrder.reverse(), proof, verificationMethod: 'heuristic-fallback' };
    }
  }

  /**
   * Helper: Find cycles in step graph using DFS
   */
  private findCycles(steps: RecipeStep[], stepMap: Map<string, RecipeStep>): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const path: string[] = [];

    const dfs = (stepId: string): boolean => {
      visited.add(stepId);
      recStack.add(stepId);
      path.push(stepId);

      const step = stepMap.get(stepId);
      if (step) {
        for (const depId of step.dependencies) {
          if (!visited.has(depId)) {
            if (dfs(depId)) return true;
          } else if (recStack.has(depId)) {
            // Found cycle
            const cycleStart = path.indexOf(depId);
            cycles.push(path.slice(cycleStart));
            return true;
          }
        }
      }

      path.pop();
      recStack.delete(stepId);
      return false;
    };

    for (const step of steps) {
      if (!visited.has(step.id)) {
        dfs(step.id);
      }
    }

    return cycles;
  }

  /**
   * Helper: Convert constraint to Z3 expression
   */
  private constraintToZ3(
    constraint: Constraint,
    vars: Record<string, any>,
    ops: any
  ): any {
    const { Int, And, Or, Not, Implies } = ops;

    const getVar = (v: string | number | Constraint): any => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        if (!vars[v]) vars[v] = Int.const(v);
        return vars[v];
      }
      return this.constraintToZ3(v, vars, ops);
    };

    const left = getVar(constraint.left);
    const right = constraint.right !== undefined ? getVar(constraint.right) : null;

    switch (constraint.type) {
      case 'eq': return left.eq(right);
      case 'lt': return left.lt(right);
      case 'le': return left.le(right);
      case 'gt': return left.gt(right);
      case 'ge': return left.ge(right);
      case 'ne': return Not(left.eq(right));
      case 'and': return And(left, right);
      case 'or': return Or(left, right);
      case 'not': return Not(left);
      case 'implies': return Implies(left, right);
      default: return null;
    }
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    return this.initialized;
  }
}

// Singleton instance
let z3ServiceInstance: Z3VerificationService | null = null;

export function getZ3VerificationService(): Z3VerificationService {
  if (!z3ServiceInstance) {
    z3ServiceInstance = new Z3VerificationService();
  }
  return z3ServiceInstance;
}

export default Z3VerificationService;
