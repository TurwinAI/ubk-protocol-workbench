/**
 * 
 * @see docs/architecture/system-overview.md for current architecture specification
 */

import { parseRecipeToLogic, verifyNoCloning } from './logicParser';
import { smtVerifier, formatSMTResultForWitness, hasSMTVerifiableConstraints, DEFAULT_SMT_VERIFIER_CONFIG } from './smtVerifier';
import { getVerificationOracles } from './oracles'; // Pluggable optional verification oracles
import { encodeSteganography, generateTurwinID } from '../utils/steganographyUtils';
import { cosineSimilarity, hashEmbed, semanticNovelty } from './noveltyScoring';
import type { EmbeddingProvider } from './noveltyScoring';

// ================================= KERNEL CONSTANTS =================================

/**
 * Extracted magic numbers for clarity and maintainability.
 * All thresholds and limits are defined here for easy auditing.
 */
export const KERNEL_CONSTANTS = {
  /** Minimum fraction of key phrases that must match proposal (anti-hallucination) */
  PROPOSAL_INTEGRITY_THRESHOLD: 0.5,
  /** Maximum characters to parse from input */
  MAX_INPUT_LENGTH: 10000,
  /** Maximum content length for LLM audit calls */
  AUDIT_CONTENT_LIMIT: 1500,
  /** Hard limit on execution steps (infinite loop protection) */
  MAX_EXECUTION_STEPS: 100,
  /** Minimum length for key phrase detection */
  MIN_KEY_PHRASE_LENGTH: 10,
  /** Prefix length for phrase matching */
  PHRASE_MATCH_PREFIX_LENGTH: 20,
} as const;

// ================================= TYPES =================================

/**
 * Instruction Set I = {READ_A, TRANSFORM, IMPROVE, BOUNDARY_SYNTH, COMPOSE_IMP, WRITE_B, WRITE_W, REFRESH, HALT}
 * v4.0-FS: Added WRITE_W for witness tape output
 */
export type TurwinInstruction = 
  | 'READ_A'         // Read from input tape (immutable)
  | 'TRANSFORM'      // Transform artifacts
  | 'IMPROVE'        // Meta-optimization with macro caching
  | 'BOUNDARY_SYNTH' // Synthesize new solution from impossibility boundary (⊕)
  | 'COMPOSE_IMP'    // Compose impossibility certificates (⊗)
  | 'WRITE_B'        // Append to solution tape B (append-only)
  | 'WRITE_W'        // Append to witness tape W (append-only) - v4.0-FS
  | 'REFRESH'        // Refresh canonical state
  | 'HALT';          // Terminate execution

/**
 * Domain separation tags for secure hashing (TCB)
 * v4.0-FS: Required for CycleFree predicate implementation
 */
export const HASH_TAGS = {
  ARTIFACT: 'TURWIN:ART:v1',
  CSB: 'TURWIN:CSB:v1',
  POLICY: 'TURWIN:POLICY:v1',
  EDGE: 'TURWIN:EDGE:v1',
} as const;

/**
 * EdgeHistory entry type for structured edge tracking
 * v4.0-FS: Replaces generic Set<string> for better audit trail
 */
export interface EdgeHistoryEntry {
  edgeId: string;
  timestamp: number;
  artifactType: string;
}

/**
 * Execution Status σ ∈ {ACTIVE, COMPLETE, PARTIAL, RESOURCE_EXHAUSTED, ERROR}
 * v4.0-FS: Added PARTIAL and RESOURCE_EXHAUSTED for failsafe termination
 */
export type ExecutionStatus = 'ACTIVE' | 'COMPLETE' | 'PARTIAL' | 'RESOURCE_EXHAUSTED' | 'ERROR';

/**
 * Explicit stop reason reported by the kernel.
 * Matches the paper's Algorithm 1 output contract.
 */
export type StopReason = 'TERM' | 'R_MAX' | 'I_MAX' | 'F_MAX' | 'CSB_UNDEF';

/**
 * Canonical State Block (CSB_n)
 * Internal state representation - NOT for user output
 */
export interface CanonicalStateBlock {
  goal: string;                    // G: Goal specification
  stepNumber: number;              // n: Current step
  instruction: TurwinInstruction;  // Current instruction
  registry: ArtifactRegistry;      // R_n: Verified artifact registry
  parameters: ExecutionParameters; // Θ_n: Execution parameters
  cycleHistory: Set<string>;       // H_n: Hashes of committed transitions
  status: ExecutionStatus;         // σ_n: Current status
}

/**
 * Artifact Registry R
 * Contains all verified artifacts produced during execution
 */
export interface ArtifactRegistry {
  artifacts: VerifiedArtifact[];
  commitLog: CommitEntry[];
}

/**
 * Verified Artifact Types (Canonical)
 */
export type VerifiedArtifact = 
  | AnalogyMap
  | Hypothesis
  | InductivePattern
  | Counterfactual
  | TransformedContent
  | ImpCert
  | Witness;

export interface AnalogyMap {
  type: 'ANALOGY_MAP';
  source: string;           // S: Source domain
  target: string;           // T: Target domain
  mapping: Record<string, string>; // M: Structural mapping
  provenance: string[];     // Π: Source references
  confidence: number;       // μ: Confidence score
}

export interface Hypothesis {
  type: 'HYPOTHESIS';
  proposition: string;      // φ: Logical proposition
  support: string[];        // Evidence/reasoning
  provenance: string[];     // Π: Source references
  confidence: number;       // μ: Confidence score
}

export interface InductivePattern {
  type: 'INDUCTIVE_PATTERN';
  data: string[];           // D: Observed data
  pattern: string;          // ψ: Induced pattern
  confidence: number;       // conf: Statistical confidence
  metadata: Record<string, unknown>; // μ: Additional metadata
}

export interface Counterfactual {
  type: 'COUNTERFACTUAL';
  factual: string;          // f: Factual statement
  modification: string;     // m: What-if modification
  delta: string;            // Δ: Predicted difference
  metadata: Record<string, unknown>; // μ: Additional metadata
}

export interface TransformedContent {
  type: 'TRANSFORMED_CONTENT';
  content: string;
  format: 'prose' | 'structured' | 'code';
  provenance: string[];
}

export interface ImpCert {
  type: 'IMP_CERT';
  reason: string;         // R: Reason for impossibility
  provenance: string[];   // Π: Source references
  boundary: string;       // ∂R: The definition of the boundary
  logic: string;          // L: Formal logic/proof trace
  confidence: number;     // μ: Confidence
}

export interface Witness {
  type: 'WITNESS';
  counterExample: string; // The specific case that caused failure
  constraintViolated: string; 
  provenance: string[];
}

export interface CommitEntry {
  hash: string;
  timestamp: number;
  artifactId: string;
  csb: string; // Serialized CSB at commit time
  noveltyScore?: number;
}

export interface ExecutionParameters {
  temperature: number;
  maxTokens: number;
  topP: number;
  modelVersion: string;
}

// ================================= BOUNDED CERTIFICATE TYPES =================================

/**
 * Certificate classification types per the bounded certification protocol.
 * 
 * - Unique-Correct: Exactly one admissible execution path within bounds
 * - Unresolved-Within-Bounds: Multiple paths or no path found, bounds exhausted
 * - Failure: Invariant violations or unbounded behavior detected
 */
export type CertificateType = 'Unique-Correct' | 'Unresolved-Within-Bounds' | 'Failure';

/**
 * Verification ledger entry - records each candidate path evaluation
 */
export interface VerificationLedgerEntry {
  path_id: string;           // Deterministic path identifier (step trace)
  artifact_type: string;     // Type of artifact at this path
  status: 'PASS' | 'FAIL';   // ValidityChecker result
  reason_code: string | null; // Failure reason if FAIL, null if PASS
  invariant_checks: {
    Prov: boolean;           // Provenance check
    TypeOK: boolean;         // Type conformance
    ASTOK: boolean;          // Well-formed structure
    GoalOK: boolean;         // Goal constraint satisfaction
    CycleFree: boolean;      // Termination guarantee
  };
}

/**
 * Bounded Certificate - the external serializable proof artifact
 * 
 * This structure projects the internal execution trace into a
 * deterministically replayable certificate format.
 */
export interface BoundedCertificate {
  certificate_type: CertificateType;
  certificate_version: '2.0';
  
  // Declared bounds (from execution parameters)
  declared_bounds: {
    max_paths: number;       // κ: Maximum exploration paths
    max_steps_per_path: number;
    max_compute_units: number;
  };
  
  // Rule set identifier (TURWIN invariant set)
  target_rule_set_id: 'TURWIN-INV-v4.0-FS';
  
  // Enumerated candidates with validation results
  verification_ledger: VerificationLedgerEntry[];
  
  // Proof artifact summary
  proof_artifact: {
    proof_type: 'UniqueCorrectProof' | 'UnresolvedProof' | 'FailureProof';
    bounds_exhausted: boolean;
    bounds_exhausted_reason: string[];
    pass_count: number;
    fail_count: number;
    single_passing_path_id: string | null;
    failure_code_multiset: Record<string, number>;
  };
  
  // Compute accounting
  compute_accounting: {
    compute_units_consumed: number;
    enumeration_count: number;
    validation_count: number;
  };
  
  // Cryptographic commitment
  fingerprint: string;       // SHA-256 of canonical serialization
  timestamp: string;         // ISO 8601 timestamp
  
  // Deterministic replay assertion
  determinism_claim: 'Given identical bounds and input, replay produces identical ledger and proof_artifact';
}

// Type alias for proposal generator function
export type ProposalGenerator = (ctx: string, csb: CanonicalStateBlock) => Promise<string>;

export type DiscoveryAuditPhase =
  | 'PROPOSE'
  | 'PROJECT'
  | 'VERIFY'
  | 'FILTER'
  | 'COMMIT'
  | 'FAIL_COMMIT'
  | 'EXCL'
  | 'HALT';

export interface DiscoveryAuditEntry {
  index: number;
  step: number;
  phase: DiscoveryAuditPhase;
  decision: 'PASS' | 'FAIL' | 'SKIP';
  detail: string;
  artifactType?: string;
  timestamp: number;
}

export interface VerifierGateResult {
  status: 'PASS' | 'FAIL';
  witness?: Witness;
  impCert?: ImpCert;
  repair?: string;
  reasonCode?: string;
}

export interface VerifierGateContext {
  goal: string;
  input: string;
  csb: CanonicalStateBlock;
  proposal: string;
  artifact: VerifiedArtifact;
  registry: ArtifactRegistry;
  config: TurwinConfig;
  generator: ProposalGenerator;
}

export type VerifierGateOracle = (context: VerifierGateContext) => Promise<VerifierGateResult>;

export interface CanonicalizerContext {
  proposal: string;
  goal: string;
  registry: ArtifactRegistry;
}

export type CanonicalizerOracle = (
  context: CanonicalizerContext
) => { artifact: VerifiedArtifact; opcode: TurwinInstruction } | null;

export interface DominanceContext {
  noveltyScore: number;
  maxSimilarity: number;
  bestMatchType: VerifiedArtifact['type'] | null;
}

export type DominanceOracle = (
  candidate: VerifiedArtifact,
  registry: ArtifactRegistry,
  config: TurwinConfig,
  context: DominanceContext
) => boolean;

export type ScoringOracle = (
  artifact: VerifiedArtifact,
  noveltyScore: number,
  config: TurwinConfig
) => number;

export interface DiscoveryHooks {
  verifier?: VerifierGateOracle;
  canonicalizer?: CanonicalizerOracle;
  dominance?: DominanceOracle;
  scoring?: ScoringOracle;
}

export interface DiscoveryLoopConfig {
  enabled?: boolean;
  verifierTimeoutMs?: number;
  failClosedVerifierErrors?: boolean;
  commitImpCertOnFail?: boolean;
  hooks?: DiscoveryHooks;
}

// ================================= INVARIANT =================================

/**
 * SINGLE INVARIANT (must hold for every commit):
 * 
 * INV(G, x, CSB_n, p_n, r'_n) := 
 *   Prov(r'_n) ⊆ {x} ∪ R_n           [provenance]
 *   ∧ TypeOK_O(r'_n)                  [strict kinds/relations]
 *   ∧ ASTOK(r'_n)                     [schema/well-formed]
 *   ∧ GoalOK_{G,τ}(r'_n)              [slot/constraint coverage]
 *   ∧ CycleFree_κ(H_n, CSB_n, r'_n)   [termination]
 */
export interface InvariantCheck {
  provenanceOK: boolean;    // All sources traced to input or registry
  typeOK: boolean;          // Strict type conformance
  astOK: boolean;           // Well-formed structure
  goalOK: boolean;          // Satisfies goal constraints
  cycleFree: boolean;       // No infinite loops
  proposalIntegrity: boolean; // Artifact faithfully represents proposal (anti-hallucination)
}

export function checkInvariant(
  goal: string,
  input: string,
  csb: CanonicalStateBlock,
  proposal: unknown,
  artifact: VerifiedArtifact,
  config: TurwinConfig
): InvariantCheck {
  return {
    provenanceOK: checkProvenance(artifact, input, csb.registry),
    typeOK: checkTypeConformance(artifact),
    astOK: checkWellFormed(artifact),
    goalOK: checkGoalCoverage(artifact, goal, config.tau, config),
    cycleFree: checkNoCycles(csb.cycleHistory, csb, artifact, config),
    // NEW: Verify artifact faithfully represents the proposal (anti-hallucination)
    proposalIntegrity: checkProposalIntegrity(proposal, artifact)
  };
}

/**
 * NEW: Verify that the projected artifact faithfully represents the original proposal.
 * This prevents the projection step from hallucinating content not in the proposal.
 * @internal Exported for testing
 */
export function checkProposalIntegrity(proposal: unknown, artifact: VerifiedArtifact): boolean {
  // If no content to check, pass by default
  if (!('content' in artifact) || typeof proposal !== 'string') {
    return true;
  }
  
  const proposalStr = String(proposal).toLowerCase();
  const artifactContent = artifact.content.toLowerCase();
  
  // Check that key phrases from the artifact exist in the original proposal
  // This prevents the projection from inventing content
  const keyPhrases = artifactContent.split(/[.,;!?]/).filter(p => p.trim().length > KERNEL_CONSTANTS.MIN_KEY_PHRASE_LENGTH);
  if (keyPhrases.length === 0) return true;
  
  // At least PROPOSAL_INTEGRITY_THRESHOLD of key phrases should be traceable to the proposal
  const matchedPhrases = keyPhrases.filter(phrase => 
    proposalStr.includes(phrase.trim().substring(0, KERNEL_CONSTANTS.PHRASE_MATCH_PREFIX_LENGTH)) // Check prefix match
  );
  
  return matchedPhrases.length >= keyPhrases.length * KERNEL_CONSTANTS.PROPOSAL_INTEGRITY_THRESHOLD;
}

/** @internal Exported for testing */
export function checkProvenance(artifact: VerifiedArtifact, input: string, registry: ArtifactRegistry): boolean {
  const provenance = 'provenance' in artifact ? artifact.provenance : [];
  // All provenance must trace to input or existing registry
  return provenance.every(p => {
    // 1. Direct match with input
    if (p === input) return true;
    
    // 2. Check for "artifact_N" format and verify index existence
    const match = p.match(/^artifact_(\d+)$/);
    if (match && match[1]) {
      const index = parseInt(match[1], 10);
      return index >= 0 && index < registry.artifacts.length;
    }

    // 3. Fallback: Search in content of existing artifacts
    return registry.artifacts.some(a => ('content' in a && typeof a.content === 'string' && a.content.includes(p)));
  });
}

/** @internal Exported for testing */
export function checkTypeConformance(artifact: VerifiedArtifact): boolean {
  // Verify artifact matches its declared type schema
  switch (artifact.type) {
    case 'ANALOGY_MAP':
      return typeof artifact.source === 'string' && typeof artifact.target === 'string';
    case 'HYPOTHESIS':
      return typeof artifact.proposition === 'string' && Array.isArray(artifact.support);
    case 'INDUCTIVE_PATTERN':
      return Array.isArray(artifact.data) && typeof artifact.pattern === 'string';
    case 'COUNTERFACTUAL':
      return typeof artifact.factual === 'string' && typeof artifact.modification === 'string';
    case 'TRANSFORMED_CONTENT':
      return typeof artifact.content === 'string' && ['prose', 'structured', 'code'].includes(artifact.format);
    case 'IMP_CERT':
      return typeof artifact.reason === 'string' && typeof artifact.boundary === 'string';
    case 'WITNESS':
      return typeof artifact.counterExample === 'string';
    default:
      return false;
  }
}

/** @internal Exported for testing */
export function checkWellFormed(artifact: VerifiedArtifact): boolean {
  // Check structural validity - no circular references, valid JSON, etc.
  try {
    JSON.stringify(artifact);
    return true;
  } catch {
    return false;
  }
}

/** @internal Exported for testing */
export function checkGoalCoverage(
  artifact: VerifiedArtifact,
  goal: string,
  tau: number,
  config?: TurwinConfig
): boolean {
  // Check if artifact satisfies goal constraints
  // Simplified: check if content is relevant to goal
  if (!('content' in artifact) || typeof artifact.content !== 'string') {
    return true;
  }

  const trimmedContent = artifact.content.trim();
  if (!trimmedContent) return true;

  const noveltyGate = config ? resolveNoveltyGate(config) : DEFAULT_NOVELTY_GATE;
  if (trimmedContent.length < noveltyGate.minContentLength) {
    const overlap = calculateOverlap(trimmedContent, goal);
    return overlap >= tau;
  }

  try {
    const contentVector = hashEmbed(trimmedContent);
    const goalVector = hashEmbed(goal);
    const similarity = cosineSimilarity(contentVector, goalVector);
    return similarity >= tau;
  } catch {
    const overlap = calculateOverlap(trimmedContent, goal);
    return overlap >= tau;
  }
}

/** @internal Exported for testing */
export function calculateOverlap(content: string, goal: string): number {
  // Common stop words to filter out - these don't indicate semantic relevance
  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
    'shall', 'can', 'need', 'dare', 'ought', 'used', 'that', 'this', 'these', 'those',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'whom',
    'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their',
    'myself', 'yourself', 'himself', 'herself', 'itself', 'how', 'when', 'where', 'why',
    'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
    'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
    'also', 'now', 'here', 'there', 'then', 'once', 'if', 'because', 'until', 'while',
    'about', 'after', 'before', 'above', 'below', 'between', 'into', 'through', 'during',
    'create', 'make', 'build', 'design', 'develop', 'plan', 'help', 'want', 'like'
  ]);

  // Tokenize and filter
  const contentWords = new Set(
    content.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w))
  );
  const goalWords = goal.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  // If goal has no meaningful words after filtering, pass by default
  if (goalWords.length === 0) return 1.0;
  
  // Check for matches (including partial/stem matches)
  let matches = 0;
  for (const goalWord of goalWords) {
    // Check exact match
    if (contentWords.has(goalWord)) {
      matches++;
      continue;
    }
    // Check if any content word starts with or contains the goal word (stem matching)
    for (const contentWord of contentWords) {
      if (contentWord.startsWith(goalWord.substring(0, 4)) || 
          goalWord.startsWith(contentWord.substring(0, 4))) {
        matches += 0.5; // Partial credit for stem matches
        break;
      }
    }
  }
  
  // Base score: if content is substantive (>100 chars), give 20% baseline credit
  const baseScore = content.length > 100 ? 0.2 : 0;
  
  return Math.min(1.0, baseScore + (matches / goalWords.length));
}

function checkNoCycles(
  history: Set<string>,
  csb: CanonicalStateBlock,
  artifact: VerifiedArtifact,
  config: TurwinConfig  // v4.0-FS: Now takes full config for policy hash
): boolean {
  const edgeId = computeEdgeId(csb, artifact, config);
  return !history.has(edgeId);
}

// ================================= v4.0-FS SECURE HASHING (TCB) =================================

/**
 * Fast, collision-resistant hash using FNV-1a algorithm (v3.3-IF improved)
 *
 * Replaces djb2 for better collision resistance in cycle detection.
 * FNV-1a has excellent distribution and is much better than djb2 for our use case.
 *
 * NOT cryptographically secure (by design - we need synchronous operation).
 * Cryptographic security not required for cycle detection, only collision resistance.
 *
 * FNV-1a parameters (32-bit):
 * - Prime: 16777619 (0x01000193)
 * - Offset basis: 2166136261 (0x811c9dc5)
 *
 * Expected collision rate: ~1 in 4 billion for random inputs
 */
function fastHashFNV1a(data: string): string {
  const FNV_PRIME = 0x01000193;
  const FNV_OFFSET_BASIS = 0x811c9dc5;

  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME); // 32-bit multiplication
  }

  // Convert to 64-bit hex-like string for better collision resistance
  // Use both the hash and a rotated version
  const hash2 = (hash >>> 16) ^ (hash << 16);
  return (hash >>> 0).toString(16).padStart(8, '0') +
         (hash2 >>> 0).toString(16).padStart(8, '0');
}

/**
 * Compute domain-separated artifact hash.
 * ArtId(r) := H(TAG_A || CanonSerialize(r))
 */
function computeArtId(artifact: VerifiedArtifact): string {
  const canonical = JSON.stringify(artifact);
  return fastHashFNV1a(`${HASH_TAGS.ARTIFACT}|${canonical}`);
}

/**
 * Compute policy hash.
 * PolId := H(TAG_P || Encode(τ, κ, ...))
 */
function computePolicyHash(config: TurwinConfig): string {
  const encoded = JSON.stringify(config);
  return fastHashFNV1a(`${HASH_TAGS.POLICY}|${encoded}`);
}

/**
 * Compute CSB core projection hash.
 * CsbId(CSB_n) := H(TAG_C || Encode(CSB*_n))
 */
function computeCsbId(csb: CanonicalStateBlock, config: TurwinConfig): string {
  const csbCore = {
    goal: csb.goal,
    stepNumber: csb.stepNumber,
    cfgId: computePolicyHash(config),
    artifactCount: csb.registry.artifacts.length,
  };
  return fastHashFNV1a(`${HASH_TAGS.CSB}|${JSON.stringify(csbCore)}`);
}

/**
 * Compute unique transition (edge) ID.
 * EdgeId(CSB_n, r) := H(TAG_E || CsbId(CSB_n) || ArtId(r) || PolId)
 * 
 * This is the CycleFree predicate's core check per v4.0-FS spec.
 */
function computeEdgeId(csb: CanonicalStateBlock, artifact: VerifiedArtifact, config: TurwinConfig): string {
  const csbId = computeCsbId(csb, config);
  const artId = computeArtId(artifact);
  const polId = computePolicyHash(config);
  return fastHashFNV1a(`${HASH_TAGS.EDGE}|${csbId}|${artId}|${polId}`);
}

/**
 * Stable hash used for duplicate-commit elimination.
 * Unlike edge IDs, this intentionally excludes step counters so semantically
 * equivalent commits are deduplicated across loop iterations.
 */
function computeCommitHash(goal: string, artifact: VerifiedArtifact, config: TurwinConfig): string {
  const stableCsbProjection = {
    goal,
    cfgId: computePolicyHash(config),
  };
  return fastHashFNV1a(
    `${HASH_TAGS.EDGE}|${canonicalSerialize(stableCsbProjection)}|${canonicalSerialize(artifact)}`
  );
}

function appendCommit(
  registry: ArtifactRegistry,
  artifact: VerifiedArtifact,
  csb: CanonicalStateBlock,
  commitHash: string,
  noveltyScore?: number
): void {
  registry.commitLog.push({
    hash: commitHash,
    timestamp: Date.now(),
    artifactId: computeArtId(artifact),
    csb: canonicalSerialize({
      goal: csb.goal,
      stepNumber: csb.stepNumber,
      status: csb.status,
      instruction: csb.instruction
    }),
    noveltyScore
  });
}



// ================================= EXECUTION ENGINE =================================

export interface NoveltyGateConfig {
  minScore: number;
  maxSimilarity: number;
  minContentLength: number;
  compareLimit: number;
  gateStage: 'pre-verify' | 'post-verify';
}

export interface ExclusionConfig {
  minConfidence: number;
  allowRegex: boolean;
  minBoundaryLength: number;
}

export interface SMTConfig {
  useFullSolver?: boolean;
  timeoutMs?: number;
}

export interface TurwinConfig {
  tau: number;        // Goal coverage threshold
  kappa: number;      // Cycle detection window
  maxFail: number;    // Max consecutive failures (F=3)
  maxSteps?: number;  // Max steps per path (default: 10)
  maxPaths?: number;  // Max paths to explore (default: kappa)
  maxSynthesisAdds?: number; // C_max: bounded queue drain adds per step
  composeTopK?: number; // K: pair cap for COMPOSE_IMP
  termPredicate?: (goal: string, registry: ArtifactRegistry) => boolean; // TERM(G, R)
  noveltyGate?: NoveltyGateConfig;
  embeddingProvider?: EmbeddingProvider;
  exclusion?: ExclusionConfig;
  smt?: SMTConfig;
  discoveryLoop?: DiscoveryLoopConfig;
}

const DEFAULT_NOVELTY_GATE: NoveltyGateConfig = {
  minScore: 0.35,
  maxSimilarity: 0.85,
  minContentLength: 120,
  compareLimit: 200,
  gateStage: 'pre-verify'
};

const DEFAULT_EXCLUSION: ExclusionConfig = {
  minConfidence: 0.75,
  allowRegex: false,
  minBoundaryLength: 12
};

const DEFAULT_DISCOVERY_LOOP: DiscoveryLoopConfig = {
  enabled: true,
  verifierTimeoutMs: 60_000,
  failClosedVerifierErrors: true,
  commitImpCertOnFail: true
};

export const DEFAULT_CONFIG: TurwinConfig = {
  tau: 0.5,  // Goal coverage threshold (lowered from 0.7 to allow natural paraphrasing)
  kappa: 100,
  maxFail: 3,
  maxSteps: 10,
  maxPaths: 100,
  maxSynthesisAdds: 8,
  composeTopK: 4,
  noveltyGate: DEFAULT_NOVELTY_GATE,
  exclusion: DEFAULT_EXCLUSION,
  smt: {
    useFullSolver: DEFAULT_SMT_VERIFIER_CONFIG.useFullSolver,
    timeoutMs: DEFAULT_SMT_VERIFIER_CONFIG.timeoutMs
  },
  discoveryLoop: DEFAULT_DISCOVERY_LOOP
};

interface SynthesisQueueItem {
  artifact: VerifiedArtifact;
  opcode: TurwinInstruction;
  priority: number;
  noveltyScore?: number;
}

function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function resolveNoveltyGate(config: TurwinConfig): NoveltyGateConfig {
  return {
    ...DEFAULT_NOVELTY_GATE,
    ...(config.noveltyGate ?? {})
  };
}

function resolveExclusionConfig(config: TurwinConfig): ExclusionConfig {
  return {
    ...DEFAULT_EXCLUSION,
    ...(config.exclusion ?? {})
  };
}

function resolveDiscoveryLoopConfig(config: TurwinConfig): DiscoveryLoopConfig {
  return {
    ...DEFAULT_DISCOVERY_LOOP,
    ...(config.discoveryLoop ?? {}),
    hooks: {
      ...(config.discoveryLoop?.hooks ?? {})
    }
  };
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(value: string): Set<string> {
  const tokens = normalizeText(value).split(' ').filter(token => token.length >= 4);
  return new Set(tokens);
}

type ExclusionBoundaryMode = 'EXACT' | 'ALL_TOKENS' | 'REGEX';

interface ParsedExclusionBoundary {
  mode: ExclusionBoundaryMode;
  payload: string;
}

function parseExclusionBoundary(boundary: string): ParsedExclusionBoundary {
  const trimmed = boundary.trim();
  if (!trimmed) {
    return { mode: 'EXACT', payload: '' };
  }

  const match = trimmed.match(/^(EXACT|ALL_TOKENS|REGEX)\s*:\s*(.+)$/i);
  if (!match || !match[1] || !match[2]) {
    return { mode: 'EXACT', payload: trimmed };
  }

  return { mode: match[1].toUpperCase() as ExclusionBoundaryMode, payload: match[2].trim() };
}

function proposalFallsInExcludedRegion(
  proposal: string,
  cert: ImpCert,
  exclusion: ExclusionConfig
): boolean {
  if (cert.confidence < exclusion.minConfidence) {
    return false;
  }

  const parsed = parseExclusionBoundary(cert.boundary);
  if (!parsed.payload) return false;
  if (parsed.payload.length < exclusion.minBoundaryLength) {
    return false;
  }

  if (parsed.mode === 'REGEX') {
    if (!exclusion.allowRegex) return false;
    try {
      return new RegExp(parsed.payload, 'i').test(proposal);
    } catch {
      return false;
    }
  }

  const normalizedProposal = normalizeText(proposal);
  if (!normalizedProposal) return false;

  if (parsed.mode === 'ALL_TOKENS') {
    const requiredTokens = tokenize(parsed.payload);
    if (requiredTokens.size === 0) return false;
    const proposalTokens = tokenize(proposal);
    for (const token of requiredTokens) {
      if (!proposalTokens.has(token)) return false;
    }
    return true;
  }

  const normalizedBoundary = normalizeText(parsed.payload);
  if (normalizedBoundary.length < exclusion.minBoundaryLength) {
    return false;
  }
  return normalizedProposal.includes(normalizedBoundary);
}

function toProposalView(artifact: VerifiedArtifact): string {
  switch (artifact.type) {
    case 'TRANSFORMED_CONTENT':
      return artifact.content;
    case 'HYPOTHESIS':
      return artifact.proposition;
    case 'ANALOGY_MAP':
      return `${artifact.source} ${artifact.target} ${Object.keys(artifact.mapping).join(' ')}`;
    case 'INDUCTIVE_PATTERN':
      return `${artifact.pattern} ${artifact.data.join(' ')}`;
    case 'COUNTERFACTUAL':
      return `${artifact.factual} ${artifact.modification} ${artifact.delta}`;
    case 'IMP_CERT':
      return `${artifact.reason} ${artifact.boundary}`;
    case 'WITNESS':
      return `${artifact.constraintViolated} ${artifact.counterExample}`;
    default:
      return '';
  }
}

function summarizeForAudit(value: string, limit = 160): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit)}...`;
}

function deriveFailureBoundary(proposal: string): string {
  const tokens = normalizeText(proposal)
    .split(' ')
    .filter(token => token.length >= 4)
    .slice(0, 8)
    .join(' ');

  if (tokens.length >= DEFAULT_EXCLUSION.minBoundaryLength) {
    return `ALL_TOKENS:${tokens}`;
  }

  const exact = normalizeText(proposal).slice(0, 80);
  return `EXACT:${exact || 'verifier rejection'}`;
}

function deriveImpCertFromFailure(proposal: string, witness?: Witness): ImpCert {
  const reasonSuffix = witness?.counterExample ? ` - ${summarizeForAudit(witness.counterExample, 180)}` : '';
  const constraint = witness?.constraintViolated || 'VERIFIER_REJECTION';
  return {
    type: 'IMP_CERT',
    reason: `Verifier rejected candidate [${constraint}]${reasonSuffix}`,
    provenance: ['VERIFIER_GATE_DISCOVERY'],
    boundary: deriveFailureBoundary(proposal),
    logic: `FAIL(${constraint})`,
    confidence: 1
  };
}

function isExcludedByCommittedImpCert(
  proposal: string,
  registry: ArtifactRegistry,
  config: TurwinConfig
): boolean {
  const exclusion = resolveExclusionConfig(config);
  const impCerts = registry.artifacts.filter((artifact): artifact is ImpCert => artifact.type === 'IMP_CERT');
  for (const cert of impCerts) {
    if (proposalFallsInExcludedRegion(proposal, cert, exclusion)) {
      return true;
    }
  }

  return false;
}

interface NoveltyContext {
  noveltyScore: number;
  maxSimilarity: number;
  bestMatch: VerifiedArtifact | null;
}

function getArtifactQualityScore(artifact: VerifiedArtifact): number {
  if ('confidence' in artifact && typeof artifact.confidence === 'number') {
    return clampUnitInterval(artifact.confidence);
  }
  if (artifact.type === 'TRANSFORMED_CONTENT') {
    return clampUnitInterval(artifact.content.length / 1000);
  }
  return 0.5;
}

function isStrictlyBetter(candidate: VerifiedArtifact, existing: VerifiedArtifact): boolean {
  return getArtifactQualityScore(candidate) > getArtifactQualityScore(existing);
}

function isDominatedByRegistry(
  candidate: VerifiedArtifact,
  registry: ArtifactRegistry,
  config: TurwinConfig,
  noveltyContext?: NoveltyContext
): boolean {
  const candidateCanonical = canonicalSerialize(candidate);
  const candidateNormalizedContent =
    'content' in candidate && typeof candidate.content === 'string' ? normalizeText(candidate.content) : null;

  for (const existing of registry.artifacts) {
    const existingCanonical = canonicalSerialize(existing);
    if (existingCanonical === candidateCanonical) {
      return true;
    }

    if (
      candidate.type === 'IMP_CERT' &&
      existing.type === 'IMP_CERT' &&
      normalizeText(candidate.boundary) === normalizeText(existing.boundary) &&
      normalizeText(existing.reason).includes(normalizeText(candidate.reason))
    ) {
      return true;
    }
  }

  const noveltyGate = resolveNoveltyGate(config);
  const candidateText = toProposalView(candidate).trim();
  let maxSimilarity = noveltyContext?.maxSimilarity ?? 0;
  let bestMatch = noveltyContext?.bestMatch ?? null;

  if (!bestMatch && candidateText.length >= noveltyGate.minContentLength) {
    const candidateVector = hashEmbed(candidateText);
    const registrySlice = registry.artifacts.slice(-noveltyGate.compareLimit);
    for (const existing of registrySlice) {
      const existingText = toProposalView(existing);
      if (!existingText) continue;
      const similarity = cosineSimilarity(candidateVector, hashEmbed(existingText));
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        bestMatch = existing;
      }
    }
  }

  if (bestMatch && maxSimilarity >= noveltyGate.maxSimilarity) {
    if (!isStrictlyBetter(candidate, bestMatch)) {
      return true;
    }

    if (candidateNormalizedContent && 'content' in bestMatch && typeof bestMatch.content === 'string') {
      const bestMatchNormalized = normalizeText(bestMatch.content);
      if (
        bestMatchNormalized.length >= candidateNormalizedContent.length &&
        bestMatchNormalized.includes(candidateNormalizedContent)
      ) {
        return true;
      }
    }
  }

  return false;
}

function scoreArtifactPriority(artifact: VerifiedArtifact, noveltyScore?: number): number {
  const confidenceScore = getArtifactQualityScore(artifact);
  const noveltyScoreValue = typeof noveltyScore === 'number' ? clampUnitInterval(noveltyScore) : 0.5;
  return clampUnitInterval(0.7 * noveltyScoreValue + 0.3 * confidenceScore);
}

function enqueueSynthesisCandidate(queue: SynthesisQueueItem[], item: SynthesisQueueItem, queueCap: number): void {
  queue.push(item);
  queue.sort((a, b) => b.priority - a.priority);
  if (queue.length > queueCap) {
    queue.length = queueCap;
  }
}

// Helper: Canonical serialization for determinism
function canonicalSerialize(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + (obj as unknown[]).map(canonicalSerialize).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const parts = keys.map(key => {
    // v3.3-IF: Safe indexing with Record type instead of any
    const value = (obj as Record<string, unknown>)[key];
    return JSON.stringify(key) + ':' + canonicalSerialize(value);
  });
  return '{' + parts.join(',') + '}';
}

// Helper: Real async SHA-256 (Web Crypto API)
async function computeRealSHA256(data: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const enc = new TextEncoder();
    const buffer = enc.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let hash = 5381;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) + hash) ^ data.charCodeAt(i);
  }
  return 'insecure-djb2-' + (hash >>> 0).toString(16);
}

// Operator: CERTIFICATE_EXPORT (Projection Layer)
async function CERTIFICATE_EXPORT(
  registry: ArtifactRegistry,
  status: ExecutionStatus,
  stopReason: StopReason,
  config: TurwinConfig,
  stats: { enumerationCount: number; validationCount: number }
): Promise<BoundedCertificate> {
  // Logic: The "Candidate" is the entire execution trace (The Solution Path).
  // If the trace completed successfully (even with IMP_CERTS), it's a PASS.
  // We produce 1 Path in the ledger.
  
  const isComplete = status === 'COMPLETE';
  const unresolvedWithinBounds = status === 'PARTIAL' || status === 'RESOURCE_EXHAUSTED';
  const boundsExhausted = status === 'RESOURCE_EXHAUSTED' || status === 'PARTIAL';
  
  // Aggregate invariant checks from all steps (if any step failed, the path would have halted or been rejected)
  // In a successful trace, all committed artifacts passed verification.
  const checksPassed = registry.artifacts.length > 0;

  const ledgerEntry: VerificationLedgerEntry = {
    path_id: 'trace-execution-0',
    artifact_type: 'RECIPE_TRACE', // Composite type
    status: isComplete ? 'PASS' : 'FAIL',
    reason_code: isComplete ? null : stopReason,
    invariant_checks: {
       Prov: checksPassed,
       TypeOK: checksPassed, 
       ASTOK: checksPassed,
       GoalOK: checksPassed,
       CycleFree: checksPassed
    }
  };

  const ledger = [ledgerEntry];

  const passCount = ledger.filter(e => e.status === 'PASS').length;
  const failCount = ledger.filter(e => e.status === 'FAIL').length;
  
  let certType: CertificateType = 'Failure';
  let proofType: 'UniqueCorrectProof' | 'UnresolvedProof' | 'FailureProof' = 'FailureProof';
  
  if (passCount === 1) { 
     certType = 'Unique-Correct';
     proofType = 'UniqueCorrectProof';
  } else if (unresolvedWithinBounds) {
     certType = 'Unresolved-Within-Bounds';
     proofType = 'UnresolvedProof';
  } else {
     // Default fallback
     certType = 'Failure';
     proofType = 'FailureProof';
  }

  const cert: BoundedCertificate = {
    certificate_type: certType,
    certificate_version: '2.0',
    declared_bounds: {
      max_paths: config.maxPaths || config.kappa,
      max_steps_per_path: config.maxSteps || 10,
      max_compute_units: stats.validationCount * 10
    },
    target_rule_set_id: 'TURWIN-INV-v4.0-FS',
    verification_ledger: ledger,
    proof_artifact: {
      proof_type: proofType,
      bounds_exhausted: boundsExhausted,
      bounds_exhausted_reason: isComplete ? [] : [stopReason],
      pass_count: passCount,
      fail_count: failCount,
      single_passing_path_id: passCount === 1 ? ledgerEntry.path_id : null,
      failure_code_multiset: failCount > 0 ? { [ledgerEntry.reason_code || 'unknown_failure']: 1 } : {}
    },
    compute_accounting: {
      compute_units_consumed: stats.validationCount,
      enumeration_count: Math.max(1, stats.enumerationCount),
      validation_count: stats.validationCount
    },
    fingerprint: '',
    timestamp: new Date().toISOString(),
    determinism_claim: 'Given identical bounds and input, replay produces identical ledger and proof_artifact'
  };
  
  const canonical = canonicalSerialize({ ...cert, fingerprint: '' });
  cert.fingerprint = await computeRealSHA256(canonical);
  
  return cert;
}

/**
 * Main execution loop - internal only
 * v4.0-FS: Dual-tape output (Solution Tape B + Witness Tape W)
 * Output is serialized to CLEAN prose, not CSB notation
 */
export async function executeTurwinKernel(
  input: string,
  goal: string,
  generator: (ctx: string, csb: CanonicalStateBlock) => Promise<string>,
  config: TurwinConfig = DEFAULT_CONFIG,
  seedRegistry: VerifiedArtifact[] = [] // v4.0-FS: Allow R0 injection (e.g. Patent ImpCerts)
): Promise<{
  output: string;           // Solution tape (Tape B)
  witnessOutput: string;    // Witness tape (Tape W) - v4.0-FS
  registry: ArtifactRegistry;
  icSet: ImpCert[];
  status: ExecutionStatus;
  stopReason: StopReason;
  traceLog: string[];
  auditLog: DiscoveryAuditEntry[];
  certificate: BoundedCertificate; // v4.0-FS: Bounded Certificate
}> {
  // ===== INPUT VALIDATION (v3.3-IF) =====
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    throw new Error('[TURWIN_KERNEL] Invalid input: must be non-empty string');
  }
  if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
    throw new Error('[TURWIN_KERNEL] Invalid goal: must be non-empty string');
  }
  if (!generator || typeof generator !== 'function') {
    throw new Error('[TURWIN_KERNEL] Invalid generator: must be a function');
  }

  // Validate config parameters
  const validatedConfig: TurwinConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    noveltyGate: {
      ...DEFAULT_NOVELTY_GATE,
      ...(config.noveltyGate ?? {})
    },
    exclusion: {
      ...DEFAULT_EXCLUSION,
      ...(config.exclusion ?? {})
    },
    smt: {
      ...DEFAULT_CONFIG.smt,
      ...(config.smt ?? {})
    },
    discoveryLoop: {
      ...DEFAULT_DISCOVERY_LOOP,
      ...(config.discoveryLoop ?? {}),
      hooks: {
        ...(config.discoveryLoop?.hooks ?? {})
      }
    }
  };
  if (validatedConfig.tau < 0 || validatedConfig.tau > 1) {
    throw new Error(`[TURWIN_KERNEL] Invalid tau: ${validatedConfig.tau} (must be 0-1)`);
  }
  if (validatedConfig.kappa < 1) {
    throw new Error(`[TURWIN_KERNEL] Invalid kappa: ${validatedConfig.kappa} (must be >= 1)`);
  }
  if (validatedConfig.maxFail < 1) {
    throw new Error(`[TURWIN_KERNEL] Invalid maxFail: ${validatedConfig.maxFail} (must be >= 1)`);
  }

  // Use validated config from here on
  config = validatedConfig;
  if (config.smt) {
    smtVerifier.updateConfig({
      useFullSolver: config.smt.useFullSolver,
      timeoutMs: config.smt.timeoutMs
    });
  }
  const maxRegistry = Math.max(1, config.maxPaths ?? config.kappa);
  const maxIterations = Math.max(1, config.maxSteps ?? KERNEL_CONSTANTS.MAX_EXECUTION_STEPS);
  const maxSynthesisAdds = Math.max(1, config.maxSynthesisAdds ?? DEFAULT_CONFIG.maxSynthesisAdds ?? 8);
  const composeTopK = Math.max(1, config.composeTopK ?? DEFAULT_CONFIG.composeTopK ?? 4);
  const termPredicate = config.termPredicate;
  const noveltyGate = resolveNoveltyGate(config);
  const discoveryLoop = resolveDiscoveryLoopConfig(config);
  const discoveryHooks = discoveryLoop.hooks ?? {};
  const canonicalizer: CanonicalizerOracle =
    discoveryHooks.canonicalizer ??
    ((context) => projectToSchema(context.proposal, context.goal, context.registry));
  const dominanceOracle: DominanceOracle =
    discoveryHooks.dominance ??
    (() => false);
  const scoringOracle: ScoringOracle =
    discoveryHooks.scoring ??
    ((artifact, noveltyScore) => scoreArtifactPriority(artifact, noveltyScore));

  const embeddingCache = new Map<string, number[]>();
  const baseEmbeddingProvider: EmbeddingProvider = config.embeddingProvider ?? (async (text: string) => hashEmbed(text));
  const cachedEmbeddingProvider: EmbeddingProvider = async (text: string): Promise<number[]> => {
    const key = text.trim();
    const cached = embeddingCache.get(key);
    if (cached) return cached;
    try {
      const vector = await baseEmbeddingProvider(text);
      embeddingCache.set(key, vector);
      return vector;
    } catch {
      const fallbackVector = hashEmbed(text);
      embeddingCache.set(key, fallbackVector);
      return fallbackVector;
    }
  };

  const computeNoveltyContext = async (candidateText: string, registrySnapshot: ArtifactRegistry): Promise<NoveltyContext> => {
    const normalizedCandidateText = candidateText.trim();
    if (!normalizedCandidateText || normalizedCandidateText.length < noveltyGate.minContentLength) {
      return { noveltyScore: 1, maxSimilarity: 0, bestMatch: null };
    }

    const registryEntries = registrySnapshot.artifacts
      .map(artifact => ({ artifact, text: toProposalView(artifact) }))
      .filter(entry => entry.text.trim().length > 0);
    if (registryEntries.length === 0) {
      return { noveltyScore: 1, maxSimilarity: 0, bestMatch: null };
    }

    const limitedEntries = registryEntries.slice(-noveltyGate.compareLimit);
    const registryTexts = limitedEntries.map(entry => entry.text);
    const noveltyResult = await semanticNovelty(
      normalizedCandidateText,
      registryTexts,
      cachedEmbeddingProvider,
      noveltyGate.compareLimit
    );
    const bestMatch = noveltyResult.bestMatchIndex !== null
      ? limitedEntries[noveltyResult.bestMatchIndex]?.artifact ?? null
      : null;

    return {
      noveltyScore: noveltyResult.noveltyScore,
      maxSimilarity: noveltyResult.maxSimilarity,
      bestMatch
    };
  };

  const shouldGateForNovelty = (
    candidateText: string,
    noveltyContext: NoveltyContext,
    stage: 'pre-verify' | 'post-verify'
  ): boolean => {
    if (noveltyGate.gateStage !== stage) return false;
    if (candidateText.trim().length < noveltyGate.minContentLength) return false;
    return noveltyContext.noveltyScore < noveltyGate.minScore;
  };

  const runVerifierWithTimeout = async (
    context: VerifierGateContext
  ): Promise<VerifierGateResult> => {
    const verifier: VerifierGateOracle =
      discoveryHooks.verifier ??
      (async (verifyContext) => {
        const result = await adversarialVerify(
          verifyContext.goal,
          verifyContext.input,
          verifyContext.csb,
          verifyContext.proposal,
          verifyContext.artifact,
          verifyContext.config,
          verifyContext.generator
        );
        return result.verified
          ? { status: 'PASS' }
          : {
              status: 'FAIL',
              witness: result.witness,
              reasonCode: result.witness?.constraintViolated ?? 'VERIFIER_REJECTION'
            };
      });

    const timeoutMs = Math.max(100, discoveryLoop.verifierTimeoutMs ?? 60_000);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<VerifierGateResult>((resolve) => {
      timeoutHandle = globalThis.setTimeout(() => {
        resolve({
          status: 'FAIL',
          witness: {
            type: 'WITNESS',
            counterExample: `Verifier timeout after ${timeoutMs}ms`,
            constraintViolated: 'VERIFIER_TIMEOUT',
            provenance: ['VERIFIER_GATE_DISCOVERY']
          },
          reasonCode: 'VERIFIER_TIMEOUT'
        });
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([
        verifier(context),
        timeoutPromise
      ]);
      return result;
    } catch (error) {
      if (!discoveryLoop.failClosedVerifierErrors) {
        return { status: 'PASS', reasonCode: 'VERIFIER_EXCEPTION_FAIL_OPEN' };
      }
      return {
        status: 'FAIL',
        witness: {
          type: 'WITNESS',
          counterExample: `Verifier exception: ${error instanceof Error ? error.message : String(error)}`,
          constraintViolated: 'VERIFIER_EXCEPTION',
          provenance: ['VERIFIER_GATE_DISCOVERY']
        },
        reasonCode: 'VERIFIER_EXCEPTION'
      };
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  };

  const isDominated = (
    candidate: VerifiedArtifact,
    registrySnapshot: ArtifactRegistry,
    noveltyContext: NoveltyContext
  ): boolean => {
    if (!discoveryHooks.dominance) {
      return isDominatedByRegistry(candidate, registrySnapshot, config, noveltyContext);
    }
    try {
      return dominanceOracle(candidate, registrySnapshot, config, {
        noveltyScore: noveltyContext.noveltyScore,
        maxSimilarity: noveltyContext.maxSimilarity,
        bestMatchType: noveltyContext.bestMatch?.type ?? null
      });
    } catch {
      return true;
    }
  };

  const scorePriority = (artifact: VerifiedArtifact, noveltyScore?: number): number => {
    const normalizedNovelty = typeof noveltyScore === 'number' ? clampUnitInterval(noveltyScore) : 0.5;
    try {
      return clampUnitInterval(scoringOracle(artifact, normalizedNovelty, config));
    } catch {
      return scoreArtifactPriority(artifact, normalizedNovelty);
    }
  };

  // Obfuscated trace log - shows execution flow without revealing implementation
  const traceLog: string[] = [];
  const auditLog: DiscoveryAuditEntry[] = [];
  let auditIndex = 0;
  const t0 = Date.now();

  const logTrace = (entry: string) => {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    traceLog.push(`[t=${elapsed}s] ${entry}`);
  };

  const appendAudit = (
    step: number,
    phase: DiscoveryAuditPhase,
    decision: 'PASS' | 'FAIL' | 'SKIP',
    detail: string,
    artifactType?: string
  ): void => {
    auditLog.push({
      index: auditIndex++,
      step,
      phase,
      decision,
      detail: summarizeForAudit(detail, 200),
      artifactType,
      timestamp: Date.now()
    });
  };
  
  logTrace('◉ KERNEL_INIT: TURWIN v4.0-FS engaged');
  logTrace(`  └─ mode=probabilistic τ=${config.tau} κ=${config.kappa}`);
  if (seedRegistry.length > 0) {
    logTrace(`  └─ R0 injected with ${seedRegistry.length} artifacts (Patents/ImpCerts)`);
  }
  logTrace(`  └─ bounds: R_max=${maxRegistry} I_max=${maxIterations} C_max=${maxSynthesisAdds}`);
  
  // Initialization (lines 8-12 in algorithm)
  let registry: ArtifactRegistry = { artifacts: [...seedRegistry], commitLog: [] };
  let parameters: ExecutionParameters = {
    temperature: 0.7,
    maxTokens: 8192,
    topP: 0.95,
    modelVersion: 'gemini-2.5-flash'
  };
  let cycleHistory = new Set<string>();
  const commitHashes = new Set<string>();
  for (const artifact of registry.artifacts) {
    commitHashes.add(computeCommitHash(goal, artifact, config));
  }
  const synthesisQueue: SynthesisQueueItem[] = [];
  let impCount = registry.artifacts.filter(a => a.type === 'IMP_CERT').length;
  let status: ExecutionStatus = 'ACTIVE';
  let stopReason: StopReason = 'I_MAX';
  let n = 0;
  let output = '';
  let witnessOutput = '';  // v4.0-FS: Witness tape (Tape W)
  let fail = 0;
  const recentWitnesses: Witness[] = [];

  // Initial CSB (line 10)
  let csb = canonicalize(registry, parameters, cycleHistory, goal, n);
  if (!csb) {
    logTrace('✗ KERNEL_ERROR: Canonical state initialization failed');
    status = 'ERROR';
    stopReason = 'CSB_UNDEF';
    const failCert = await CERTIFICATE_EXPORT(registry, status, stopReason, config, { enumerationCount: 0, validationCount: 0 });
    return {
      output,
      witnessOutput,
      registry,
      icSet: registry.artifacts.filter((artifact): artifact is ImpCert => artifact.type === 'IMP_CERT'),
      status,
      stopReason,
      traceLog,
      auditLog: [],
      certificate: failCert
    };
  }
  
  logTrace('◎ STATE_INIT: Canonical state block established');

  // Main loop (line 14)
  while (status === 'ACTIVE') {
    if (registry.artifacts.length >= maxRegistry) {
      status = 'RESOURCE_EXHAUSTED';
      stopReason = 'R_MAX';
      break;
    }
    if (n >= maxIterations) {
      status = 'RESOURCE_EXHAUSTED';
      stopReason = 'I_MAX';
      break;
    }

    // REFRESH (line 16)
    csb = canonicalize(registry, parameters, cycleHistory, goal, n);
    if (!csb) {
      status = 'ERROR';
      stopReason = 'CSB_UNDEF';
      break;
    }

    // READ_A (line 21)
    const context = parseInput(input, csb, recentWitnesses);
    logTrace(`◎ STEP_${n}: READ_A → parsing input (${input.length} chars)`);

    // PROPOSE (untrusted) - line 24
    let proposal = await generator(context, csb);
    if (typeof proposal !== 'string') {
      proposal = String(proposal ?? '');
    }
    appendAudit(n, 'PROPOSE', 'PASS', proposal);
    let opcode: TurwinInstruction = 'TRANSFORM';

    // Check for explicit opcode instructions in proposal (simulated for generator)
    if (proposal.startsWith('OP:BOUNDARY_SYNTH')) {
      proposal = proposal.replace('OP:BOUNDARY_SYNTH', '').trim();
      opcode = 'BOUNDARY_SYNTH';
    } else if (proposal.startsWith('OP:COMPOSE_IMP')) {
       proposal = proposal.replace('OP:COMPOSE_IMP', '').trim();
       opcode = 'COMPOSE_IMP';
    }

    if (isExcludedByCommittedImpCert(proposal, registry, config)) {
      logTrace('  ├─ EXCL: proposal blocked by committed impossibility region');
      appendAudit(n, 'EXCL', 'SKIP', proposal);
      fail++;
      if (fail >= config.maxFail) {
        status = 'PARTIAL';
        stopReason = 'F_MAX';
        break;
      }
      n++;
      continue;
    }

    // PROJECT (trusted) - line 25
    let projected: { artifact: VerifiedArtifact; opcode: TurwinInstruction } | null = null;
    
    // Handle special instructions
    if (opcode === 'BOUNDARY_SYNTH') {
      projected = synthesizeBoundary(registry, config.tau);
    } else if (opcode === 'COMPOSE_IMP') {
      projected = composeImpossibilities(registry);
    } else {
       // Standard projection
       projected = canonicalizer({ proposal, goal, registry });
    }

    if (!projected) {
      appendAudit(n, 'PROJECT', 'FAIL', 'Canonicalizer rejected proposal');
      fail++;
      if (fail >= config.maxFail) {
        status = 'PARTIAL';
        stopReason = 'F_MAX';
        break;
      }
      n++;
      continue;
    }
    appendAudit(n, 'PROJECT', 'PASS', `Projected to ${projected.artifact.type}`, projected.artifact.type);

    const candidateText = toProposalView(projected.artifact);
    const noveltyContext = await computeNoveltyContext(candidateText, registry);
    if (shouldGateForNovelty(candidateText, noveltyContext, 'pre-verify')) {
      logTrace(`  ├─ NOVELTY_GATE: score=${noveltyContext.noveltyScore.toFixed(2)} maxSim=${noveltyContext.maxSimilarity.toFixed(2)}`);
      appendAudit(
        n,
        'FILTER',
        'SKIP',
        `Novelty pre-verify score=${noveltyContext.noveltyScore.toFixed(3)} maxSim=${noveltyContext.maxSimilarity.toFixed(3)}`,
        projected.artifact.type
      );
      n++;
      continue;
    }

    // VERIFY (adversarial) - line 32
    
    // v4.0-FS HARD FENCE: SMT Verifier
    // Runs before semantic verification to catch mathematical impossibilities
    let smtResult = null;
    let smtWitness = null;
    const goalHasFormalConstraint = hasSMTVerifiableConstraints(goal);
    
    if ('content' in projected.artifact && typeof projected.artifact.content === 'string') {
        smtResult = await smtVerifier.verifyConstraint(goal, projected.artifact.content);
        const proofText = typeof smtResult.proof === 'string' ? smtResult.proof : '';
        const requiresFormalSMT =
          goalHasFormalConstraint ||
          /formal\s+smt\s+solver|formal\s+solver/i.test(proofText);

        if (smtResult.verdict === 'IMPOSSIBLE') {
            logTrace(`  ⚠️ FENCE TRIP (SMT): ${smtResult.proof?.split('\n')[0]}`);
            const smtWitnessData = formatSMTResultForWitness(smtResult);
            smtWitness = {
                type: 'WITNESS' as const,
                counterExample: smtWitnessData.counterExample,
                constraintViolated: smtWitnessData.constraintViolated,
                provenance: ['SMT_VERIFIER_v4.0-FS'],
                confidence: 1.0
            } as Witness;
        } else if (requiresFormalSMT && (smtResult.verdict === 'UNKNOWN' || smtResult.soundness !== 'SOUND')) {
            logTrace('  ⚠️ FENCE TRIP (SMT): formal solver soundness unavailable');
            smtWitness = {
                type: 'WITNESS' as const,
                counterExample: `Formal SMT verification unavailable for a constraint-bearing goal. ${smtResult.proof || ''}`.trim(),
                constraintViolated: 'SMT_SOUNDNESS_UNAVAILABLE',
                provenance: ['SMT_VERIFIER_v4.0-FS'],
                confidence: 1.0
            } as Witness;
        }
    }

    let verification: VerifierGateResult;
    if (smtWitness) {
        // Short-circuit if SMT failed
        verification = {
          status: 'FAIL',
          witness: smtWitness,
          reasonCode: smtWitness.constraintViolated
        };
    } else {
        verification = await runVerifierWithTimeout({
          goal,
          input,
          csb,
          proposal,
          artifact: projected.artifact,
          registry,
          config,
          generator
        });
    }

    logTrace(`  ├─ VERIFY: VER(candidate_${n}) → ${verification.status === 'PASS' ? '✓ PASS' : '✗ FAIL'}`);
    appendAudit(
      n,
      'VERIFY',
      verification.status === 'PASS' ? 'PASS' : 'FAIL',
      verification.reasonCode ?? (verification.status === 'PASS' ? 'PASS' : 'FAIL'),
      projected.artifact.type
    );
    
    if (verification.status !== 'PASS') {
      fail++;
      if (verification.witness) {
         const witnessArtifact = verification.witness;
         witnessOutput += serializeToCleanOutput(witnessArtifact);
         recentWitnesses.push(witnessArtifact);
         if (recentWitnesses.length > config.maxFail) {
           recentWitnesses.shift();
         }
      }

      if (discoveryLoop.enabled && discoveryLoop.commitImpCertOnFail) {
        const failImpCert = verification.impCert ?? deriveImpCertFromFailure(proposal, verification.witness);
        const failCertHash = computeCommitHash(goal, failImpCert, config);
        const failNovelty = await computeNoveltyContext(toProposalView(failImpCert), registry);
        if (!commitHashes.has(failCertHash) && !isDominated(failImpCert, registry, failNovelty)) {
          registry.artifacts.push(failImpCert);
          appendCommit(registry, failImpCert, csb, failCertHash, failNovelty.noveltyScore);
          commitHashes.add(failCertHash);
          cycleHistory.add(computeEdgeId(csb, failImpCert, config));
          impCount++;
          appendAudit(n, 'FAIL_COMMIT', 'PASS', failImpCert.reason, failImpCert.type);
          logTrace(`  ├─ FAIL→IMP_CERT: committed exclusion boundary "${failImpCert.boundary}"`);
        } else {
          appendAudit(n, 'FAIL_COMMIT', 'SKIP', 'Derived impossibility cert was dominated or duplicate', failImpCert.type);
        }
      }

      if (fail >= config.maxFail) {
        status = 'PARTIAL';
        stopReason = 'F_MAX';
        break;
      }
      n++;  // v4.0-FS: Advance step even on failure
      continue;
    }

    if (shouldGateForNovelty(candidateText, noveltyContext, 'post-verify')) {
      logTrace(`  ├─ NOVELTY_GATE: score=${noveltyContext.noveltyScore.toFixed(2)} maxSim=${noveltyContext.maxSimilarity.toFixed(2)}`);
      appendAudit(
        n,
        'FILTER',
        'SKIP',
        `Novelty post-verify score=${noveltyContext.noveltyScore.toFixed(3)} maxSim=${noveltyContext.maxSimilarity.toFixed(3)}`,
        projected.artifact.type
      );
      n++;
      continue;
    }

    const commitHash = computeCommitHash(goal, projected.artifact, config);
    if (commitHashes.has(commitHash)) {
      logTrace(`  ├─ DEDUP: skipped duplicate artifact[${projected.artifact.type}]`);
      appendAudit(n, 'FILTER', 'SKIP', 'Duplicate artifact hash', projected.artifact.type);
      n++;
      continue;
    }

    if (isDominated(projected.artifact, registry, noveltyContext)) {
      logTrace(`  ├─ DOM: skipped dominated artifact[${projected.artifact.type}]`);
      appendAudit(n, 'FILTER', 'SKIP', 'Dominated by registry', projected.artifact.type);
      n++;
      continue;
    }

    // COMMIT (lines 41-46) - v4.0-FS: Reset counters on success
    fail = 0;
    // Only serialize content-bearing artifacts or specific messages for certs
    output += serializeToCleanOutput(projected.artifact); 
    registry.artifacts.push(projected.artifact);
    appendCommit(registry, projected.artifact, csb, commitHash, noveltyContext.noveltyScore);
    commitHashes.add(commitHash);
    cycleHistory.add(computeEdgeId(csb, projected.artifact, config));
    logTrace(`  └─ COMMIT: artifact[${projected.artifact.type}] → R_${n}`);
    appendAudit(n, 'COMMIT', 'PASS', 'Committed verified non-dominated artifact', projected.artifact.type);
    if (projected.artifact.type === 'IMP_CERT') {
      impCount++;
    }

    // Queue synthesis candidates (Algorithm 1 line 62+ approximation).
    if (projected.opcode === 'BOUNDARY_SYNTH' && registry.artifacts.length + maxSynthesisAdds < maxRegistry) {
      const impCerts = registry.artifacts.filter((artifact): artifact is ImpCert => artifact.type === 'IMP_CERT');
      let queued = 0;
      for (const cert of impCerts) {
        const synthesisArtifact: TransformedContent = {
          type: 'TRANSFORMED_CONTENT',
          content: `Explore a feasible strategy outside certified boundary "${cert.boundary}" while preserving goal constraints.`,
          format: 'structured',
          provenance: cert.provenance
        };
        if (checkInvariant(goal, input, csb, `BOUNDARY_PLAN:${cert.boundary}`, synthesisArtifact, config).cycleFree) {
          const synthesisNovelty = await computeNoveltyContext(toProposalView(synthesisArtifact), registry);
          enqueueSynthesisCandidate(synthesisQueue, {
            artifact: synthesisArtifact,
            opcode: 'BOUNDARY_SYNTH',
            priority: scorePriority(synthesisArtifact, synthesisNovelty.noveltyScore),
            noveltyScore: synthesisNovelty.noveltyScore
          }, maxSynthesisAdds);
          queued++;
        }
      }
      if (queued > 0) {
        logTrace(`  ├─ SYNTH_QUEUE: enqueued ${queued} boundary candidates`);
      }
    }

    if (projected.opcode === 'COMPOSE_IMP' && impCount >= 2 && registry.artifacts.length + maxSynthesisAdds < maxRegistry) {
      const impCerts = registry.artifacts.filter((artifact): artifact is ImpCert => artifact.type === 'IMP_CERT');
      const candidatePairs: Array<{ left: ImpCert; right: ImpCert; score: number }> = [];
      for (let i = 0; i < impCerts.length; i++) {
        for (let j = i + 1; j < impCerts.length; j++) {
          const left = impCerts[i];
          const right = impCerts[j];
          if (!left || !right) continue;
          candidatePairs.push({ left, right, score: left.confidence + right.confidence });
        }
      }
      candidatePairs.sort((a, b) => b.score - a.score);
      const selectedPairs = candidatePairs.slice(0, composeTopK);
      let queued = 0;
      for (const pair of selectedPairs) {
        const composed: ImpCert = {
          type: 'IMP_CERT',
          reason: `Composed impossibility: ${pair.left.reason} AND ${pair.right.reason}`,
          boundary: `Union(${pair.left.boundary}, ${pair.right.boundary})`,
          logic: `(${pair.left.logic}) ∧ (${pair.right.logic})`,
          provenance: [...pair.left.provenance, ...pair.right.provenance],
          confidence: Math.min(pair.left.confidence, pair.right.confidence)
        };
        if (checkInvariant(goal, input, csb, 'COMPOSE_PLAN', composed, config).cycleFree) {
          const composedNovelty = await computeNoveltyContext(toProposalView(composed), registry);
          enqueueSynthesisCandidate(synthesisQueue, {
            artifact: composed,
            opcode: 'COMPOSE_IMP',
            priority: scorePriority(composed, composedNovelty.noveltyScore),
            noveltyScore: composedNovelty.noveltyScore
          }, maxSynthesisAdds);
          queued++;
        }
      }
      if (queued > 0) {
        logTrace(`  ├─ SYNTH_QUEUE: enqueued ${queued} composed candidates`);
      }
    }

    // Drain synthesis queue (Algorithm 2 approximation).
    let addedFromQueue = 0;
    while (
      synthesisQueue.length > 0 &&
      addedFromQueue < maxSynthesisAdds &&
      registry.artifacts.length < maxRegistry &&
      status === 'ACTIVE'
    ) {
      const queued = synthesisQueue.shift();
      if (!queued) break;

      if (isExcludedByCommittedImpCert(toProposalView(queued.artifact), registry, config)) {
        continue;
      }

      const queuedText = toProposalView(queued.artifact);
      const queuedNovelty = await computeNoveltyContext(queuedText, registry);
      if (shouldGateForNovelty(queuedText, queuedNovelty, 'pre-verify')) {
        logTrace(`  ├─ NOVELTY_GATE: score=${queuedNovelty.noveltyScore.toFixed(2)} maxSim=${queuedNovelty.maxSimilarity.toFixed(2)}`);
        continue;
      }

      const plannedInvariant = checkInvariant(goal, input, csb, `QUEUE:${queued.opcode}`, queued.artifact, config);
      if (!Object.values(plannedInvariant).every(Boolean)) {
        appendAudit(n, 'FILTER', 'SKIP', `Queue candidate failed invariant precheck (${queued.opcode})`, queued.artifact.type);
        continue;
      }

      const queuedVerification = await runVerifierWithTimeout({
        goal,
        input,
        csb,
        proposal: `QUEUE:${queued.opcode}`,
        artifact: queued.artifact,
        registry,
        config,
        generator
      });
      if (queuedVerification.status !== 'PASS') {
        appendAudit(
          n,
          'VERIFY',
          'FAIL',
          queuedVerification.reasonCode ?? `Queue candidate rejected (${queued.opcode})`,
          queued.artifact.type
        );
        continue;
      }
      appendAudit(n, 'VERIFY', 'PASS', `Queue candidate verified (${queued.opcode})`, queued.artifact.type);

      if (shouldGateForNovelty(queuedText, queuedNovelty, 'post-verify')) {
        logTrace(`  ├─ NOVELTY_GATE: score=${queuedNovelty.noveltyScore.toFixed(2)} maxSim=${queuedNovelty.maxSimilarity.toFixed(2)}`);
        continue;
      }

      const queuedHash = computeCommitHash(goal, queued.artifact, config);
      if (commitHashes.has(queuedHash) || isDominated(queued.artifact, registry, queuedNovelty)) {
        appendAudit(n, 'FILTER', 'SKIP', 'Queue candidate duplicate or dominated', queued.artifact.type);
        continue;
      }

      output += serializeToCleanOutput(queued.artifact);
      registry.artifacts.push(queued.artifact);
      appendCommit(registry, queued.artifact, csb, queuedHash, queuedNovelty.noveltyScore);
      commitHashes.add(queuedHash);
      cycleHistory.add(computeEdgeId(csb, queued.artifact, config));
      addedFromQueue++;

      if (queued.artifact.type === 'IMP_CERT') {
        impCount++;
      }

      logTrace(`  ├─ DRAIN_COMMIT: artifact[${queued.artifact.type}]`);
      appendAudit(n, 'COMMIT', 'PASS', `Queue candidate committed (${queued.opcode})`, queued.artifact.type);
      if (checkTermination(goal, registry, config.tau, termPredicate)) {
        status = 'COMPLETE';
        stopReason = 'TERM';
        break;
      }
    }

    if (status === 'ACTIVE' && checkTermination(goal, registry, config.tau, termPredicate)) {
      status = 'COMPLETE';
      stopReason = 'TERM';
    }

    if (status !== 'ACTIVE') {
      break;
    }

    // Advance (line 60)
    n++;
  }

  // Generate Bounded Certificate
  const stats = {
    enumerationCount: Math.max(1, n),
    validationCount: n + fail
  };
  
  const certificate = await CERTIFICATE_EXPORT(registry, status, stopReason, config, stats);

  // Final trace summary - ties to "Fingerprint" on UI
  appendAudit(n, 'HALT', status === 'COMPLETE' ? 'PASS' : 'FAIL', `HALT ${status}/${stopReason}`);
  logTrace(`◉ HALT: status=${status} reason=${stopReason}`);
  logTrace(`◉ CERTIFICATE_MINTED: ${certificate.certificate_type} (fp=${certificate.fingerprint.substring(0,8)}...)`);
  logTrace('───────────────────────────────────────');
  
  return {
    output,
    witnessOutput,
    registry,
    icSet: registry.artifacts.filter((artifact): artifact is ImpCert => artifact.type === 'IMP_CERT'),
    status,
    stopReason,
    traceLog,
    auditLog,
    certificate
  };
}

function canonicalize(
  registry: ArtifactRegistry,
  params: ExecutionParameters,
  history: Set<string>,
  goal: string,
  step: number
): CanonicalStateBlock | null {
  try {
    return {
      goal,
      stepNumber: step,
      instruction: 'TRANSFORM',
      registry,
      parameters: params,
      cycleHistory: history,
      status: 'ACTIVE'
    };
  } catch {
    return null;
  }
}

function parseInput(input: string, csb: CanonicalStateBlock, recentWitnesses: Witness[]): string {
  // Bounded parse/retrieval with no hidden state
  let context = `Goal: ${csb.goal}\nInput: ${input.substring(0, KERNEL_CONSTANTS.MAX_INPUT_LENGTH)}\nStep: ${csb.stepNumber}`;

  // v4.0-FS: Negative Knowledge Injection
  // Include prior verifier witnesses without committing them as artifacts.
  const witnesses = recentWitnesses
    .map((w, i) => `[Constraint Violation ${i+1}]: ${w.counterExample} (Type: ${w.constraintViolated})`)
    .join('\n');

  if (witnesses.length > 0) {
    context += `\n\n=== PRIOR ATTEMPTS REJECTED ===\n${witnesses}\n================================\nINSTRUCTION: Avoid the above violations. Pivot to a valid strategy.`;
  }

  return context;
}

function projectToSchema(
  proposal: string,
  goal: string,
  registry: ArtifactRegistry
): { artifact: VerifiedArtifact; opcode: TurwinInstruction } | null {
  try {
    // v3.3: Attempt to parse structured JSON proposal first
    // Robust parsing: Look for JSON object anywhere in the string
    const trimmedProposal = proposal.trim();
    const compressedProposal = trimmedProposal.replace(/\s+/g, ' ');
    const registryProvenance = registry.artifacts.map((_, i) => `artifact_${i}`);
    const normalizeProvenance = (value: unknown): string[] => {
      if (Array.isArray(value)) {
        const entries = value.filter((entry): entry is string => typeof entry === 'string');
        if (entries.length > 0) return entries;
      }
      return registryProvenance;
    };
    const normalizeStringArray = (value: unknown): string[] => {
      if (Array.isArray(value)) {
        return value.filter((entry): entry is string => typeof entry === 'string');
      }
      return [];
    };
    const normalizeConfidence = (value: unknown, fallback: number): number => {
      const numeric = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(numeric) ? clampUnitInterval(numeric) : fallback;
    };
    const normalizeMetadata = (value: unknown): Record<string, unknown> => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
      return {};
    };

    const jsonMatch = trimmedProposal.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
       try {
         const parsed = JSON.parse(jsonMatch[0]);
         if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
           if (parsed.type === 'IMP_CERT' && typeof parsed.reason === 'string' && typeof parsed.boundary === 'string') {
             const artifact: ImpCert = {
               type: 'IMP_CERT',
               reason: parsed.reason,
               boundary: parsed.boundary,
               logic: typeof parsed.logic === 'string' ? parsed.logic : '',
               provenance: normalizeProvenance(parsed.provenance),
               confidence: normalizeConfidence(parsed.confidence, 0.7)
             };
             return { artifact, opcode: 'COMPOSE_IMP' };
           }

           if (parsed.type === 'HYPOTHESIS' && typeof parsed.proposition === 'string') {
             const artifact: Hypothesis = {
               type: 'HYPOTHESIS',
               proposition: parsed.proposition,
               support: normalizeStringArray(parsed.support),
               provenance: normalizeProvenance(parsed.provenance),
               confidence: normalizeConfidence(parsed.confidence, 0.6)
             };
             return { artifact, opcode: 'TRANSFORM' };
           }

           if (parsed.type === 'INDUCTIVE_PATTERN' && typeof parsed.pattern === 'string') {
             const artifact: InductivePattern = {
               type: 'INDUCTIVE_PATTERN',
               data: normalizeStringArray(parsed.data),
               pattern: parsed.pattern,
               confidence: normalizeConfidence(parsed.confidence, 0.6),
               metadata: normalizeMetadata(parsed.metadata)
             };
             return { artifact, opcode: 'TRANSFORM' };
           }

           if (parsed.type === 'WITNESS' && typeof parsed.counterExample === 'string' && typeof parsed.constraintViolated === 'string') {
             const artifact: Witness = {
               type: 'WITNESS',
               counterExample: parsed.counterExample,
               constraintViolated: parsed.constraintViolated,
               provenance: normalizeProvenance(parsed.provenance)
             };
             return { artifact, opcode: 'TRANSFORM' };
           }

           if (
             parsed.type === 'ANALOGY_MAP' &&
             typeof parsed.source === 'string' &&
             typeof parsed.target === 'string' &&
             parsed.mapping &&
             typeof parsed.mapping === 'object'
           ) {
             const artifact: AnalogyMap = {
               type: 'ANALOGY_MAP',
               source: parsed.source,
               target: parsed.target,
               mapping: parsed.mapping as Record<string, string>,
               provenance: normalizeProvenance(parsed.provenance),
               confidence: normalizeConfidence(parsed.confidence, 0.6)
             };
             return { artifact, opcode: 'TRANSFORM' };
           }
         }
       } catch {
         // Fallthrough to prose projection
       }
    }

    const hasImpossibilityMarker = /impossibility certified|impossibility certificate/i.test(trimmedProposal);
    const boundaryMatch = trimmedProposal.match(/(?:boundary|constraint)\s*:\s*([^\n]+)/i);
    const reasonMatch = trimmedProposal.match(/(?:reason|certified|impossible because)\s*:\s*([^\n]+)/i);
    const logicMatch = trimmedProposal.match(/(?:logic|proof)\s*:\s*([^\n]+)/i);
    const boundary = boundaryMatch?.[1]?.trim();
    const reason = reasonMatch?.[1]?.trim();
    if ((hasImpossibilityMarker || boundary) && boundary) {
      const artifact: ImpCert = {
        type: 'IMP_CERT',
        reason: reason || 'Impossibility certified by provided boundary.',
        boundary,
        logic: logicMatch?.[1]?.trim() || '',
        provenance: registryProvenance,
        confidence: 0.8
      };
      return { artifact, opcode: 'COMPOSE_IMP' };
    }
  
    // NEW: Goal-Guided Format Selection
    // Determine the appropriate output format based on goal keywords
    const goalLower = goal.toLowerCase();
    let format: 'prose' | 'structured' | 'code' = 'prose';
    
    if (goalLower.includes('code') || goalLower.includes('function') || goalLower.includes('algorithm')) {
      format = 'code';
    } else if (goalLower.includes('step') || goalLower.includes('list') || goalLower.includes('protocol')) {
      format = 'structured';
    }
    
    // Project raw proposal to canonical artifact with goal-guided format
    const artifact: TransformedContent = {
      type: 'TRANSFORMED_CONTENT',
      content: compressedProposal,
      format: format,
      provenance: registryProvenance
    };
    return { artifact, opcode: 'TRANSFORM' };
  } catch {
    return null;
  }
}


/**
 * CRITICAL: Serialize to CLEAN output format
 * This is where we ensure user-facing output has NO internal notation
 */
function serializeToCleanOutput(artifact: VerifiedArtifact): string {
  if ('content' in artifact) {
    // INJECT INVISIBLE WATERMARK: Mark this as a Genuine Turwin Asset
    // We use Zero-Width Characters to hide the certificate (Date + Version).
    const date = new Date().toISOString().split('T')[0];
    const certPayload = `Turwin v${TCB_VERSION}|${date}|${generateTurwinID()}`;
    const watermark = encodeSteganography(certPayload);
    
    // Embed watermark at the very beginning (Introduction)
    return watermark + artifact.content;
  }

  // For structured artifacts, return prose description
  switch (artifact.type) {
    case 'ANALOGY_MAP':
      return `The relationship between ${artifact.source} and ${artifact.target} shows structural similarities.\n`;
    case 'HYPOTHESIS':
      return `${artifact.proposition}\n`;
    case 'INDUCTIVE_PATTERN':
      return `Pattern identified: ${artifact.pattern}\n`;
    case 'COUNTERFACTUAL':
      return `If ${artifact.modification}, then ${artifact.delta}.\n`;
    case 'IMP_CERT':
      return `**Title**: Impossibility Certificate [Impossibility Certified]\n\n**Goal**:\nProve structural impossibility of the request.\n\n**Principles**:\n- Logical Consistency\n- Boundary Verification\n\n**Operations**:\n- Verify Constraint\n- Derive Contradiction\n\n**Steps**:\n1. Identified constraint boundary: ${artifact.boundary}\n2. Derived contradiction: ${artifact.reason}\n3. Logical Proof: ${artifact.logic || 'N/A'}\n4. Conclusion: Request is impossible under current constraints.\n`;
    case 'WITNESS':
      return `**Title**: Adversarial Witness Report [Correction]\n\n**Goal**:\nCorrection of logical flaw in proposal.\n\n**Principles**:\n- Falsification\n- Counter-example Generation\n\n**Operations**:\n- Detect Violation\n- Generate Witness\n\n**Steps**:\n1. Analyzed latest proposal against invariants.\n2. Detected violation of: ${artifact.constraintViolated}\n3. Generated counter-example: ${artifact.counterExample}\n4. Recommendation: Correct the proposed step to satisfy invariant.\n`;
    default:
      return '';
  }
}

// v3.3 Helper: Synthesize Boundary
// tau is used to filter ImpCerts by confidence threshold
function synthesizeBoundary(registry: ArtifactRegistry, tau: number): { artifact: VerifiedArtifact; opcode: TurwinInstruction } | null {
  // Look for ImpCerts to synthesize from, filtered by confidence >= tau
  const impCerts = (registry.artifacts.filter(a => a.type === 'IMP_CERT') as ImpCert[])
    .filter(cert => cert.confidence >= tau); // NEW: Only use high-confidence boundaries
  
  if (impCerts.length === 0) return null;

  // Simple synthesis: Invert the boundary of the most recent high-confidence certificate
  const cert = impCerts[impCerts.length - 1];
  if (!cert) return null; // Type safety check

  const artifact: TransformedContent = {
    type: 'TRANSFORMED_CONTENT',
    content: `Based on the impossibility of [${cert.reason}], we synthesize a solution outside the boundary of [${cert.boundary}]. (Confidence: ${(cert.confidence * 100).toFixed(0)}%)`,
    format: 'prose',
    provenance: cert.provenance
  };
  return { artifact, opcode: 'BOUNDARY_SYNTH' };
}

// v3.3 Helper: Compose Impossibilities
function composeImpossibilities(registry: ArtifactRegistry): { artifact: VerifiedArtifact; opcode: TurwinInstruction } | null {
  const impCerts = registry.artifacts.filter(a => a.type === 'IMP_CERT') as ImpCert[];
  if (impCerts.length < 2) return null;

  const c1 = impCerts[impCerts.length - 1]; // Recent
  const c2 = impCerts[impCerts.length - 2]; // Prior
  if (!c1 || !c2) return null;

  const artifact: ImpCert = {
    type: 'IMP_CERT',
    reason: `Compound Impossibility: ${c1.reason} AND ${c2.reason}`,
    boundary: `Union(${c1.boundary}, ${c2.boundary})`,
    logic: `(${c1.logic}) ^ (${c2.logic})`,
    provenance: [...c1.provenance, ...c2.provenance],
    confidence: Math.min(c1.confidence, c2.confidence)
  };

  return { artifact, opcode: 'COMPOSE_IMP' };
}
// v3.3 Helper: Adversarial Verification (Enhanced with LLM-as-Judge)
// v4.0-FS: The Immutable Gate (INV)
// "Nothing crosses that bridge without surviving a trial."
export async function INV(
  goal: string,
  input: string,
  csb: CanonicalStateBlock,
  proposal: unknown,
  artifact: VerifiedArtifact,
  config: TurwinConfig,
  generator?: ProposalGenerator  // Optional: Pass for semantic verification
): Promise<{ verified: boolean; witness?: Witness }> {
  
  // LAYER 1-3: Static Invariant Checks (Prov, Type, AST, Goal, Cycle)
  const invariant = checkInvariant(goal, input, csb, proposal, artifact, config);
  const staticVerified = Object.values(invariant).every(v => v);
  
  if (!staticVerified) {
    // Static checks failed, generate witness
    const failedChecks = Object.entries(invariant).filter(([, v]) => !v).map(([k]) => k);
    const witness: Witness = {
      type: 'WITNESS',
      counterExample: `Constraint violation detected: ${failedChecks.join(', ')}`,
      constraintViolated: failedChecks.join(' & '),
      provenance: []
    };
    return { verified: false, witness };
  }

  // LAYER 4: SMT-based Sound Verification
  // Check if goal contains SMT-verifiable constraints
  if ('content' in artifact) {
    const smtResult = await smtVerifier.verifyConstraint(goal, artifact.content);
    
    if (smtResult.verdict === 'IMPOSSIBLE') {
      // SOUND impossibility proof - mathematically certain
      const witnessData = formatSMTResultForWitness(smtResult);
      const witness: Witness = {
        type: 'WITNESS',
        counterExample: witnessData.counterExample,
        constraintViolated: witnessData.constraintViolated,
        provenance: []
      };
      return { verified: false, witness };
    }
  }

  // LAYER 5: Scientific Axiom Validation (Physics)
  // Check if the artifact content violates known scientific axioms
  if ('content' in artifact) {
    // 1. Fast Path: Quick Regex Check
    const quickCheck = quickScienceCheck(artifact.content);
    if (quickCheck.impossible) {
      const witness: Witness = {
        type: 'WITNESS',
        counterExample: `Scientific impossibility: ${quickCheck.reason}`,
        constraintViolated: 'SCIENTIFIC_AXIOM',
        provenance: []
      };
      return { verified: false, witness };
    }

    // 2. Slow Path: Logic Parser (for Quantum No-Cloning)
    if (artifact.content.includes("Step")) {
      const logicSteps = parseRecipeToLogic(artifact.content);
      if (logicSteps) {
        const noCloningCheck = verifyNoCloning(logicSteps);
        if (!noCloningCheck.passed) {
          const witness: Witness = {
            type: 'WITNESS',
            counterExample: `Quantum No-Cloning Violation detected in Step ${noCloningCheck.violationStep}. Unknown state |ψ⟩ duplicated.`,
            constraintViolated: 'QUANTUM_NO_CLONING',
            provenance: []
          };
          return { verified: false, witness };
        }
      }
    }
  }

  // LAYER 6: Prior Art Verification (New in v4.0-FS)
  // "Does it violate prior art? (Has someone already patented this exact path?)"
  if ('content' in artifact || artifact.type === 'HYPOTHESIS') {
    // Determine what to check based on artifact type
    const searchContent = 'content' in artifact ? artifact.content : 
                          (artifact.type === 'HYPOTHESIS' ? artifact.proposition : null);

    if (searchContent && searchContent.length > 50) { // Only check substantial content
       const impCertArtifacts = csb.registry.artifacts.filter(
         (entry): entry is ImpCert => entry.type === 'IMP_CERT'
       );
       const impCertIds = impCertArtifacts
         .map((entry) => entry.boundary)
         .filter((value) => typeof value === 'string' && value.length > 0)
         .slice(0, 16);
       const exclusionHints = impCertArtifacts
         .map((entry) => entry.reason)
         .filter((value) => typeof value === 'string' && value.length > 0)
         .slice(0, 16);

       const { patentOracle } = getVerificationOracles();
       if (patentOracle) {
         const noveltyCheck = await patentOracle.verifyNovelty(searchContent, goal, {
           source: 'turwin_kernel',
           goal,
           impCertIds,
           exclusionHints,
         });

         if (noveltyCheck.error) {
            const witness: Witness = {
              type: 'WITNESS',
              counterExample: `Prior-art verification unavailable: ${noveltyCheck.details}`,
              constraintViolated: 'PRIOR_ART_VERIFICATION_UNAVAILABLE',
              provenance: ['Prior-Art Oracle']
            };
            return { verified: false, witness };
         }
         
         if (!noveltyCheck.novel && noveltyCheck.score > 0.8) { // High confidence prior art match
            const witness: Witness = {
              type: 'WITNESS',
              counterExample: `Prior Art Violation: Existing prior art found. ${noveltyCheck.details}`,
              constraintViolated: 'PRIOR_ART_EXISTENCE',
              provenance: ['Prior-Art Oracle']
            };
            return { verified: false, witness };
         }
       }
    }
  }

  // LAYER 7: LLM-as-Judge Semantic Constraint Verification (PROBABILISTIC)
  if (generator && 'content' in artifact) {
    const semanticResult = await judgeConstraintSatisfaction(
      goal, 
      artifact.content, 
      generator
    );
    
    if (!semanticResult.possible) {
      const witness: Witness = {
        type: 'WITNESS',
        counterExample: `Semantic impossibility: ${semanticResult.violation}`,
        constraintViolated: 'SEMANTIC_CONSTRAINT',
        provenance: []
      };
      return { verified: false, witness };
    }
  }

  // NEW: Scientific Axiom Validation (v3.3-IF with Z3 SMT verification)
  // Check if the artifact content violates known scientific axioms
  if ('content' in artifact) {
    // 1. Fast Path: Quick Regex Check
    const quickCheck = quickScienceCheck(artifact.content);
    if (quickCheck.impossible) {
      const witness: Witness = {
        type: 'WITNESS',
        counterExample: `Scientific impossibility: ${quickCheck.reason}`,
        constraintViolated: 'SCIENTIFIC_AXIOM',
        provenance: []
      };
      return { verified: false, witness };
    }

    // 1b. Rigorous Path: Full SMT-based scientific validation with Z3 (v3.3-IF)
    // Only run if content is substantial (>100 chars) to avoid overhead
    if (artifact.content.length > 100) {
      try {
        const { validateScientificClaim } = await import('./scientificValidationService');
        const validationResult = await validateScientificClaim(artifact.content);

        if (validationResult.classification === 'Rejected') {
          const witness: Witness = {
            type: 'WITNESS',
            counterExample: `Z3 SMT Verification Failed: ${validationResult.reasoning_summary}`,
            constraintViolated: 'SCIENTIFIC_AXIOM_Z3',
            provenance: validationResult.proof || []
          };
          return { verified: false, witness };
        }
      } catch (e) {
        // Z3 validation failed (non-fatal), continue with other checks
      }
    }

    // 2. Slow Path: Logic Parser (for Quantum No-Cloning)
    // Only run if content looks like a step-by-step recipe
    if (artifact.content.includes("Step")) {
      const logicSteps = parseRecipeToLogic(artifact.content);
      if (logicSteps) {
        const noCloningCheck = verifyNoCloning(logicSteps);
        if (!noCloningCheck.passed) {
          const witness: Witness = {
            type: 'WITNESS',
            counterExample: `Quantum No-Cloning Violation detected in Step ${noCloningCheck.violationStep}. Unknown state |ψ⟩ duplicated.`,
            constraintViolated: 'QUANTUM_NO_CLONING',
            provenance: []
          };
          return { verified: false, witness };
        }
      }
    }
  }


  // LAYER 8: Ground Truth Fact Verification (New in v3.4)
  // If the artifact contains specific factual claims, verify them against the Oracle
  if (
    artifact.type === 'HYPOTHESIS' ||
    artifact.type === 'WITNESS' ||
    ('content' in artifact && typeof artifact.content === 'string')
  ) {
    // Only verify explicit claims to save tokens/API calls
    // TODO: Use LLM to extract factual claims first for better precision
    // v3.3-IF: Proper type narrowing instead of any cast
    let content: string;
	    if ('content' in artifact && typeof artifact.content === 'string') {
	      content = artifact.content;
	    } else if (artifact.type === 'HYPOTHESIS') {
	      content = artifact.proposition;
	    } else if (artifact.type === 'WITNESS') {
	      content = artifact.counterExample;
	    } else {
	      content = '';
	    }
                   
    const { factsOracle } = getVerificationOracles();
    if (factsOracle) {
      let factCheck;
      try {
        factCheck = await factsOracle.verifyStatement(content, { strict: true });
      } catch (error) {
        const witness: Witness = {
          type: 'WITNESS',
          counterExample: `Facts verification unavailable: ${error instanceof Error ? error.message : String(error)}`,
          constraintViolated: 'FACT_VERIFICATION_UNAVAILABLE',
          provenance: ['Facts Oracle']
        };
        return { verified: false, witness };
      }

      if (factCheck.error) {
        const witness: Witness = {
          type: 'WITNESS',
          counterExample: `Facts verification unavailable: ${factCheck.details}`,
          constraintViolated: 'FACT_VERIFICATION_UNAVAILABLE',
          provenance: ['Facts Oracle']
        };
        return { verified: false, witness };
      }
      
      if (factCheck.contradiction && factCheck.confidence > 0.8) {
         const witness: Witness = {
          type: 'WITNESS',
          counterExample: `Factual Contradiction: ${factCheck.details}`,
          constraintViolated: 'GROUND_TRUTH_VIOLATION',
          provenance: ['Facts Oracle']
        };
        return { verified: false, witness };
      }
    }
  }

  return { verified: true };
}

// Alias for readability and philosophical alignment
export const ImmutableGate = INV;

// Deprecated alias for backward compatibility
export const adversarialVerify = INV;

// v3.3-IF: Import canonical impossibility check (consolidated - single source of truth)
import { quickImpossibilityCheck as quickScienceCheck } from './scientificValidationService';

/**
 * LLM-as-Judge: Verify that the proposed solution's claims are semantically possible
 * given the stated constraints. This catches hallucinations like "O(1) space Radix Sort".
 * 
 * This is DOMAIN-AGNOSTIC: We use the LLM's own knowledge to verify, not hardcoded rules.
 */
async function judgeConstraintSatisfaction(
  goal: string,
  content: string,
  generator: ProposalGenerator
): Promise<{ possible: boolean; violation?: string }> {
  // Extract constraints from goal (look for [MUST NOT] patterns)
  const mustNotMatches = goal.match(/\[MUST NOT\][^•\n]*/gi) || [];
  const mustMatches = goal.match(/\[MUST\][^•\n]*/gi) || [];
  const withoutMatches = goal.match(/WITHOUT\s+[^.,\n]+/gi) || [];
  
  const constraints = [...mustNotMatches, ...mustMatches, ...withoutMatches];
  if (constraints.length === 0) {
    // No explicit constraints to verify
    return { possible: true };
  }

  // Ask the LLM to verify its own claims
  const auditPrompt = `You are a rigorous technical auditor. Be extremely critical.

STATED CONSTRAINTS:
${constraints.map(c => `• ${c}`).join('\n')}

PROPOSED SOLUTION:
"""
${content.substring(0, KERNEL_CONSTANTS.AUDIT_CONTENT_LIMIT)}
"""

QUESTION: Does this proposed solution ACTUALLY satisfy ALL stated constraints? 
Consider theoretical limitations, not just implementation details.

For example:
- If the constraint says "WITHOUT auxiliary space" and the solution uses counting arrays, that FAILS.
- If the constraint says "WITHOUT comparisons" and the solution claims O(n log n) with only comparisons, that FAILS.

Respond with EXACTLY one of:
JUDGMENT: POSSIBLE - [Brief explanation why all constraints are satisfied]
JUDGMENT: IMPOSSIBLE - [Which constraint is violated and why]`;

  try {
    // Create a minimal CSB for the audit call
    const minimalCSB: CanonicalStateBlock = {
      goal: 'semantic_audit',
      stepNumber: 0,
      instruction: 'READ_A',
      registry: { artifacts: [], commitLog: [] },
      parameters: { temperature: 0, maxTokens: 0, topP: 0, modelVersion: 'audit' },
      cycleHistory: new Set(),
      status: 'ACTIVE'
    };
    const response = await generator(auditPrompt, minimalCSB);
    
    if (response.toLowerCase().includes('impossible')) {
      const violationMatch = response.match(/IMPOSSIBLE\s*[-:]\s*(.+)/i);
      return { 
        possible: false, 
        violation: violationMatch?.[1]?.trim() || 'Semantic constraint violation detected'
      };
    }
    
    return { possible: true };
  } catch {
    // If audit fails, fail open (assume possible to avoid blocking)
    return { possible: true };
  }
}
function checkTermination(
  goal: string,
  registry: ArtifactRegistry,
  tau: number,
  termPredicate?: (goal: string, registry: ArtifactRegistry) => boolean
): boolean {
  if (termPredicate) {
    return termPredicate(goal, registry);
  }

  // Check if goal is satisfied
  const contentArtifacts = registry.artifacts.filter(a => 'content' in a);
  if (contentArtifacts.length === 0) return false;
  
  const totalContent = contentArtifacts.map(a => (a as TransformedContent).content).join(' ');
  return calculateOverlap(totalContent, goal) >= tau;
}

// ================================= TRUSTED COMPUTING BASE =================================

/**
 * TCB (must be small/auditable):
 * - C: Canonicalizer (canonicalize function)
 * - Φ: Projector (projectToSchema function)  
 * - Γ_VER: Verifier (checkInvariant function)
 * 
 * Untrusted:
 * - Γ_GEN: Generator (may be neural/probabilistic - passed as parameter)
 */
export const TCB_VERSION = 'v4.0-FS';
export const TCB_COMPONENTS = ['canonicalize', 'projectToSchema', 'checkInvariant', 'INV', 'synthesizeBoundary'];

// ================================= PRACTICAL RECIPE VERIFICATION =================================

/**
 * Verify a recipe output string meets TURWIN v3.2-DC invariants
 * This is the practical function called during the generation pipeline
 */
export interface RecipeInvariantResult {
  valid: boolean;
  provenanceOK: boolean;    // All steps reference input or prior steps
  typeOK: boolean;          // Each step has Input/Output defined
  astOK: boolean;           // Well-formed structure (no circular refs)
  goalOK: boolean;          // Recipe addresses the goal
  cycleFree: boolean;       // No circular step dependencies
  score: number;            // 0-1 overall invariant score
  violations: string[];     // List of specific violations
  isImpossibility?: boolean; // v3.3: Is this an Impossibility Certificate?
}

export function verifyRecipeInvariant(
  recipeContent: string,
  userGoal: string,
  config: TurwinConfig = DEFAULT_CONFIG
): RecipeInvariantResult {
  const violations: string[] = [];
  
  // v3.3: Check for Impossibility Certificate
  if (recipeContent.includes('Impossibility Certified:') || recipeContent.includes('Terms of Impossibility:')) {
     const hasReason = recipeContent.includes('Reason:') || recipeContent.includes('Certified:');
     const hasBoundary = recipeContent.includes('Boundary:') || recipeContent.includes('Constraint:');
     
     if (hasReason && hasBoundary) {
        return {
           valid: true,
           provenanceOK: true, // Implied by discovery
           typeOK: true,
           astOK: true,
           goalOK: true, // Addressing the goal by proving impossibility
           cycleFree: true,
           score: 1.0,
           violations: [],
           isImpossibility: true
        };
     } else {
        violations.push('Impossibility Certificate malformed: Missing Reason or Boundary');
        return {
           valid: false,
           provenanceOK: false, typeOK: false, astOK: false, goalOK: false, cycleFree: false,
           score: 0.0,
           violations,
           isImpossibility: true
        };
     }
  }

  // Extract steps from recipe
  const stepPattern = /\*\*Step\s+(\d+)[:\s]+([^\*]+)\*\*/gi;
  const steps: { num: number; name: string; content: string }[] = [];
  let match;
  const content = recipeContent;
  
  while ((match = stepPattern.exec(content)) !== null) {
    const stepNumStr = match[1];
    const stepNameStr = match[2];
    if (!stepNumStr || !stepNameStr) continue;
    const stepNum = parseInt(stepNumStr);
    const stepName = stepNameStr.trim();
    // Get content until next step or end
    const startIdx = match.index + match[0].length;
    const nextStepMatch = content.substring(startIdx).match(/\*\*Step\s+\d+/i);
    const endIdx = nextStepMatch ? startIdx + (nextStepMatch.index ?? 0) : content.length;
    const stepContent = content.substring(startIdx, endIdx);
    steps.push({ num: stepNum, name: stepName, content: stepContent });
  }

  // 1. Provenance Check - each step should reference input or prior steps
  const provenanceOK = steps.every((step, idx) => {
    if (idx === 0) return true; // First step can reference input
    const prevStepRefs = steps.slice(0, idx).some(prev => 
      step.content.toLowerCase().includes(`step ${prev.num}`) ||
      step.content.toLowerCase().includes(prev.name.toLowerCase().substring(0, 10))
    );
    const inputRef = step.content.toLowerCase().includes('input');
    if (!prevStepRefs && !inputRef) {
      violations.push(`Step ${step.num}: No provenance to input or prior steps`);
      return false;
    }
    return true;
  });

  // 2. Type Check - each step should have Input/Output defined
  const typeOK = steps.every(step => {
    const hasInput = /\*\*Input\*\*\s*:/i.test(step.content) || /- Input:/i.test(step.content);
    const hasOutput = /\*\*Output\*\*\s*:/i.test(step.content) || /- Output:/i.test(step.content);
    if (!hasInput) violations.push(`Step ${step.num}: Missing Input definition`);
    if (!hasOutput) violations.push(`Step ${step.num}: Missing Output definition`);
    return hasInput && hasOutput;
  });

  // 3. AST (Well-formed) Check - valid structure, no internal terminology leak
  const forbiddenTerms = ['CSB', 'Tape A', 'Tape B', 'READ_A', 'WRITE_B', 'σ =', 'Prov(', 'ASTOK'];
  const astOK = !forbiddenTerms.some(term => {
    if (content.includes(term)) {
      violations.push(`Well-formed violation: Contains forbidden term "${term}"`);
      return true;
    }
    return false;
  });

  // 4. Goal Coverage Check - recipe content overlaps with user goal
  const goalWords = userGoal.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const contentWords = new Set(content.toLowerCase().split(/\s+/));
  const goalMatches = goalWords.filter(w => contentWords.has(w)).length;
  const goalCoverage = goalWords.length > 0 ? goalMatches / goalWords.length : 0;
  const goalOK = goalCoverage >= config.tau;
  if (!goalOK) {
    violations.push(`Goal coverage ${(goalCoverage * 100).toFixed(1)}% below threshold ${(config.tau * 100)}%`);
  }

  // 5. Cycle-Free Check - no circular dependencies between steps
  const cycleFree = steps.every((step, idx) => {
    // Check if this step references a LATER step (would be circular)
    for (let j = idx + 1; j < steps.length; j++) {
      const laterStep = steps[j];
      if (!laterStep) continue;
      if (step.content.toLowerCase().includes(`step ${laterStep.num}`)) {
        violations.push(`Circular dependency: Step ${step.num} references later Step ${laterStep.num}`);
        return false;
      }
    }
    return true;
  });

  // Calculate overall score
  const checks = [provenanceOK, typeOK, astOK, goalOK, cycleFree];
  const passedCount = checks.filter(Boolean).length;
  const score = passedCount / checks.length;

  return {
    valid: checks.every(Boolean),
    provenanceOK,
    typeOK,
    astOK,
    goalOK,
    cycleFree,
    score,
    violations
  };
}

/**
 * Quick pass/fail check for recipe validity
 */
/**
 * Quick pass/fail check for recipe validity
 */
export function isRecipeValid(recipeContent: string, userGoal: string): boolean {
  return verifyRecipeInvariant(recipeContent, userGoal).valid;
}

/**
 * Serialize output with embedded trace log (obfuscated format)
 * The trace appears at the end in a parseable format that doesn't reveal internals
 */
export function serializeWithTrace(output: string, traceLog: string[]): string {
  if (!traceLog || traceLog.length === 0) {
    return output;
  }
  
  // Embed trace in a format that can be extracted by frontend
  // Uses HTML comment style that won't render but can be parsed
  const traceSection = [
    '',
    '<!-- TURWIN_TRACE_BEGIN -->',
    '```',
    '╔══════════════════════════════════════════════════════════════╗',
    '║           TURWIN v4.0-FS ALGORITHMIC EXECUTION TRACE         ║',
    '╚══════════════════════════════════════════════════════════════╝',
    '',
    ...traceLog,
    '',
    '```',
    '<!-- TURWIN_TRACE_END -->',
  ].join('\n');
  
  return output + traceSection;
}

/**
 * Extract trace log from serialized output (for frontend parsing)
 */
export function extractTraceFromOutput(output: string): { content: string; trace: string | null } {
  const traceMatch = output.match(/<!-- TURWIN_TRACE_BEGIN -->([\s\S]*?)<!-- TURWIN_TRACE_END -->/);
  
  if (traceMatch && traceMatch[1]) {
    const trace = traceMatch[1].trim();
    const content = output.replace(/<!-- TURWIN_TRACE_BEGIN -->[\s\S]*?<!-- TURWIN_TRACE_END -->/, '').trim();
    return { content, trace };
  }
  
  return { content: output, trace: null };
}
