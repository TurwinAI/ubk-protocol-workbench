export type ComplianceControlStatus = 'linked' | 'missing';

export interface ComplianceControlEvidence {
  controlId: string;
  status: ComplianceControlStatus;
  evidenceId: string;
  source: string;
  location?: string;
}

export interface ComplianceBinding {
  policyVersion: string;
  frameworks: string[];
  controls: ComplianceControlEvidence[];
}

interface BuildComplianceBindingParams {
  runId: string;
  protocolHash: string;
  fingerprint: string;
  generatedAtMs: number;
}

const POLICY_VERSION = 'turwin-policy-v1';

export const buildComplianceBinding = (
  params: BuildComplianceBindingParams
): ComplianceBinding => {
  const controls: ComplianceControlEvidence[] = [
    {
      controlId: 'C-RISK-001',
      status: 'linked',
      evidenceId: `risk_ready_${params.runId}`,
      source: 'verifyProductionReadiness',
      location: 'audit/evidence/production-readiness.json',
    },
    {
      controlId: 'C-CERT-001',
      status: 'linked',
      evidenceId: `cert_${params.runId}`,
      source: 'certificationService',
      location: `certifications/${params.runId}`,
    },
    {
      controlId: 'C-AUDIT-001',
      status: 'linked',
      evidenceId: `audit_${params.runId}`,
      source: 'decisionRuns.approvals',
      location: `venture_launch_runs/${params.runId}/approvals`,
    },
    {
      controlId: 'C-TRACE-001',
      status: 'linked',
      evidenceId: `trace_${params.protocolHash}`,
      source: 'turwinKernel.certificate',
      location: `fingerprint:${params.fingerprint}`,
    },
    {
      controlId: 'C-POLICY-001',
      status: 'linked',
      evidenceId: `policy_${params.runId}_${params.generatedAtMs}`,
      source: 'superagent.policyVersion',
      location: POLICY_VERSION,
    },
  ];

  return {
    policyVersion: POLICY_VERSION,
    frameworks: ['NIST_AI_RMF', 'ISO_42001', 'EU_AI_ACT_ARTS_9_15'],
    controls,
  };
};
