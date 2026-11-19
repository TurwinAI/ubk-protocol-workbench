import React from 'react';
import { GITHUB_REPO_URL, SITE_URL, type RoutePath } from '../types';

interface ResearchPageProps {
  onNavigate: (path: RoutePath) => void;
}

export const ResearchPage: React.FC<ResearchPageProps> = ({ onNavigate }) => {
  return (
    <main className="container-narrow prose" data-testid="research-page">
      <div className="eyebrow">Research Note · Turwin Labs</div>
      <h1>Bounded Formal Verification for Generative Reasoning</h1>
      <p className="lead">
        Where the Universal Bounds Kernel came from, why probabilistic self-evaluation collapses at
        impossibility boundaries, and the open research agenda we are releasing to the community.
      </p>

      <div className="callout">
        <strong>Core Thesis:</strong> Treat the language model strictly as an <em>untrusted proposal
        generator</em>. Place every generated algorithm, scientific claim, or execution plan behind a
        bounded, deterministic verification kernel that can mint verifiable certificates of validity
        (<code>Unique-Correct</code>), explicit impossibility (<code>ImpCert</code>), or honest
        incompleteness (<code>Unresolved-Within-Bounds</code> + <code>Umap</code>).
      </div>

      <h2>1. Where This Idea Came From</h2>
      <p>
        This project began as an engineering problem while building multi-step AI protocol generators—systems
        that turn open-ended research or engineering objectives into structured step-by-step plans and
        executable artifacts. Early prototypes relied on standard &ldquo;LLM-as-a-Judge&rdquo; loops:
        one model proposed a design, and another model graded its quality.
      </p>
      <p>
        That pattern broke down systematically on hard constraints. When prompted with physically or
        mathematically impossible goals—such as designing an <code>O(n)</code> comparison-based sorting
        algorithm, building a closed-cycle heat engine above Carnot efficiency, or cloning an unknown
        quantum state <code>|ψ⟩</code>—a generative model will often write fluent, authoritative prose
        claiming success, and a probabilistic judge frequently agrees.
      </p>
      <p>
        Rather than trying to prompt-engineer away sycophancy, we moved the source of truth <em>outside</em>{' '}
        the language model: into formal SMT solving (Z3), domain axiom tables, deterministic resource-flow
        parsing, and hard compute/iteration bounds.
      </p>

      <h2>2. The Universal Bounds Kernel (UBK)</h2>
      <p>
        Instead of open-ended agent loops that burn tokens until a heuristic score looks high, the
        Universal Bounds Kernel models verification as a strictly bounded state transition over five
        explicit components:
      </p>

      <div className="formula-box">
        S = ( C<sub>ir</sub>, P<sub>log</sub>, R<sub>reg</sub>, B<sub>rem</sub>, U<sub>map</sub> )
      </div>

      <ul>
        <li>
          <strong>Constraint Intermediate Representation (<code>C<sub>ir</sub></code>):</strong>{' '}
          Natural-language objectives are encoded into explicit domain constraints and SMT-LIB2 formulas
          with recorded confidence and source provenance.
        </li>
        <li>
          <strong>Provenance Log (<code>P<sub>log</sub></code>):</strong> Append-only cryptographic commit
          history linking every transition hash to its canonical state block (<code>CSB</code>).
        </li>
        <li>
          <strong>Verified Artifact Registry (<code>R<sub>reg</sub></code>):</strong> Only candidates
          surviving all invariant gates are admitted; rejected candidates produce structured{' '}
          <code>ImpCert</code> exclusion boundaries or <code>Witness</code> counterexamples so the kernel
          cannot loop on previously refuted regions.
        </li>
        <li>
          <strong>Resource Budget (<code>B<sub>rem</sub></code>):</strong> Explicit ceilings on wall-clock
          time, iterations (<code>I_max</code>), explored paths (<code>R_max</code>), and consecutive
          failures (<code>F_max</code>).
        </li>
        <li>
          <strong>Unknown Region Map (<code>U<sub>map</sub></code>):</strong> Crucial for intellectual
          honesty. Whenever a claim cannot be formalized into SMT-LIB2, depends on semantic fallback, or
          runs in an environment without full Z3 WASM, the kernel records an explicit unknown region rather
          than pretending the check was mathematically sound.
        </li>
      </ul>

      <h2>3. Layered Verification &amp; Soundness Discipline</h2>
      <p>
        Inside the Turwin v4.0-FS Kernel, every candidate proposal passes through five structural
        invariants—<strong>Provenance (<code>Prov</code>)</strong>, <strong>Type Conformance
        (<code>TypeOK</code>)</strong>, <strong>Well-Formed AST (<code>ASTOK</code>)</strong>,{' '}
        <strong>Goal Coverage (<code>GoalOK</code>)</strong>, and <strong>Cycle Freedom
        (<code>CycleFree</code>)</strong>—followed by three domain-truth gates:
      </p>
      <ol>
        <li>
          <strong>Z3 SMT-LIB2 Satisfiability (<code>SMTVerifier</code>):</strong> Checks encoded constraints
          against Z3 WASM in Node (producing <code>SOUND</code> verdicts for <code>SAT</code>/<code>UNSAT</code>)
          paired with a fast-path theorem table for classical lower bounds (decision-tree sorting, halting
          undecidability, Shannon entropy limits).
        </li>
        <li>
          <strong>12-Domain Scientific Axiom Database:</strong> Structured JSON axiom and open-conjecture
          sets spanning complexity theory, thermodynamics, quantum mechanics, relativity, information
          theory, mathematics, biology, electrical, mechanical, control, materials, and reliability
          engineering.
        </li>
        <li>
          <strong>Resource-Flow Logic Parser:</strong> Parses step-by-step input/output transitions to catch
          conservation violations that escape keyword matching—for example, duplicating an unknown quantum
          state <code>|ψ⟩ → |ψ⟩ ⊗ |ψ⟩</code> in violation of the Quantum No-Cloning Theorem.
        </li>
      </ol>
      <p>
        Every run terminates with a deterministic <strong><code>BoundedCertificate</code></strong> carrying
        a SHA-256 fingerprint, compute accounting, and one of three mutually exclusive verdicts:{' '}
        <code>Unique-Correct</code>, <code>Unresolved-Within-Bounds</code>, or <code>Failure</code>.
      </p>

      <h2>4. Protocol-to-AST Execution</h2>
      <p>
        Formal verification is most useful when it connects directly to structured execution. Alongside the
        kernel, this release includes the <strong>Protocol-to-CompositeDoc-AST</strong> pipeline: a
        JSON-Schema-validated (Ajv) planner that compiles research protocols into executable node DAGs,
        auto-registers safe protocol tools, and packages outputs alongside a machine-readable{' '}
        <code>VerificationPublicPacket</code>.
      </p>

      <h2>5. Research Direction &amp; Open Problems</h2>
      <p>
        We are releasing this prototype under the MIT License because solving reliable verification for
        generative AI requires open, inspectable infrastructure—not closed benchmarks. Four research
        directions stand out immediately:
      </p>
      <ul>
        <li>
          <strong>Shrinking <code>U<sub>map</sub></code> via Neuro-Symbolic Auto-Formalization:</strong>{' '}
          Deterministic regex/pattern encoders cover known mathematical and physical bounds cleanly, but
          most real-world engineering specs still fall into <code>U<sub>map</sub></code>. Building
          round-trip-verified NL → SMT-LIB2 and NL → Lean 4 translators is the highest-leverage next step.
        </li>
        <li>
          <strong>Compositional Impossibility Algebras (<code>ImpCert</code> Pruning):</strong> Turning
          local failure witnesses into reusable exclusion constraints that prune entire subtrees of
          multi-step agent trajectories without re-querying the LLM.
        </li>
        <li>
          <strong>Proof-Carrying Execution Artifacts:</strong> Extending the CompositeDoc AST so every
          generated code, simulation, or report node carries a replayable machine-checkable proof bundle
          (Z3 unsat cores, Lean proof terms, or deterministic sandbox traces).
        </li>
        <li>
          <strong>Adversarial Impossibility Benchmarks:</strong> Expanding the 4 starter benchmarks in this
          workbench into a community-maintained suite measuring false-acceptance rates (hallucinated
          &ldquo;solutions&rdquo; to impossible problems) and false-rejection rates across frontier models.
        </li>
      </ul>

      <h2>6. Citing &amp; Reproducing</h2>
      <p>
        You can reproduce every claim on this page locally with real Z3 WASM in under two minutes from the{' '}
        <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
          open-source MIT repository
        </a>
        , or run the benchmarks directly in the browser right now.
      </p>

      <pre className="code-block">{`@software{turwinlabs_ubk_workbench_2026,
  author  = {Thompson, Paul},
  title   = {UBK Protocol Workbench: Universal Bounds Kernel and Formal Verification Prototype},
  year    = {2026},
  license = {MIT},
  url     = {${SITE_URL}},
  note    = {Source code: ${GITHUB_REPO_URL}}
}`}</pre>

      <div className="cta-row" style={{ marginTop: 28 }}>
        <button type="button" className="btn-primary" onClick={() => onNavigate('/workbench')}>
          Test These Proofs in the Workbench →
        </button>
        <button type="button" className="btn-secondary" onClick={() => onNavigate('/open-source')}>
          Read the Plain-English Repo Guide
        </button>
      </div>
    </main>
  );
};
