import React from 'react';
import { GITHUB_REPO_URL, SITE_URL, type RoutePath } from '../types';

interface ResearchPageProps {
  onNavigate: (path: RoutePath) => void;
}

export const ResearchPage: React.FC<ResearchPageProps> = ({ onNavigate }) => {
  return (
    <main className="container-narrow prose" data-testid="research-page">
      <div className="section-code">TECHNICAL NOTE · TURWIN LABS · 2026</div>
      <h1>Bounded Formal Verification for Generative Systems</h1>

      <div className="abstract">
        <strong>Abstract.</strong> Language models write plans and code fast, yet they often break
        physical laws and known mathematical limits. This technical note describes the Universal
        Bounds Kernel (UBK) and its protocol graph compiler. The system treats model text as an
        untrusted draft. It checks each draft under fixed step and failure caps, then emits a
        signed proof certificate, an impossibility proof, or a clear map of unproved claims.
      </div>

      <h2>1. Origin of the Problem</h2>
      <p>
        This prototype grew out of work on tools that translate short technical objectives into
        ordered procedure graphs. Early versions used a second language model to review the work of
        the first. That method caught format and style faults, yet it failed on strict mathematical
        and physical constraints.
      </p>
      <p>
        Ask a language model for a linear-time comparison sort, a heat engine above the Carnot
        limit, or a circuit that clones an unknown quantum state. It frequently writes fluent steps
        claiming success, and a second model reads that clean prose and approves it. To break that
        loop, we moved truth checks out of the language model and into deterministic solvers, domain
        axiom tables, and bounded run budgets.
      </p>

      <h2>2. State Model of the Universal Bounds Kernel</h2>
      <p>
        An open agent loop can exhaust compute without proving that a problem has a solution. The
        Universal Bounds Kernel restricts search to fixed limits and maintains a five-part state
        across every run:
      </p>

      <div className="formula-box">
        S = ( C<sub>ir</sub>, P<sub>log</sub>, R<sub>reg</sub>, B<sub>rem</sub>, U<sub>map</sub> )
      </div>

      <ul>
        <li>
          <strong>Constraint list (<code>C<sub>ir</sub></code>):</strong> Natural language goals
          are parsed into domain tags and SMT-LIB2 formulas with explicit confidence scores.
        </li>
        <li>
          <strong>Commit log (<code>P<sub>log</sub></code>):</strong> Each accepted state transition
          appends a cryptographic hash tied to its canonical state record.
        </li>
        <li>
          <strong>Candidate registry (<code>R<sub>reg</sub></code>):</strong> Only proposals that
          satisfy every gate enter the registry. Rejected drafts record an impossibility certificate
          (<code>ImpCert</code>) or witness so later rounds skip the same failed branch.
        </li>
        <li>
          <strong>Remaining budget (<code>B<sub>rem</sub></code>):</strong> Hard caps bound wall
          clock time, iteration count (<code>I_max</code>), branch count (<code>R_max</code>), and
          consecutive failures (<code>F_max</code>).
        </li>
        <li>
          <strong>Unknown region map (<code>U<sub>map</sub></code>):</strong> Claims that lack a
          formal rule, or runs executed without a full SMT solver, enter <code>U<sub>map</sub></code>.
          The kernel reports clear bounds on what it proved.
        </li>
      </ul>

      <h2>3. Verification Gates and Soundness</h2>
      <p>
        Inside the Turwin v4.0-FS kernel, each candidate meets five structural invariants:
        provenance (<code>Prov</code>), type match (<code>TypeOK</code>), valid syntax
        (<code>ASTOK</code>), goal match (<code>GoalOK</code>), and no cycles
        (<code>CycleFree</code>). Candidates that clear all five enter three domain checks.
      </p>
      <ol>
        <li>
          <strong>SMT proof check:</strong> Formal constraints run through Z3 WebAssembly in
          Node.js. Classical lower bounds, including comparison sort limits and the halting problem,
          also run in a fast decision table.
        </li>
        <li>
          <strong>Twelve domain axiom tables:</strong> Plain JSON files hold verified laws and open
          conjectures across mathematics, physics, quantum states, thermodynamics, information
          theory, biology, circuits, mechanics, control, materials, and reliability.
        </li>
        <li>
          <strong>Resource flow parser:</strong> Step text is parsed to track conserved state. If a
          quantum routine reads one unknown state <code>|ψ⟩</code> and writes{' '}
          <code>|ψ⟩ ⊗ |ψ⟩</code>, the parser emits a No-Cloning witness.
        </li>
      </ol>
      <p>
        Every run halts with a signed <code>BoundedCertificate</code> hashed with SHA-256. The
        record assigns one of three verdicts: <code>Unique-Correct</code>,{' '}
        <code>Unresolved-Within-Bounds</code>, or <code>Failure</code>.
      </p>

      <h2>4. Protocol Graph Execution</h2>
      <p>
        Formal checks matter most when bound to runnable plans. The codebase ships a schema-checked
        compiler that turns Markdown protocols into a directed graph called{' '}
        <code>CompositeDocAst</code>. Each node declares its modality, dependency order, and tool
        hooks, and emits output artifacts beside a machine-readable verification packet.
      </p>

      <h2>5. Research Direction and Open Problems</h2>
      <p>
        We release this codebase under the MIT license so independent groups can audit every check
        and test new methods on a common base. Four open problems direct our next work:
      </p>
      <ul>
        <li>
          <strong>Shrinking the unknown map:</strong> Pattern encoders capture textbook theorems
          well, yet most real engineering specs still land in <code>U<sub>map</sub></code>. Checked
          translation from plain English into SMT-LIB2 and Lean 4 is the main next step.
        </li>
        <li>
          <strong>Composing impossibility proofs:</strong> Local failure witnesses should combine
          into stronger exclusion clauses that prune invalid search branches before a model drafts
          later steps.
        </li>
        <li>
          <strong>Proof-carrying artifacts:</strong> Each plan graph node should ship a compact
          proof file, such as an unsat core, a Lean term, or a replay log, that any reader can
          check offline.
        </li>
        <li>
          <strong>Shared hard test suites:</strong> The four starter cases in this repository
          should expand into a broad suite measuring how often new models accept false or impossible
          goals.
        </li>
      </ul>

      <h2>6. Reproduction and Citation</h2>
      <p>
        Clone the{' '}
        <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
          public MIT repository
        </a>{' '}
        to run the full Node.js Z3 solver locally in three commands, or test the four reference cases
        directly inside the web workbench.
      </p>

      <pre className="code-block">{`@software{turwinlabs_ubk_workbench_2026,
  author  = {Thompson, Paul},
  title   = {UBK Protocol Workbench: Universal Bounds Kernel and Formal Verification Prototype},
  year    = {2026},
  license = {MIT},
  url     = {${SITE_URL}},
  note    = {Source code: ${GITHUB_REPO_URL}}
}`}</pre>

      <div className="cta-row" style={{ marginTop: 24 }}>
        <button type="button" className="btn-primary" onClick={() => onNavigate('/workbench')}>
          Open Workbench
        </button>
        <button type="button" className="btn-secondary" onClick={() => onNavigate('/open-source')}>
          Read Repository Guide
        </button>
      </div>
    </main>
  );
};
