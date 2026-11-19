import type { Artifact } from '../../core/execution/types';
import type { W3CVerifiableCredential } from '../../types/verifiableCredential';

export type VerificationGate = 'prior_art' | 'facts' | 'constraints';

export type GateOutcome = 'PASS' | 'FAIL_HARD' | 'FAIL_SOFT' | 'INCONCLUSIVE';

export type ImpCertTier = 'HARD_EXCLUDE' | 'REBUTTABLE_EXCLUDE' | 'STEERING_ONLY';

export interface VerificationPublicCommitEvent {
  id: string;
  round: number;
  candidateId: string;
  candidateCanonicalHash?: string;
  commitDecision: string;
  gateOutcomes: Record<string, string>;
  exclusionRuleIds: string[];
  witnessIds: string[];
  rebuttalArtifactIds: string[];
  hash: string;
  protocolHash?: string;
  createdAtMs: number;
}

export interface VerificationPublicFrontierEntry {
  candidateId: string;
  round: number;
  title: string;
  commitDecision: string;
  dominanceScore: number;
  metrics: {
    noveltyDistance?: number;
    feasibilityMargin?: number;
    specificity: number;
    measurableEffect: number;
    claimSurface: number;
    evidenceStrength?: number;
    verifierRisk: number;
    complexityPenalty?: number;
    complexity: number;
  };
}

export interface VerificationLegacyPredicate {
  language: 'VGND_PREDICATE_V1';
  operator: string;
  field: string;
  terms: string[];
  minMatchCount: number;
}

export interface VerificationPatternPredicate {
  language: 'PPL_V1';
  kind: string;
  [key: string]: unknown;
}

export interface VerificationPublicImpCert {
  id: string;
  category: string;
  tier: ImpCertTier;
  boundary: string;
  reason: string;
  predicate: VerificationLegacyPredicate | VerificationPatternPredicate;
  predicateSnippet?: string;
  provenance: {
    jobId: string;
    round: number;
    candidateId: string;
    gate: string;
    verifierStatus: string;
    confidence: number;
    sourceIds: string[];
  };
  soundnessNote?: string;
  reviewNeeded?: boolean;
  expiresAtMs?: number;
}

export interface VerificationPublicPacket {
  jobId: string;
  selectedCandidateId: string | null;
  protocolText?: string;
  protocolMeta?: {
    exclusionIdsUsed: string[];
    frontierIdsUsed: string[];
    hashes: string[];
    protocolHash: string;
    compliance?: {
      policyVersion: string;
      controlCount: number;
      evidenceIds: string[];
    };
  };
  gateSummary: {
    totalCandidates: number;
    acceptedCandidates: number;
    acceptedWithRebuttalCandidates: number;
    rejectedCandidates: number;
    priorArtPass: number;
    priorArtFail: number;
    priorArtSoftFail: number;
    priorArtInconclusive: number;
    factsPass: number;
    factsFail: number;
    factsSoftFail: number;
    factsInconclusive: number;
    constraintsPass: number;
    constraintsFail: number;
    constraintsSoftFail: number;
    constraintsInconclusive: number;
  };
  commitEvents: VerificationPublicCommitEvent[];
  dominanceFrontier: VerificationPublicFrontierEntry[];
  impCerts: VerificationPublicImpCert[];
  impCertTierCounts: Record<ImpCertTier, number>;
  candidateRegistry: Array<{
    id: string;
    title: string;
    mechanism: string;
    protocolText?: string;
    technicalEffects: string[];
    evidencePlan: string[];
    keyClaims: string[];
  }>;
  rebuttalArtifacts: Array<{
    id: string;
    candidateId: string;
    round: number;
    rebuttalSummary: string;
    items: Array<{
      delta: string;
      claimMapping: string;
      technicalEffect: string;
    }>;
    createdAtMs: number;
  }>;
  verificationBundleSummary: {
    startedAtMs: number;
    completedAtMs: number;
    durationMs: number;
    rounds: number;
    profile: {
      maxRounds: number;
      candidatesPerRound: number;
      maxClaimsPerCandidate: number;
      priorArtTimeoutMs: number;
      factsTimeoutMs: number;
      constraintsTimeoutMs: number;
      failClosed: boolean;
    };
    witnessOutput: string;
    compliance?: {
      policyVersion: string;
      frameworks: string[];
      controls: Array<{
        controlId: string;
        status: 'linked' | 'missing';
        evidenceId: string;
        source: string;
        location?: string;
      }>;
    };
  };
  valueMetrics: {
    patentabilityReadiness: number;
    feasibilityConfidence: number;
    defensibilityConfidence: number;
    commercialReadiness: number;
    forecastRoiMonths?: number;
    realizedRoiMonths?: number | null;
    roiDeltaMonths?: number | null;
    roiConfidenceDrift?: number | null;
  };
  verifiableCredential?: W3CVerifiableCredential;
}

export interface GateMatrixRow {
  gate: VerificationGate;
  pass: number;
  failHard: number;
  failSoft: number;
  inconclusive: number;
  total: number;
  passRate: number;
}

export interface CommercialReadinessSummary {
  scorecards: Array<{
    id: 'patentability' | 'feasibility' | 'defensibility' | 'commercial';
    label: string;
    score: number;
    detail: string;
  }>;
  nextActions: string[];
  summary: string;
}

const clampScore = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

const hashText = (value: string): string => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const isLegacyPredicate = (predicate: VerificationPublicImpCert['predicate']): predicate is VerificationLegacyPredicate => {
  return predicate.language === 'VGND_PREDICATE_V1';
};

const renderPatternPredicateSnippet = (predicate: VerificationPatternPredicate): string => {
  const kind = asString(predicate.kind, 'Unknown');
  if (kind === 'HasNode') {
    return `HasNode(${asString(predicate.nodeType, '*')})`;
  }
  if (kind === 'HasEdge') {
    return `HasEdge(${asString(predicate.srcType, '*')} -${asString(predicate.edgeType, '*')}-> ${asString(predicate.dstType, '*')})`;
  }
  if (kind === 'PathExists') {
    return `PathExists(${asString(predicate.fromType, '*')} -> ${asString(predicate.toType, '*')}, maxLen=${asNumber(predicate.maxLen, 1)})`;
  }
  if (kind === 'CountNodes') {
    return `CountNodes(${asString(predicate.nodeType, '*')}) ${asString(predicate.comparator, '>=')} ${asNumber(predicate.count, 0)}`;
  }
  if (kind === 'AttrCmp') {
    return `AttrCmp(${asString(predicate.nodeType, '*')}::${asString(predicate.key, 'attr')} ${asString(predicate.op, 'eq')} ${JSON.stringify(predicate.value)})`;
  }
  if (kind === 'Not' && isObject(predicate.clause)) {
    return `NOT(${renderPatternPredicateSnippet(predicate.clause as VerificationPatternPredicate)})`;
  }
  if ((kind === 'And' || kind === 'Or') && Array.isArray(predicate.clauses)) {
    const joiner = kind === 'And' ? ' AND ' : ' OR ';
    const clauses = predicate.clauses
      .filter((clause): clause is VerificationPatternPredicate => isObject(clause))
      .map((clause) => renderPatternPredicateSnippet(clause));
    return `${kind}[${clauses.join(joiner)}]`;
  }
  if (kind === 'Exists') {
    return 'Exists(...)';
  }
  return kind;
};

export const renderImpCertPredicateSnippet = (cert: VerificationPublicImpCert): string => {
  if (cert.predicateSnippet && cert.predicateSnippet.trim().length > 0) {
    return cert.predicateSnippet.trim();
  }

  if (isLegacyPredicate(cert.predicate)) {
    const terms = cert.predicate.terms.join('|');
    return `${cert.predicate.operator}(${cert.predicate.field}; terms=${terms}; min=${cert.predicate.minMatchCount})`;
  }

  return renderPatternPredicateSnippet(cert.predicate);
};

export const hasVerificationPublicPacket = (value: unknown): value is VerificationPublicPacket => {
  if (!isObject(value)) return false;
  const jobId = value['jobId'];
  const gateSummary = value['gateSummary'];
  const commitEvents = value['commitEvents'];
  const dominanceFrontier = value['dominanceFrontier'];
  const impCerts = value['impCerts'];
  return (
    typeof jobId === 'string' &&
    isObject(gateSummary) &&
    Array.isArray(commitEvents) &&
    Array.isArray(dominanceFrontier) &&
    Array.isArray(impCerts)
  );
};

export const deriveGateMatrix = (packet: VerificationPublicPacket): GateMatrixRow[] => {
  const summary = packet.gateSummary;
  const rows: GateMatrixRow[] = [
    {
      gate: 'prior_art',
      pass: asNumber(summary.priorArtPass),
      failHard: asNumber(summary.priorArtFail),
      failSoft: asNumber(summary.priorArtSoftFail),
      inconclusive: asNumber(summary.priorArtInconclusive),
      total: 0,
      passRate: 0,
    },
    {
      gate: 'facts',
      pass: asNumber(summary.factsPass),
      failHard: asNumber(summary.factsFail),
      failSoft: asNumber(summary.factsSoftFail),
      inconclusive: asNumber(summary.factsInconclusive),
      total: 0,
      passRate: 0,
    },
    {
      gate: 'constraints',
      pass: asNumber(summary.constraintsPass),
      failHard: asNumber(summary.constraintsFail),
      failSoft: asNumber(summary.constraintsSoftFail),
      inconclusive: asNumber(summary.constraintsInconclusive),
      total: 0,
      passRate: 0,
    },
  ];

  return rows.map((row) => {
    const total = Math.max(1, row.pass + row.failHard + row.failSoft + row.inconclusive);
    return {
      ...row,
      total,
      passRate: clampScore(row.pass / total),
    };
  });
};

export const deriveCommercialReadiness = (packet: VerificationPublicPacket): CommercialReadinessSummary => {
  const metrics = packet.valueMetrics;
  const summaryCounters = packet.gateSummary;
  
  const selectedCandidate = packet.candidateRegistry?.find(c => c.id === packet.selectedCandidateId) 
    || packet.candidateRegistry?.[0];
    
  let patentabilityDetail = 'Likelihood the selected mechanism is both distinct and claimable against prior art.';
  if (summaryCounters?.priorArtFail > 0) {
    patentabilityDetail = `Patentable surface is constrained by ${summaryCounters.priorArtFail} prior-art collisions, but distinct mechanisms remain.`;
  } else if (summaryCounters?.priorArtPass > 0) {
    patentabilityDetail = `High distinctness verified with ${summaryCounters.priorArtPass} successful prior-art clearances.`;
  }

  let feasibilityDetail = 'Strength of formal constraints and practical viability checks.';
  const activeEffects = selectedCandidate?.technicalEffects?.length || 0;
  if (summaryCounters?.factsFail > 0) {
    feasibilityDetail = `Feasibility impacted by ${summaryCounters.factsFail} factual check failures.`;
  } else if (summaryCounters?.factsPass > 0) {
    feasibilityDetail = `Verified ${summaryCounters.factsPass} factual constraints${activeEffects ? ` across ${activeEffects} technical effects` : ''}.`;
  }

  let defensibilityDetail = 'Expected resilience of claims under factual and technical scrutiny.';
  const hardExcludes = packet.impCertTierCounts?.HARD_EXCLUDE || 0;
  if (hardExcludes > 0) {
    defensibilityDetail = `Resilient to scrutiny, formally bounded by ${hardExcludes} hard exclusion zones.`;
  } else if (summaryCounters?.constraintsPass > 0) {
    defensibilityDetail = `Claims are highly defensible with ${summaryCounters.constraintsPass} constraints formally satisfied.`;
  }

  let commercialDetail = 'Composite score indicating handoff readiness for filing and transfer.';
  if (packet.verificationBundleSummary?.rounds > 0) {
     commercialDetail = `Handoff readiness attained across ${packet.verificationBundleSummary.rounds} verification rounds.`;
  }

  const scorecards: CommercialReadinessSummary['scorecards'] = [
    {
      id: 'patentability',
      label: 'Patentability Readiness',
      score: clampScore(metrics.patentabilityReadiness),
      detail: patentabilityDetail,
    },
    {
      id: 'feasibility',
      label: 'Feasibility Confidence',
      score: clampScore(metrics.feasibilityConfidence),
      detail: feasibilityDetail,
    },
    {
      id: 'defensibility',
      label: 'Defensibility Confidence',
      score: clampScore(metrics.defensibilityConfidence),
      detail: defensibilityDetail,
    },
    {
      id: 'commercial',
      label: 'Commercial Readiness',
      score: clampScore(metrics.commercialReadiness),
      detail: commercialDetail,
    },
  ];

  let nextActions: string[] = [
    'Draft independent and dependent claims directly from selected mechanism and differentiators.',
    'Run evidence-plan experiments to validate technical effects and collect reproducible proof.',
    'Prepare filing package with ImpCert exclusions, closest prior art, and rebuttal mappings.',
  ];

  if (selectedCandidate?.evidencePlan && selectedCandidate.evidencePlan.length > 0) {
    nextActions = selectedCandidate.evidencePlan.slice(0, 3);
  }

  const mechanism = selectedCandidate?.mechanism || 'selected mechanism';
  const claimCount = selectedCandidate?.keyClaims?.length || 0;
  
  const summary = `Commercial readiness reached ${(clampScore(metrics.commercialReadiness) * 100).toFixed(1)}%. The protocol leverages ${mechanism} with robust factual verification${claimCount ? `, generating ${claimCount} key claims` : ''}.`;

  return { scorecards, nextActions, summary };
};

export const formatScorePct = (value: number): string => `${(clampScore(value) * 100).toFixed(1)}%`;

export const buildVerificationPacketArtifacts = (packet: VerificationPublicPacket): Artifact[] => {
  const seed = `${packet.jobId}|${packet.selectedCandidateId || 'none'}`;
  const shortHash = hashText(seed);
  const baseMetadata = {
    nodeId: 'verification-ledger',
    source: 'verification_public_packet',
    packetJobId: packet.jobId,
    packetHash: shortHash,
  };

  const docs: Array<{ id: string; title: string; payload: unknown }> = [];

  if (packet.verifiableCredential) {
    docs.push({
      id: `swarm_vc_${shortHash}`,
      title: 'W3C Verifiable Credential',
      payload: packet.verifiableCredential,
    });
  }

  return docs.map((entry) => ({
    id: entry.id,
    type: 'json',
    title: entry.title,
    mimeType: 'application/json',
    content: JSON.stringify(entry.payload, null, 2),
    metadata: {
      ...baseMetadata,
      packetDocType: entry.title,
    },
  }));
};

export const normalizePacketGateOutcomes = (input: Record<string, string>): Record<VerificationGate, GateOutcome | 'UNKNOWN'> => {
  const normalize = (value: string): GateOutcome | 'UNKNOWN' => {
    if (value === 'PASS' || value === 'FAIL_HARD' || value === 'FAIL_SOFT' || value === 'INCONCLUSIVE') return value;
    return 'UNKNOWN';
  };

  return {
    prior_art: normalize(asString(input['prior_art'])),
    facts: normalize(asString(input['facts'])),
    constraints: normalize(asString(input['constraints'])),
  };
};
