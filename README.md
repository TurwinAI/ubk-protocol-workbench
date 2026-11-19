# UBK Protocol Workbench — Turwin Labs

> Live Research Site & Interactive Workbench: **[https://turwinlabs.org](https://turwinlabs.org)**

A clean-room, MIT-licensed open-source research prototype combining:

1. **Universal Bounds Kernel (UBK) & Turwin v4.0-FS Formal Verification Kernel** — bounded candidate verification with real **Z3 WASM SMT-LIB2 solving** in Node.js, a **12-domain scientific axiom database**, quantum resource-flow no-cloning analysis, semantic novelty gating, and deterministic `BoundedCertificate` / `ImpCert` / `Witness` minting.
2. **Protocol-to-CompositeDoc-AST Execution Workbench** — compiles structured Markdown research protocols into Ajv-validated execution DAGs (`CompositeDocAst`), runs verification locally or at the edge, and presents results in a modern React research website with Overview, Interactive Workbench, Research Paper, and Open-Source Repo Guide pages.

## Quickstart (Reproducible in < 2 Minutes)

Prerequisites: **Node.js 20+** and **npm**.

```bash
git clone https://github.com/realsuperheavy/ubk-protocol-workbench.git
cd ubk-protocol-workbench
npm ci
npm run build
SERVE_STATIC=true npm start
```

Open `http://127.0.0.1:8787` in your browser.

Out of the box, the workbench runs in **`replay` mode** (zero API keys, zero cloud accounts, zero external network calls): candidate protocols are evaluated by the **real Node.js Z3 WASM SMT solver**, **12-domain scientific axiom database**, and **Turwin v4.0-FS Kernel**.

### Development Mode (Hot Reload UI + API)

```bash
npm run dev
```

- API Server: `http://127.0.0.1:8787`
- Vite UI: `http://127.0.0.1:5175`

### Live BYOK Mode (Google Gemini API)

Copy `.env.example` to `.env` and set your own key:

```bash
cp .env.example .env
# Edit .env:
# PROTOTYPE_MODE=live
# GEMINI_API_KEY=your_key_here
```

Or switch to **Live BYOK (Gemini)** in the Workbench UI and provide a key per request. Live mode fails loudly (`HTTP 400/401`) if the key is missing or rejected—it never silently falls back to canned responses.

## Verification & Open-Source Release Gates

```bash
npm run typecheck      # TypeScript compiler check
npm run build:all      # Clean Vite SPA + Cloudflare Worker bundle
npm test               # Vitest unit + real Node Z3 WASM + API & fault-injection suite
npm run test:e2e       # Headless Playwright E2E suite (4 pages, Z3 SAT/IMPOSSIBLE, live-key negative test)
npm run audit:release  # Secret scan, private-ID grep gate, and transitive MIT license audit
```

## Architecture

- `src/core-engine/` — `ubkKernel.ts`, `turwinKernel.ts`, `smtVerifier.ts` (Z3 WASM in Node), `constraintEncoder.ts`, `logicParser.ts`, `scientificValidationService.ts`, `z3VerificationService.ts`, `noveltyScoring.ts`, `oracles.ts` (optional pluggable oracle interfaces).
- `src/data/axiomDatabase/` — 12 plain JSON scientific & mathematical axiom sets (complexity theory, thermodynamics, quantum mechanics, relativity, information theory, mathematics, biology, electrical, mechanical, control, materials, reliability).
- `src/core/execution/` & `src/services/superagent/` — `planBuilder.ts`, `astPlanner.ts`, `GeminiToolExecutor.ts`, `ToolRegistry.ts`, `liveVerificationPacket.ts`.
- `src/server/` — Local Node/Express API (`index.ts`, `orchestrator.ts`, `benchmarks.ts`) with full native Z3 WASM.
- `src/worker/` — Cloudflare Workers + Workers Static Assets runtime powering `https://turwinlabs.org`.
- `src/ui/` — Modern offline-capable React website (Overview, Workbench, Research, Open Source).

## License

[MIT](./LICENSE)
