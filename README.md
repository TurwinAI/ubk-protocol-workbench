# UBK Protocol Workbench (Turwin Labs)

> Live Research Site and Interactive Workbench: **[https://turwinlabs.org](https://turwinlabs.org)**

A clean-room, MIT-licensed open-source research prototype for bounded formal verification and epistemic abstention in generative systems:

1. **Quantitative SMT Verification (`QF_LRA` / `QF_LIA` in Z3 WASM):** Extracts real numeric parameters and physical/mathematical laws (Carnot thermal efficiency, Nyquist-Shannon sampling, Pigeonhole discrete capacity, Stirling comparison-sort lower bounds, critical-path latency budgets) and evaluates both law and claim directly in Z3. No tautologies (`x = x`) and no hardcoded `P ∧ ¬P` regex rubber stamps.
2. **Explicit Epistemic Abstention (`Umap`) & Evidence Tiers:** Every check reports one of four soundness grades (`FORMAL_SMT`, `STRUCTURAL_CHECK`, `HEURISTIC_PATTERN`, `UNVERIFIED`). When an objective lacks a formal model, the kernel records it in `Umap` and returns `UNVERIFIED` (`Unverified-Within-Bounds`) rather than a false pass. Open conjectures (such as P vs NP) are flagged, never rejected as impossible.
3. **Protocol-to-AST Graph Verification:** Compiles structured Markdown protocols into Ajv-validated `CompositeDocAst` graphs, verifies DAG acyclicity via Z3 integer ordering constraints (`order[u] < order[v]`), and mints deterministic SHA-256 `BoundedCertificate` records (hashed over canonical fields excluding wall-clock timestamps).

## Scope and Non-Claims

This prototype proves only the encoded arithmetic inequalities, linear quantum resource conservation (`logicParser.ts`), and DAG acyclicity shown in its inspectable trace. It does not verify arbitrary natural language, symbolically execute arbitrary source code, or settle open mathematical conjectures.

## Quickstart (Reproducible in Under 2 Minutes)

Prerequisites: **Node.js 20+** and **npm**.

```bash
git clone https://github.com/TurwinAI/ubk-protocol-workbench.git
cd ubk-protocol-workbench
npm ci
npm run build
SERVE_STATIC=true npm start
```

Open `http://127.0.0.1:8787` in a browser. Local execution runs the full Node.js Z3 WebAssembly solver offline in `replay` mode with zero API keys, zero cloud accounts, and zero external network traffic.

### Live BYOK Mode (Google Gemini API)

Copy `.env.example` to `.env` and supply your own key, or switch to **Live BYOK** in the Workbench UI and provide a key per request. Live mode fails loudly (`HTTP 400/401`) if the key is missing or rejected; it never silently falls back to canned responses.

## Verification and Release Gates

```bash
npm run typecheck      # Strict TypeScript compiler check
npm run build:all      # Vite SPA + Cloudflare Worker bundle
npm test               # 15 Vitest tests: Carnot/Nyquist/Pigeonhole/Sort counterfactuals, Umap abstention, Z3 DAG proof, edge parity
npm run test:e2e       # Headless Playwright E2E suite (live numeric flip, abstention, 2026 Research note, negative BYOK test)
npm run audit:release  # Secret scan, private-ID grep gate, and transitive MIT license audit
```

## Architecture

- `src/core-engine/`: `constraintEncoder.ts` (quantitative `QF_LRA`/`QF_LIA` encoders), `smtVerifier.ts` (Z3 WASM + epistemic tiers), `z3VerificationService.ts` (Z3 SAT DAG acyclicity), `logicParser.ts` (generalized linear ket conservation), `ubkKernel.ts`, `turwinKernel.ts`, `scientificValidationService.ts`, `oracles.ts`.
- `src/data/axiomDatabase/`: 12 plain JSON domain axiom and open-conjecture tables.
- `src/core/execution/` and `src/services/superagent/`: `planBuilder.ts`, `astPlanner.ts`, `GeminiToolExecutor.ts`, `ToolRegistry.ts`, `liveVerificationPacket.ts`.
- `src/server/`: Local Node/Express API (`index.ts`, `orchestrator.ts`, `benchmarks.ts`) with full native Z3 WASM.
- `src/worker/`: Cloudflare Workers runtime with exact ground/affine SMT evaluator (`z3-shim.ts`) powering `https://turwinlabs.org`.
- `src/ui/`: Offline-capable React research site (Overview, Workbench, Research Note, Repository Guide).

## License

[MIT](./LICENSE)
