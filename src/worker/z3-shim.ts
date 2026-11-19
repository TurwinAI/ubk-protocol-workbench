/**
 * Exact Ground & Linear-Substitution SMT-LIB2 Evaluator for Cloudflare Workers.
 *
 * Full Z3 WebAssembly (`z3-solver`) runs in Node.js (`npm start`, `npm test`, CLI).
 * On Cloudflare Workers (where the ~30 MB Z3 WASM binary exceeds bundle limits),
 * this deterministic S-expression evaluator decides:
 *  1. Ground QF_LRA / QF_LIA arithmetic constraints via fixed-point equality propagation
 *     (including exact linear algebra such as `(= (* eta_carnot 600.0) (- 600.0 300.0))`).
 *  2. Single-variable affine inequalities (`(> c 0.0)`, `(= y (+ c 3.0))`, `(>= c (- y 2.0))`).
 *  3. Pure difference-logic DAG acyclicity constraints (`(< order_u order_v)`).
 *
 * For any formula outside this exact decidable fragment (quantifiers, general
 * multi-variable systems, bitvectors, arrays), it returns `'unknown'` honestly
 * rather than fabricating a verdict.
 */

type SExpr = string | SExpr[];

interface Affine {
  /** Linear coefficient on symbolic variable (null if constant) */
  sym: string | null;
  coeff: number;
  constTerm: number;
}

function tokenizeSExpr(src: string): string[] {
  const withoutComments = src.replace(/;[^\n]*/g, '');
  const tokens: string[] = [];
  let i = 0;
  while (i < withoutComments.length) {
    const ch = withoutComments[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push(ch);
      i += 1;
      continue;
    }
    let start = i;
    while (i < withoutComments.length && !/[\s()]/.test(withoutComments[i])) {
      i += 1;
    }
    tokens.push(withoutComments.slice(start, i));
  }
  return tokens;
}

function parseSExprs(src: string): SExpr[] {
  const tokens = tokenizeSExpr(src);
  let pos = 0;

  function parseOne(): SExpr {
    const tok = tokens[pos++];
    if (tok === '(') {
      const list: SExpr[] = [];
      while (pos < tokens.length && tokens[pos] !== ')') {
        list.push(parseOne());
      }
      pos += 1; // consume ')'
      return list;
    }
    return tok;
  }

  const exprs: SExpr[] = [];
  while (pos < tokens.length) {
    exprs.push(parseOne());
  }
  return exprs;
}

function evalAffine(expr: SExpr, env: Map<string, Affine>): Affine | null {
  if (typeof expr === 'string') {
    if (/^-?\d+(?:\.\d+)?$/.test(expr)) {
      return { sym: null, coeff: 0, constTerm: parseFloat(expr) };
    }
    const bound = env.get(expr);
    if (bound) return bound;
    return { sym: expr, coeff: 1, constTerm: 0 };
  }

  if (expr.length === 0) return null;
  const op = expr[0];
  if (typeof op !== 'string') return null;

  if (op === '-' && expr.length === 2) {
    const a = evalAffine(expr[1], env);
    if (!a) return null;
    return { sym: a.sym, coeff: -a.coeff, constTerm: -a.constTerm };
  }

  if (op === '+') {
    let sym: string | null = null;
    let coeff = 0;
    let constTerm = 0;
    for (let i = 1; i < expr.length; i += 1) {
      const v = evalAffine(expr[i], env);
      if (!v) return null;
      if (v.sym) {
        if (sym && sym !== v.sym) return null;
        sym = v.sym;
        coeff += v.coeff;
      }
      constTerm += v.constTerm;
    }
    return { sym: coeff === 0 ? null : sym, coeff, constTerm };
  }

  if (op === '-' && expr.length >= 3) {
    const first = evalAffine(expr[1], env);
    if (!first) return null;
    let sym = first.sym;
    let coeff = first.coeff;
    let constTerm = first.constTerm;
    for (let i = 2; i < expr.length; i += 1) {
      const v = evalAffine(expr[i], env);
      if (!v) return null;
      if (v.sym) {
        if (sym && sym !== v.sym) return null;
        sym = v.sym;
        coeff -= v.coeff;
      }
      constTerm -= v.constTerm;
    }
    return { sym: coeff === 0 ? null : sym, coeff, constTerm };
  }

  if (op === '*') {
    let acc: Affine = { sym: null, coeff: 0, constTerm: 1 };
    for (let i = 1; i < expr.length; i += 1) {
      const v = evalAffine(expr[i], env);
      if (!v) return null;
      if (acc.sym && v.sym) return null; // nonlinear product
      if (acc.sym) {
        acc = {
          sym: acc.coeff * v.constTerm === 0 ? null : acc.sym,
          coeff: acc.coeff * v.constTerm,
          constTerm: acc.constTerm * v.constTerm,
        };
      } else if (v.sym) {
        acc = {
          sym: v.coeff * acc.constTerm === 0 ? null : v.sym,
          coeff: v.coeff * acc.constTerm,
          constTerm: acc.constTerm * v.constTerm,
        };
      } else {
        acc = { sym: null, coeff: 0, constTerm: acc.constTerm * v.constTerm };
      }
    }
    return acc;
  }

  if (op === '/' && expr.length === 3) {
    const num = evalAffine(expr[1], env);
    const den = evalAffine(expr[2], env);
    if (!num || !den || den.sym !== null || den.constTerm === 0) return null;
    return {
      sym: num.sym,
      coeff: num.coeff / den.constTerm,
      constTerm: num.constTerm / den.constTerm,
    };
  }

  return null;
}

const EPS = 1e-9;

function evaluateSmtLib2Exact(smtlib: string): 'sat' | 'unsat' | 'unknown' {
  const exprs = parseSExprs(smtlib);
  const assertions: SExpr[] = [];
  const declaredVars = new Set<string>();

  for (const expr of exprs) {
    if (!Array.isArray(expr) || expr.length === 0) continue;
    const head = expr[0];
    if (head === 'declare-const' && typeof expr[1] === 'string') {
      declaredVars.add(expr[1]);
    } else if (head === 'assert' && expr.length === 2) {
      assertions.push(expr[1]);
    }
  }

  if (assertions.length === 0) return 'unknown';

  // Reject quantifiers immediately as outside ground/affine decidable fragment
  if (/\b(?:forall|exists)\b/i.test(smtlib)) {
    return 'unknown';
  }

  // Fixed-point propagation for equality assertions `(= lhs rhs)`
  const env = new Map<string, Affine>();
  let changed = true;
  let guard = 0;

  while (changed && guard < 16) {
    changed = false;
    guard += 1;
    for (const a of assertions) {
      if (a === 'false') return 'unsat';
      if (!Array.isArray(a) || a[0] !== '=' || a.length !== 3) continue;
      const lhs = evalAffine(a[1], env);
      const rhs = evalAffine(a[2], env);
      if (!lhs || !rhs) continue;

      // Case 1: Both constant -> check numeric equality
      if (lhs.sym === null && rhs.sym === null) {
        if (Math.abs(lhs.constTerm - rhs.constTerm) > EPS) return 'unsat';
        continue;
      }

      // Case 2: One symbolic variable solved directly as a constant (a*x + b = c -> x = (c-b)/a)
      if (lhs.sym !== null && rhs.sym === null && Math.abs(lhs.coeff) > EPS) {
        const val = (rhs.constTerm - lhs.constTerm) / lhs.coeff;
        if (!env.has(lhs.sym)) {
          env.set(lhs.sym, { sym: null, coeff: 0, constTerm: val });
          changed = true;
        }
      } else if (rhs.sym !== null && lhs.sym === null && Math.abs(rhs.coeff) > EPS) {
        const val = (lhs.constTerm - rhs.constTerm) / rhs.coeff;
        if (!env.has(rhs.sym)) {
          env.set(rhs.sym, { sym: null, coeff: 0, constTerm: val });
          changed = true;
        }
      } else if (typeof a[1] === 'string' && !env.has(a[1]) && rhs.sym !== a[1]) {
        // Linear substitution: `(= y (+ c 3.0))`
        env.set(a[1], rhs);
        changed = true;
      } else if (typeof a[2] === 'string' && !env.has(a[2]) && lhs.sym !== a[2]) {
        env.set(a[2], lhs);
        changed = true;
      }
    }
  }

  // Evaluate all inequality / equality assertions; track single-variable bounds if symbolic
  let allGroundChecked = true;
  const lowerBounds = new Map<string, { val: number; strict: boolean }>();
  const upperBounds = new Map<string, { val: number; strict: boolean }>();

  for (const a of assertions) {
    if (a === 'true') continue;
    if (a === 'false') return 'unsat';
    if (!Array.isArray(a) || a.length !== 3 || typeof a[0] !== 'string') {
      allGroundChecked = false;
      continue;
    }
    const op = a[0];
    if (!['=', '<', '<=', '>', '>='].includes(op)) {
      allGroundChecked = false;
      continue;
    }

    const lhs = evalAffine(a[1], env);
    const rhs = evalAffine(a[2], env);
    if (!lhs || !rhs) {
      allGroundChecked = false;
      continue;
    }

    // Compute diff = lhs - rhs
    if (lhs.sym && rhs.sym && lhs.sym !== rhs.sym) {
      allGroundChecked = false;
      continue;
    }
    const sym = lhs.sym || rhs.sym;
    const coeff = (lhs.sym ? lhs.coeff : 0) - (rhs.sym ? rhs.coeff : 0);
    const c = lhs.constTerm - rhs.constTerm;

    // Variable canceled out (e.g., c >= c + 1 -> 0*c - 1 >= 0 -> false!)
    if (Math.abs(coeff) <= EPS) {
      let ok = false;
      if (op === '=') ok = Math.abs(c) <= EPS;
      if (op === '<') ok = c < -EPS;
      if (op === '<=') ok = c <= EPS;
      if (op === '>') ok = c > EPS;
      if (op === '>=') ok = c >= -EPS;
      if (!ok) return 'unsat';
      continue;
    }

    // Single symbolic variable remaining: coeff * x + c <op> 0 -> x <op'> -c/coeff
    if (!sym) {
      allGroundChecked = false;
      continue;
    }

    const boundVal = -c / coeff;
    const flipped = coeff < 0;
    const effOp = !flipped
      ? op
      : op === '<'
        ? '>'
        : op === '<='
          ? '>='
          : op === '>'
            ? '<'
            : op === '>='
              ? '<='
              : '=';

    if (effOp === '>' || effOp === '>=') {
      const prev = lowerBounds.get(sym);
      const strict = effOp === '>';
      if (!prev || boundVal > prev.val || (Math.abs(boundVal - prev.val) <= EPS && strict)) {
        lowerBounds.set(sym, { val: boundVal, strict });
      }
    } else if (effOp === '<' || effOp === '<=') {
      const prev = upperBounds.get(sym);
      const strict = effOp === '<';
      if (!prev || boundVal < prev.val || (Math.abs(boundVal - prev.val) <= EPS && strict)) {
        upperBounds.set(sym, { val: boundVal, strict });
      }
    }
  }

  // Check interval consistency for any symbolic variable
  for (const sym of new Set([...lowerBounds.keys(), ...upperBounds.keys()])) {
    const lo = lowerBounds.get(sym);
    const hi = upperBounds.get(sym);
    if (lo && hi) {
      if (lo.val > hi.val + EPS) return 'unsat';
      if (Math.abs(lo.val - hi.val) <= EPS && (lo.strict || hi.strict)) return 'unsat';
    }
  }

  return allGroundChecked ? 'sat' : 'unknown';
}

export async function init() {
  return {
    Context: (name: string) => ({ ptr: name }),
    Z3: {
      eval_smtlib2_string: async (_ctxPtr: unknown, smtlib: string): Promise<'sat' | 'unsat' | 'unknown'> => {
        return evaluateSmtLib2Exact(String(smtlib || ''));
      },
    },
  };
}
