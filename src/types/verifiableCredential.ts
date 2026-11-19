export interface W3CProof {
  type: string;
  created: string;
  proofPurpose: string;
  verificationMethod: string;
  cryptosuite?: string;
  proofValue: string;
}

export interface CredentialSubjectObject {
  id: string;
  type: string;
  contentHash: string;
  metadata?: Record<string, unknown>;
}

export interface CredentialSubject {
  id: string;
  action: string;
  object: CredentialSubjectObject;
  mathematicalProof?: {
    available: boolean;
    claims?: Record<string, unknown>;
  };
}

export interface W3CVerifiableCredential {
  '@context': string[];
  id: string;
  type: string[];
  issuer: string;
  issuanceDate: string;
  credentialSubject: CredentialSubject;
  proof?: W3CProof;
}
