import React from 'react';
import { GITHUB_REPO_URL, SITE_URL, type RoutePath } from '../types';

interface ResearchPageProps {
  onNavigate: (path: RoutePath) => void;
}

export const ResearchPage: React.FC<ResearchPageProps> = ({ onNavigate }) => {
  return (
    <main className="container-narrow prose" data-testid="research-page">
      <div className="section-code">TECHNICAL NOTE · TURWIN LABS · NOVEMBER 2026</div>
      <h1>Bounded Formal Verification and Epistemic Abstention for Generative Systems</h1>

      <div className="abstract">
        <strong>Abstract.</strong> Language models write plans and code fast, yet they often break
        physical laws and known mathematical limits. This note presents the Universal Bounds Kernel
        (UBK) and its protocol graph engine. The system checks numeric claims with Z3 SMT solving,
        verifies graph order without cycles, and refuses to fake a pass when prose lacks a formal
        model. Every run halts inside fixed step and failure caps, writing a signed certificate, a
        disproof witness, or an explicit unknown map called <code>U<sub>map</sub></code>.
      </div>

      <h2>1. Background and 2023 to 2026 Literature</h2>
      <p>
        Early neuro-symbolic frameworks showed that pairing language models with formal solvers
        cuts reasoning errors. Logic-LM (Pan et al., 2023), SatLM (Ye et al., 2023), and LINC
        (Olausson et al., 2023) used language models as semantic parsers that translate prose into
        first-order logic or SAT constraints checked by Z3 or Prover9.
      </p>
      <p>
        Work in 2026 exposed deeper failure modes in that pipeline. A NeurIPS 2026 study on
        common-mode failure (Three Agents Are Not Three Verifiers) showed that multi-agent model
        voting fails on shared errors and still needs non-model proof gates. NSVIF (Su et al., Jan
        2026) framed instruction following as constraint solving inside Z3. SOVER (Bhattacharyya
        and Baranwal, Sep 2026) kept language models restricted to mapping while leaving
        certification strictly to Z3 and dReal. SHADOWBENCH (Aug 2026) showed that type checks
        alone miss semantic drift under small numeric edits, such as changing one constant inside
        an otherwise identical claim.
      </p>
      <p>
        Our prototype builds directly on those 2026 findings. We removed internal model self-judging
        from the trusted checking base and added strict epistemic abstention. When a claim cannot be
        encoded into an actual arithmetic or structural model, the kernel logs it in{' '}
        <code>U<sub>map</sub></code> and outputs <code>UNVERIFIED</code> rather than a false pass.
      </p>

      <h2>2. State Vector and Epistemic Evidence Tiers</h2>
      <p>
        Open agent loops can burn compute without proving a task can be solved. The Universal Bounds
        Kernel restricts execution to fixed step, branch, and failure limits and tracks a five-part
        state across every run:
      </p>

      <div className="formula-box">
        S = ( C<sub>ir</sub>, P<sub>log</sub>, R<sub>reg</sub>, B<sub>rem</sub>, U<sub>map</sub> )
      </div>

      <ul>
        <li>
          <strong>Constraint list (<code>C<sub>ir</sub></code>):</strong> Quantitative claims parse
          into executable QF_LRA or QF_LIA SMT-LIB2 formulas asserting both the domain law and the
          candidate numbers.
        </li>
        <li>
          <strong>Commit log (<code>P<sub>log</sub></code>):</strong> Each accepted step appends a
          deterministic state hash (FNV-1a for loop checks; SHA-256 on the final certificate over
          canonical fields excluding wall-clock time).
        </li>
        <li>
          <strong>Candidate registry (<code>R<sub>reg</sub></code>):</strong> Accepted candidates
          and impossibility certificates (<code>ImpCert</code>) enter a bounded registry capped by{' '}
          <code>R_max</code>.
        </li>
        <li>
          <strong>Remaining budget (<code>B<sub>rem</sub></code>):</strong> Hard caps bound wall
          clock time, iteration count (<code>I_max</code>), branch count (<code>R_max</code>), and
          consecutive failures (<code>F_max</code>).
        </li>
        <li>
          <strong>Unknown region map (<code>U<sub>map</sub></code>):</strong> Prose objectives or
          unparsed formulas enter <code>U<sub>map</sub></code>. A non-empty map forces the verdict to{' '}
          <code>UNVERIFIED</code>.
        </li>
      </ul>

      <p>
        Every check reports one of four explicit evidence grades so a reader never confuses a
        keyword filter with a proof: <code>FORMAL_SMT</code> (solved by Z3 or exact ground
        arithmetic), <code>STRUCTURAL_CHECK</code> (linear resource conservation or DAG order),{' '}
        <code>HEURISTIC_PATTERN</code> (curated qualitative axiom match), or <code>UNVERIFIED</code>.
      </p>

      <h2>3. Quantitative Models and Counterfactual Sensitivity</h2>
      <p>
        Prior drafts of this codebase contained SMT theater, such as reflexive tautologies and
        regexes that handed Z3 hardcoded contradictions. We stripped those out. Each active encoder
        now binds real numeric parameters from the input and lets the solver decide feasibility:
      </p>
      <ol>
        <li>
          <strong>Carnot thermal bounds (QF_LRA):</strong> Extracts reservoir temperatures and
          claimed efficiency, asserting both the Carnot ceiling and the claimed rate. Changing 40%
          to 65% between 600 K and 300 K flips Z3 from <code>SAT</code> to <code>UNSAT</code> on
          identical phrasing.
        </li>
        <li>
          <strong>Nyquist sampling bounds (QF_LRA):</strong> Parses signal bandwidth and sampling
          rate in Hz through GHz, solving <code>f_s &gt;= 2 * f_max</code> directly in Z3.
        </li>
        <li>
          <strong>Discrete capacity and sorting lower bounds (QF_LIA / QF_LRA):</strong> Checks
          integer allocation bounds and exact Stirling comparison-sort limits instead of naive
          substring matches.
        </li>
        <li>
          <strong>Linear quantum resource flow and DAG acyclicity:</strong> Parses ket notation
          across steps to catch unknown-state duplication (No-Cloning), while Z3 checks{' '}
          <code>order[u] &lt; order[v]</code> across compiled <code>CompositeDocAst</code> graph
          nodes to prove acyclicity.
        </li>
      </ol>

      <h2>4. Threat Model and Explicit Non-Claims</h2>
      <p>
        Honest research states what a prototype does not prove. This kernel does not verify
        arbitrary natural language, does not execute source code symbolically, and does not settle
        open conjectures such as P vs NP or integer factoring (which are marked{' '}
        <code>Flagged</code>, never rejected as impossible). Its formal guarantees cover only the
        encoded arithmetic inequalities, linear state counts, and graph order relations shown in the
        inspectable trace.
      </p>
      <p>
        On local Node.js, the full Z3 WebAssembly binary solves every SMT-LIB2 file. On the edge web
        deployment at <code>turwinlabs.org</code>, a compact exact ground-and-affine evaluator
        decides linear formulas and returns <code>unknown</code> honestly for quantified formulas
        outside its fragment.
      </p>

      <h2>5. Open Research Direction</h2>
      <ul>
        <li>
          <strong>Semantic alignment under perturbation:</strong> Extend the five starter cases
          with SHADOWBENCH-style local counterfactual edits to test whether LLM autoformalizers
          preserve exact constants and quantifiers.
        </li>
        <li>
          <strong>Minimal unsat-core feedback:</strong> Feed Z3 unsat cores back into candidate
          repair loops so models revise only the conflicting bound.
        </li>
        <li>
          <strong>Proof-carrying protocol nodes:</strong> Attach Lean 4 proof terms or checkable
          unsat cores to every <code>CompositeDocAst</code> node artifact.
        </li>
      </ul>

      <h2>6. References and Citation</h2>
      <ol>
        <li>
          Pan, L. et al. (2023). <em>Logic-LM: Empowering Large Language Models with Symbolic
          Solvers for Faithful Logical Reasoning.</em> arXiv:2305.12295.
        </li>
        <li>
          Ye, X. et al. (2023). <em>SatLM: Satisfiability-Aided Language Models Using Declarative
          Prompting.</em> arXiv:2305.09656.
        </li>
        <li>
          Olausson, T. et al. (2023). <em>LINC: A Neuro-Symbolic Approach for Logical Reasoning by
          Combining Large Language Models with First-Order Logic Solvers.</em> arXiv:2310.15164.
        </li>
        <li>
          Su, Y., Xu, K., Gao, Y., Yang, F., Li, C., Yang, M., and Xu, T. (Jan 2026).{' '}
          <em>Neuro-Symbolic Verification on Instruction Following of LLMs (NSVIF).</em>{' '}
          arXiv:2601.17789.
        </li>
        <li>
          <em>SHADOWBENCH: Toward Reliable Automatic Evaluation of Semantic Alignment in
          Autoformalization.</em> (Aug 2026). Lean 4 benchmark and SA-Pass metric.
        </li>
        <li>
          Bhattacharyya, S. and Baranwal, M. (Sep 2026). <em>SOVER: Formal Certification of
          Optimization Reformulations via LLM-Assisted SMT Verification.</em> arXiv:2609.00728.
        </li>
        <li>
          <em>Three Agents Are Not Three Verifiers: Measuring Common-Mode Failure in LLM
          Verification.</em> (NeurIPS 2026).
        </li>
      </ol>

      <p>
        Clone the{' '}
        <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
          public MIT repository
        </a>{' '}
        to inspect every encoder, test counterfactual pairs locally in Node.js Z3, or run the live
        instrument in the workbench.
      </p>

      <pre className="code-block">{`@software{turwinlabs_ubk_workbench_2026,
  author  = {Thompson, Paul},
  title   = {UBK Protocol Workbench: Bounded Formal Verification and Epistemic Abstention Prototype},
  year    = {2026},
  license = {MIT},
  url     = {${SITE_URL}},
  note    = {Source code: ${GITHUB_REPO_URL}}
}`}</pre>

      <div className="cta-row" style={{ marginTop: 24 }}>
        <button type="button" className="btn-primary" onClick={() => onNavigate('/workbench')}>
          Open Workbench
        </button>
        <button type="button" className="link-action" onClick={() => onNavigate('/open-source')}>
          Read Repository Guide
        </button>
      </div>
    </main>
  );
};
