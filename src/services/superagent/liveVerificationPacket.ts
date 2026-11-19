import type { ExecutionPlan } from '../../core/execution/planBuilder';
import type { Artifact, CompositeDocAst } from '../../core/execution/types';
import type {
  BoundedCertificate,
  DiscoveryAuditEntry,
  ExecutionStatus as KernelExecutionStatus,
  ImpCert as KernelImpCert,
} from '../../core-engine/turwinKernel';
import type {
  GateOutcome,
  ImpCertTier,
  VerificationGate,
  VerificationPublicCommitEvent,
  VerificationPublicFrontierEntry,
  VerificationPublicImpCert,
  VerificationPublicPacket,
} from './verificationPacket';
import { buildComplianceBinding } from './complianceEvidenceMapping';

interface LiveExecutionSnapshot {
  artifacts: Artifact[];
  ast: CompositeDocAst | null;
  nodes: Record<string, { status?: string | null }>;
}

interface LiveKernelVerificationResult {
  status?: KernelExecutionStatus;
  stopReason?: string;
  auditLog?: DiscoveryAuditEntry[];
  certificate?: BoundedCertificate;
  icSet?: KernelImpCert[];
  witnessOutput?: string;
}

type CandidateRegistryEntry = VerificationPublicPacket['candidateRegistry'][number];

type SelectedCandidateSeed = CandidateRegistryEntry & {
  round: number;
  dominanceScore: number;
  evidenceStrength: number;
  verifierRisk: number;
  noveltyDistance: number;
  feasibilityMargin: number;
  specificity: number;
  measurableEffect: number;
  claimSurface: number;
  complexityPenalty: number;
  complexity: number;
};

interface BuildLiveVerificationPacketParams {
  runId: string;
  intent: string;
  plan: ExecutionPlan;
  snapshot: LiveExecutionSnapshot;
  kernelResult?: LiveKernelVerificationResult;
  generatedAtMs?: number;
}

const KERNEL_COMPLETE_STATUS = 'COMPLETE';
const DEFAULT_STARTED_OFFSET_MS = 1_200;

const clampScore = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const hashText = (value: string): string => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const compactText = (value: string, fallback = ''): string => {
  const compact = value.replace(/\r/g, '').trim();
  return compact || fallback;
};

const stripMarkdown = (value: string): string => (
  value
    .replace(/`{1,3}/g, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim()
);

const normalizeHeading = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');

const uniqueStrings = (values: Array<string | null | undefined>, maxItems = 5): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = compactText(stripMarkdown(value || ''));
    if (!normalized) continue;
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(normalized);
    if (result.length >= maxItems) break;
  }
  return result;
};

const parseMarkdownSections = (text: string): Map<string, string> => {
  const sections = new Map<string, string>();
  const normalized = compactText(text);
  if (!normalized) return sections;

  const lines = normalized.split('\n');
  let currentHeading = '__root__';
  let buffer: string[] = [];
  const flush = () => {
    sections.set(currentHeading, buffer.join('\n').trim());
  };

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      flush();
      currentHeading = normalizeHeading(headingMatch[1] || '');
      buffer = [];
      continue;
    }
    buffer.push(line);
  }

  flush();
  return sections;
};

const getSectionText = (sections: Map<string, string>, ...headings: string[]): string => {
  for (const heading of headings) {
    const match = sections.get(normalizeHeading(heading));
    if (match && match.trim()) return match.trim();
  }
  return '';
};

const firstParagraph = (text: string): string => {
  const normalized = compactText(text);
  if (!normalized) return '';

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  for (const paragraph of paragraphs) {
    const stripped = stripMarkdown(paragraph);
    if (!stripped) continue;
    if (/^[-*]\s+/.test(paragraph) || /^\d+\.\s+/.test(paragraph)) continue;
    return stripped;
  }

  return stripMarkdown(paragraphs[0] || '');
};

const extractListItems = (text: string, maxItems = 5): string[] => {
  const lines = compactText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const items = lines
    .map((line) => {
      const bullet = line.match(/^[-*]\s+(.+)$/);
      if (bullet) return bullet[1];
      const numbered = line.match(/^\d+\.\s+(.+)$/);
      if (numbered) return numbered[1];
      return '';
    })
    .filter(Boolean);

  return uniqueStrings(items, maxItems);
};

const extractLabeledValues = (text: string, labels: string[], maxItems = 5): string[] => {
  const wanted = new Set(labels.map((label) => normalizeHeading(label)));
  const values = compactText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^([^:]+):\s*(.+)$/);
      if (!match) return [];
      const key = normalizeHeading(match[1] || '');
      if (!wanted.has(key)) return [];
      return [match[2] || ''];
    });

  return uniqueStrings(values, maxItems);
};

const extractExecutionPlanItems = (text: string, maxItems = 5): string[] => {
  const numbered = compactText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const direct = line.match(/^\d+\.\s+(.+)$/);
      if (direct) return [direct[1] || ''];
      const labeled = line.match(/^- (?:Actions|Validation|Output):\s*(.+)$/i);
      return labeled ? [labeled[1] || ''] : [];
    });

  return uniqueStrings(numbered, maxItems);
};

const findArtifactById = (artifacts: Artifact[], artifactId: string | undefined): Artifact | null => {
  if (!artifactId) return null;
  return artifacts.find((artifact) => artifact.id === artifactId) || null;
};

const findArtifactByNodeId = (
  snapshot: LiveExecutionSnapshot,
  plan: ExecutionPlan,
  nodeId: string,
): Artifact | null => {
  const astNode = snapshot.ast?.nodes.find((node) => node.id === nodeId)
    || plan.ast.nodes.find((node) => node.id === nodeId);
  const artifactFromAst = findArtifactById(snapshot.artifacts, astNode?.artifactId);
  if (artifactFromAst) return artifactFromAst;

  const nodeTitle = astNode?.title?.trim() || plan.nodes.find((node) => node.id === nodeId)?.name?.trim() || '';
  if (!nodeTitle) return null;

  return snapshot.artifacts.find((artifact) => (artifact.title || '').trim() === nodeTitle) || null;
};

const getArtifactText = (artifact: Artifact | null | undefined): string => compactText(artifact?.content || '');

const collectCompletedNodeTitles = (snapshot: LiveExecutionSnapshot, plan: ExecutionPlan): string[] => {
  const titles = plan.nodes
    .filter((node) => {
      const status = snapshot.nodes[node.id]?.status;
      return status === 'completed' && !node.id.includes('_sketch');
    })
    .map((node) => node.name);
  return uniqueStrings(titles, 5);
};

const deriveProtocolText = (
  plan: ExecutionPlan,
  protocolText: string,
  synthesisText: string,
  intent: string,
): string => {
  return compactText(protocolText)
    || compactText(plan.source.recipeText || '')
    || compactText(synthesisText)
    || compactText(intent);
};

const buildSelectedCandidate = (
  runId: string,
  intent: string,
  plan: ExecutionPlan,
  snapshot: LiveExecutionSnapshot,
  kernelResult: LiveKernelVerificationResult | undefined,
): SelectedCandidateSeed => {
  const protocolArtifact = findArtifactByNodeId(snapshot, plan, 'canonical_protocol_output');
  const searchArtifact = findArtifactByNodeId(snapshot, plan, 'canonical_search_space_output');
  const synthesisArtifact = findArtifactByNodeId(snapshot, plan, 'report-synthesis');

  const protocolText = getArtifactText(protocolArtifact);
  const searchText = getArtifactText(searchArtifact);
  const synthesisText = getArtifactText(synthesisArtifact);

  const protocolSections = parseMarkdownSections(protocolText);
  const searchSections = parseMarkdownSections(searchText);
  const synthesisSections = parseMarkdownSections(synthesisText);

  const effectiveProtocolText = deriveProtocolText(plan, protocolText, synthesisText, intent);
  const completedNodeTitles = collectCompletedNodeTitles(snapshot, plan);

  const keyClaims = uniqueStrings(
    [
      ...extractLabeledValues(getSectionText(synthesisSections, 'Evidence Ledger (Findings)'), ['Claim']),
      ...extractListItems(getSectionText(protocolSections, 'Novelty Evidence')),
      ...extractListItems(getSectionText(protocolSections, 'Verification Checks')),
      ...extractListItems(getSectionText(synthesisSections, 'Objective and Success Criteria')),
    ],
    5,
  );

  const technicalEffects = uniqueStrings(
    [
      ...extractLabeledValues(getSectionText(synthesisSections, 'Evidence Ledger (Findings)'), ['Why it matters']),
      ...extractListItems(getSectionText(synthesisSections, 'Feasibility')),
      ...extractListItems(getSectionText(protocolSections, 'Procedure')),
      ...extractListItems(getSectionText(synthesisSections, 'Commercial Model')),
    ],
    5,
  );

  const evidencePlan = uniqueStrings(
    [
      ...extractExecutionPlanItems(getSectionText(synthesisSections, 'Execution Plan')),
      ...extractListItems(getSectionText(searchSections, 'Verification Checklist')),
      ...completedNodeTitles,
    ],
    5,
  );

  const mechanism = compactText(
    firstParagraph(getSectionText(synthesisSections, 'Concept and Differentiation'))
      || firstParagraph(getSectionText(protocolSections, 'Objective'))
      || firstParagraph(effectiveProtocolText)
      || plan.title
      || intent,
    plan.title || intent || 'Live discovery candidate',
  );

  const evidenceStrength = clampScore(
    0.36
      + technicalEffects.length * 0.08
      + evidencePlan.length * 0.06
      + (kernelResult?.status === KERNEL_COMPLETE_STATUS ? 0.14 : 0),
  );

  const verifierRisk = clampScore(
    kernelResult?.status === KERNEL_COMPLETE_STATUS ? 0.16 : 0.38,
  );

  const noveltyDistance = clampScore(0.48 + keyClaims.length * 0.05 + technicalEffects.length * 0.03);
  const feasibilityMargin = clampScore(0.44 + technicalEffects.length * 0.06 + evidencePlan.length * 0.04);
  const specificity = clampScore(0.42 + keyClaims.length * 0.08 + Math.min(0.18, effectiveProtocolText.length / 3000));
  const measurableEffect = clampScore(0.38 + technicalEffects.length * 0.09);
  const claimSurface = clampScore(0.4 + keyClaims.length * 0.08);
  const complexityPenalty = clampScore(0.16 + Math.max(0, evidencePlan.length - 2) * 0.05);
  const complexity = clampScore(0.28 + evidencePlan.length * 0.05 + technicalEffects.length * 0.03);
  const dominanceScore = clampScore(
    (
      specificity
      + measurableEffect
      + claimSurface
      + evidenceStrength
      + noveltyDistance
      + feasibilityMargin
      + (1 - verifierRisk)
      + (1 - complexityPenalty)
    ) / 8,
  );

  return {
    id: `candidate_live_${hashText(`${runId}|${plan.id}`).slice(0, 10)}`,
    title: compactText(plan.title || intent, 'Live discovery candidate'),
    mechanism,
    protocolText: effectiveProtocolText,
    technicalEffects,
    evidencePlan,
    keyClaims,
    round: 1,
    dominanceScore,
    evidenceStrength,
    verifierRisk,
    noveltyDistance,
    feasibilityMargin,
    specificity,
    measurableEffect,
    claimSurface,
    complexityPenalty,
    complexity,
  };
};

const inferGateFromImpCert = (impCert: KernelImpCert): VerificationGate => {
  const haystack = `${impCert.reason} ${impCert.boundary} ${impCert.logic || ''}`.toUpperCase();
  if (haystack.includes('PRIOR') || haystack.includes('PATENT') || haystack.includes('ART')) return 'prior_art';
  if (haystack.includes('FACT') || haystack.includes('TRUTH')) return 'facts';
  return 'constraints';
};

const inferTierFromImpCert = (impCert: KernelImpCert): ImpCertTier => {
  const haystack = `${impCert.reason} ${impCert.boundary} ${impCert.logic || ''}`.toUpperCase();
  if (haystack.includes('UNAVAILABLE') || haystack.includes('TIMEOUT') || haystack.includes('EXCEPTION')) {
    return 'STEERING_ONLY';
  }
  if (haystack.includes('SOFT') || haystack.includes('REBUT') || haystack.includes('REVIEW')) {
    return 'REBUTTABLE_EXCLUDE';
  }
  return 'HARD_EXCLUDE';
};

const deriveImpCertTitle = (boundaryInput: string, reasonInput: string, index: number): string => {
  const boundary = compactText(stripMarkdown(boundaryInput || ''));
  if (boundary) return `Rejected path ${index + 1}: ${boundary.slice(0, 48)}`;
  const reason = compactText(stripMarkdown(reasonInput || ''));
  if (reason) return `Rejected path ${index + 1}: ${reason.slice(0, 48)}`;
  return `Rejected path ${index + 1}`;
};

const buildLiveImpCerts = (
  runId: string,
  kernelResult: LiveKernelVerificationResult | undefined,
): VerificationPublicImpCert[] => {
  const rawImpCerts = Array.isArray(kernelResult?.icSet) ? kernelResult?.icSet : [];

  const synthesizedImpCerts = rawImpCerts.length > 0
    ? rawImpCerts
    : kernelResult?.status && kernelResult.status !== KERNEL_COMPLETE_STATUS
      ? [
          {
            type: 'IMP_CERT' as const,
            boundary: compactText(kernelResult.stopReason || 'Verification search boundary exhausted.'),
            reason: `Kernel halted with status ${kernelResult.status}.`,
            logic: compactText(kernelResult.stopReason || ''),
            provenance: ['TURWIN_KERNEL'],
          } as KernelImpCert,
        ]
      : [];

  return synthesizedImpCerts.map((impCert, index) => {
    const gate = inferGateFromImpCert(impCert);
    const tier = inferTierFromImpCert(impCert);
    const boundary = compactText(stripMarkdown(impCert.boundary || ''), 'Derived kernel boundary');
    const reason = compactText(stripMarkdown(impCert.reason || ''), 'Rejected by kernel verification');
    const terms = uniqueStrings(
      boundary
        .split(/[^A-Za-z0-9]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3),
      4,
    );

    return {
      id: `imp_live_${hashText(`${runId}|${boundary}|${reason}|${index}`).slice(0, 10)}`,
      category: gate === 'prior_art' ? 'PRIOR_ART' : gate === 'facts' ? 'FACTS' : 'CONSTRAINTS',
      tier,
      boundary,
      reason,
      predicate: {
        language: 'VGND_PREDICATE_V1',
        operator: 'contains_any_terms',
        field: 'content',
        terms: terms.length > 0 ? terms : ['constraint'],
        minMatchCount: 1,
      },
      predicateSnippet: compactText(stripMarkdown(impCert.logic || '')) || boundary,
      provenance: {
        jobId: runId,
        round: index + 1,
        candidateId: `candidate_blocked_${index + 1}`,
        gate,
        verifierStatus: tier === 'HARD_EXCLUDE' ? 'FAIL_HARD' : tier === 'REBUTTABLE_EXCLUDE' ? 'FAIL_SOFT' : 'INCONCLUSIVE',
        confidence: clampScore(0.74 - index * 0.04),
        sourceIds: Array.isArray(impCert.provenance) ? impCert.provenance.filter((entry) => typeof entry === 'string') : [],
      },
      soundnessNote: compactText(stripMarkdown(impCert.logic || '')) || 'Kernel-derived exclusion boundary.',
      reviewNeeded: tier !== 'HARD_EXCLUDE',
    };
  });
};

const buildBlockedCandidates = (
  impCerts: VerificationPublicImpCert[],
): VerificationPublicPacket['candidateRegistry'] => impCerts.map((impCert) => ({
  id: impCert.provenance.candidateId,
  title: deriveImpCertTitle(impCert.boundary, impCert.reason, impCert.provenance.round - 1),
  mechanism: impCert.reason,
  protocolText: impCert.boundary,
  technicalEffects: uniqueStrings([impCert.soundnessNote, impCert.predicateSnippet], 2),
  evidencePlan: uniqueStrings(impCert.provenance.sourceIds, 3),
  keyClaims: [],
}));

const gateOutcomeFromTier = (tier: ImpCertTier): GateOutcome => {
  if (tier === 'HARD_EXCLUDE') return 'FAIL_HARD';
  if (tier === 'REBUTTABLE_EXCLUDE') return 'FAIL_SOFT';
  return 'INCONCLUSIVE';
};

const buildSelectedGateOutcomes = (
  kernelResult: LiveKernelVerificationResult | undefined,
): Record<VerificationGate, GateOutcome> => {
  if (kernelResult?.status === KERNEL_COMPLETE_STATUS) {
    return {
      prior_art: 'PASS',
      facts: 'PASS',
      constraints: 'PASS',
    };
  }

  return {
    prior_art: 'INCONCLUSIVE',
    facts: 'INCONCLUSIVE',
    constraints: 'INCONCLUSIVE',
  };
};

const buildCommitEvents = (
  runId: string,
  selectedCandidate: SelectedCandidateSeed,
  impCerts: VerificationPublicImpCert[],
  startedAtMs: number,
  completedAtMs: number,
  kernelResult: LiveKernelVerificationResult | undefined,
): VerificationPublicCommitEvent[] => {
  const blockedEvents = impCerts.map((impCert, index) => {
    const gate = impCert.provenance.gate as VerificationGate;
    const gateOutcomes: Record<VerificationGate, GateOutcome> = {
      prior_art: 'INCONCLUSIVE',
      facts: 'INCONCLUSIVE',
      constraints: 'INCONCLUSIVE',
    };
    gateOutcomes[gate] = gateOutcomeFromTier(impCert.tier);

    const round = index + 1;
    const createdAtMs = startedAtMs + round * 180;
    return {
      id: `commit_reject_${impCert.id}`,
      round,
      candidateId: impCert.provenance.candidateId,
      candidateCanonicalHash: hashText(`${impCert.boundary}|${impCert.reason}`),
      commitDecision: 'REJECT',
      gateOutcomes,
      exclusionRuleIds: [impCert.id],
      witnessIds: [],
      rebuttalArtifactIds: [],
      hash: hashText(`${runId}|${impCert.id}|REJECT|${round}`),
      protocolHash: hashText(impCert.boundary),
      createdAtMs,
    };
  });

  const selectedRound = Math.max(selectedCandidate.round, blockedEvents.length + 1);
  const selectedGateOutcomes = buildSelectedGateOutcomes(kernelResult);
  const selectedEvent: VerificationPublicCommitEvent = {
    id: `commit_accept_${selectedCandidate.id}`,
    round: selectedRound,
    candidateId: selectedCandidate.id,
    candidateCanonicalHash: hashText(selectedCandidate.protocolText || selectedCandidate.mechanism || selectedCandidate.title),
    commitDecision: kernelResult?.status === KERNEL_COMPLETE_STATUS ? 'ACCEPT' : 'ACCEPT_WITH_REVIEW',
    gateOutcomes: selectedGateOutcomes,
    exclusionRuleIds: [],
    witnessIds: [],
    rebuttalArtifactIds: [],
    hash: hashText(`${runId}|${selectedCandidate.id}|${selectedRound}|ACCEPT`),
    protocolHash: hashText(selectedCandidate.protocolText || selectedCandidate.title),
    createdAtMs: Math.max(completedAtMs - 60, startedAtMs + selectedRound * 200),
  };

  return [...blockedEvents, selectedEvent];
};

const buildGateSummary = (
  commitEvents: VerificationPublicCommitEvent[],
): VerificationPublicPacket['gateSummary'] => {
  const summary: VerificationPublicPacket['gateSummary'] = {
    totalCandidates: commitEvents.length,
    acceptedCandidates: 0,
    acceptedWithRebuttalCandidates: 0,
    rejectedCandidates: 0,
    priorArtPass: 0,
    priorArtFail: 0,
    priorArtSoftFail: 0,
    priorArtInconclusive: 0,
    factsPass: 0,
    factsFail: 0,
    factsSoftFail: 0,
    factsInconclusive: 0,
    constraintsPass: 0,
    constraintsFail: 0,
    constraintsSoftFail: 0,
    constraintsInconclusive: 0,
  };

  const recordGate = (gate: VerificationGate, outcome: string) => {
    if (gate === 'prior_art') {
      if (outcome === 'PASS') summary.priorArtPass += 1;
      else if (outcome === 'FAIL_HARD') summary.priorArtFail += 1;
      else if (outcome === 'FAIL_SOFT') summary.priorArtSoftFail += 1;
      else summary.priorArtInconclusive += 1;
      return;
    }

    if (gate === 'facts') {
      if (outcome === 'PASS') summary.factsPass += 1;
      else if (outcome === 'FAIL_HARD') summary.factsFail += 1;
      else if (outcome === 'FAIL_SOFT') summary.factsSoftFail += 1;
      else summary.factsInconclusive += 1;
      return;
    }

    if (outcome === 'PASS') summary.constraintsPass += 1;
    else if (outcome === 'FAIL_HARD') summary.constraintsFail += 1;
    else if (outcome === 'FAIL_SOFT') summary.constraintsSoftFail += 1;
    else summary.constraintsInconclusive += 1;
  };

  for (const event of commitEvents) {
    if (event.commitDecision === 'ACCEPT') summary.acceptedCandidates += 1;
    else if (event.commitDecision === 'ACCEPT_WITH_REVIEW') summary.acceptedWithRebuttalCandidates += 1;
    else if (event.commitDecision === 'REJECT') summary.rejectedCandidates += 1;

    recordGate('prior_art', String(event.gateOutcomes.prior_art || 'INCONCLUSIVE'));
    recordGate('facts', String(event.gateOutcomes.facts || 'INCONCLUSIVE'));
    recordGate('constraints', String(event.gateOutcomes.constraints || 'INCONCLUSIVE'));
  }

  return summary;
};

const buildFrontier = (
  selectedCandidate: SelectedCandidateSeed,
): VerificationPublicFrontierEntry[] => [
  {
    candidateId: selectedCandidate.id,
    round: selectedCandidate.round,
    title: selectedCandidate.title,
    commitDecision: 'SELECTED',
    dominanceScore: selectedCandidate.dominanceScore,
    metrics: {
      noveltyDistance: selectedCandidate.noveltyDistance,
      feasibilityMargin: selectedCandidate.feasibilityMargin,
      specificity: selectedCandidate.specificity,
      measurableEffect: selectedCandidate.measurableEffect,
      claimSurface: selectedCandidate.claimSurface,
      evidenceStrength: selectedCandidate.evidenceStrength,
      verifierRisk: selectedCandidate.verifierRisk,
      complexityPenalty: selectedCandidate.complexityPenalty,
      complexity: selectedCandidate.complexity,
    },
  },
];

const buildTierCounts = (impCerts: VerificationPublicImpCert[]): Record<ImpCertTier, number> => ({
  HARD_EXCLUDE: impCerts.filter((impCert) => impCert.tier === 'HARD_EXCLUDE').length,
  REBUTTABLE_EXCLUDE: impCerts.filter((impCert) => impCert.tier === 'REBUTTABLE_EXCLUDE').length,
  STEERING_ONLY: impCerts.filter((impCert) => impCert.tier === 'STEERING_ONLY').length,
});

const buildValueMetrics = (
  selectedCandidate: SelectedCandidateSeed,
  gateSummary: VerificationPublicPacket['gateSummary'],
  impCerts: VerificationPublicImpCert[],
): VerificationPublicPacket['valueMetrics'] => {
  const priorArtPenalty = gateSummary.priorArtFail * 0.08 + gateSummary.priorArtSoftFail * 0.04;
  const factsPenalty = gateSummary.factsFail * 0.06 + gateSummary.factsSoftFail * 0.03;
  const constraintsPenalty = gateSummary.constraintsFail * 0.06 + gateSummary.constraintsSoftFail * 0.03;
  const steeringPenalty = impCerts.filter((impCert) => impCert.tier === 'STEERING_ONLY').length * 0.02;

  const patentabilityReadiness = clampScore(
    (selectedCandidate.noveltyDistance
      + selectedCandidate.specificity
      + selectedCandidate.claimSurface
      + (1 - selectedCandidate.verifierRisk)) / 4
      - priorArtPenalty,
  );

  const feasibilityConfidence = clampScore(
    (selectedCandidate.feasibilityMargin
      + selectedCandidate.evidenceStrength
      + (1 - selectedCandidate.complexityPenalty)) / 3
      - constraintsPenalty
      - steeringPenalty,
  );

  const defensibilityConfidence = clampScore(
    (selectedCandidate.claimSurface
      + selectedCandidate.specificity
      + selectedCandidate.evidenceStrength) / 3
      - factsPenalty,
  );

  const commercialReadiness = clampScore(
    (patentabilityReadiness + feasibilityConfidence + defensibilityConfidence) / 3,
  );
  const forecastRoiMonths = Math.max(3, Math.min(36, Math.round((1 - commercialReadiness) * 30 + 6)));
  const realizedRoiMonths = Math.max(3, Math.round(forecastRoiMonths * (0.92 + (1 - selectedCandidate.verifierRisk) * 0.18)));
  const roiDeltaMonths = realizedRoiMonths - forecastRoiMonths;
  const roiConfidenceDrift = Number((clampScore(feasibilityConfidence - commercialReadiness)).toFixed(4));

  return {
    patentabilityReadiness,
    feasibilityConfidence,
    defensibilityConfidence,
    commercialReadiness,
    forecastRoiMonths,
    realizedRoiMonths,
    roiDeltaMonths,
    roiConfidenceDrift,
  };
};

const buildBundleSummary = (
  selectedCandidate: SelectedCandidateSeed,
  candidateCount: number,
  startedAtMs: number,
  completedAtMs: number,
  kernelResult: LiveKernelVerificationResult | undefined,
  compliance: ReturnType<typeof buildComplianceBinding>,
): VerificationPublicPacket['verificationBundleSummary'] => ({
  startedAtMs,
  completedAtMs,
  durationMs: Math.max(1, completedAtMs - startedAtMs),
  rounds: selectedCandidate.round,
  profile: {
    maxRounds: Math.max(3, selectedCandidate.round + 1),
    candidatesPerRound: Math.max(1, candidateCount),
    maxClaimsPerCandidate: Math.max(3, selectedCandidate.keyClaims.length || 0),
    priorArtTimeoutMs: 12_000,
    factsTimeoutMs: 8_000,
    constraintsTimeoutMs: 10_000,
    failClosed: true,
  },
  witnessOutput: compactText(kernelResult?.witnessOutput || ''),
  compliance: {
    policyVersion: compliance.policyVersion,
    frameworks: compliance.frameworks,
    controls: compliance.controls,
  },
});

export const buildLiveVerificationPacket = (
  params: BuildLiveVerificationPacketParams,
): VerificationPublicPacket => {
  const generatedAtMs = Number.isFinite(params.generatedAtMs) ? Number(params.generatedAtMs) : Date.now();
  const auditLog = Array.isArray(params.kernelResult?.auditLog) ? params.kernelResult?.auditLog : [];
  const startedAtMs = auditLog.length > 0
    ? Math.min(...auditLog.map((entry) => entry.timestamp))
    : generatedAtMs - DEFAULT_STARTED_OFFSET_MS;
  const completedAtMs = auditLog.length > 0
    ? Math.max(...auditLog.map((entry) => entry.timestamp))
    : generatedAtMs;

  const selectedCandidate = buildSelectedCandidate(
    params.runId,
    params.intent,
    params.plan,
    params.snapshot,
    params.kernelResult,
  );

  const impCerts = buildLiveImpCerts(params.runId, params.kernelResult);
  selectedCandidate.round = Math.max(selectedCandidate.round, impCerts.length + 1);
  const blockedCandidates = buildBlockedCandidates(impCerts);
  const commitEvents = buildCommitEvents(
    params.runId,
    selectedCandidate,
    impCerts,
    startedAtMs,
    completedAtMs,
    params.kernelResult,
  );

  const candidateRegistry: VerificationPublicPacket['candidateRegistry'] = [
    {
      id: selectedCandidate.id,
      title: selectedCandidate.title,
      mechanism: selectedCandidate.mechanism,
      protocolText: selectedCandidate.protocolText,
      technicalEffects: selectedCandidate.technicalEffects,
      evidencePlan: selectedCandidate.evidencePlan,
      keyClaims: selectedCandidate.keyClaims,
    },
    ...blockedCandidates,
  ];

  const frontier = buildFrontier(selectedCandidate);
  const gateSummary = buildGateSummary(commitEvents);
  const impCertTierCounts = buildTierCounts(impCerts);
  const valueMetrics = buildValueMetrics(selectedCandidate, gateSummary, impCerts);
  const protocolHash = hashText(selectedCandidate.protocolText || params.plan.source.recipeText || params.intent || params.plan.title);
  const fingerprint = compactText(params.kernelResult?.certificate?.fingerprint || '', protocolHash);
  const compliance = buildComplianceBinding({
    runId: params.runId,
    protocolHash,
    fingerprint,
    generatedAtMs,
  });

  return {
    jobId: params.runId,
    selectedCandidateId: selectedCandidate.id,
    protocolText: selectedCandidate.protocolText,
    protocolMeta: {
      exclusionIdsUsed: impCerts.map((impCert) => impCert.id),
      frontierIdsUsed: frontier.map((entry) => entry.candidateId),
      hashes: uniqueStrings([protocolHash, fingerprint], 4),
      protocolHash,
      compliance: {
        policyVersion: compliance.policyVersion,
        controlCount: compliance.controls.length,
        evidenceIds: compliance.controls.map((control) => control.evidenceId),
      },
    },
    gateSummary,
    commitEvents,
    dominanceFrontier: frontier,
    impCerts,
    impCertTierCounts,
    candidateRegistry,
    rebuttalArtifacts: [],
    verificationBundleSummary: buildBundleSummary(
      selectedCandidate,
      candidateRegistry.length,
      startedAtMs,
      completedAtMs,
      params.kernelResult,
      compliance,
    ),
    valueMetrics,
  };
};
