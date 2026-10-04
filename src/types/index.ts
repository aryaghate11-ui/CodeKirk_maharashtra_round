export type VerificationDecision = 'ACCEPTED' | 'REJECTED' | 'CONFLICT' | 'PENDING';

export type BuilderStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'PENDING_APPROVAL';
export type AttestationStatus = 'MATCH' | 'CONFLICT' | 'INVALID_SIG' | 'PENDING';

export interface QuorumPolicy {
  type: 'k-of-n';
  k: number;
  n: number;
  description: string;
  strict: boolean;
  requireUniqueOperators: boolean;
  timeoutSeconds: number;
}

export interface Release {
  id: string;
  name: string;
  repo: string;
  version: string;
  commit: string;
  artifactName: string;
  target: string;
  createdAt: string;
  publishedArtifactHash: string;
  agreement: number;
  totalBuilders: number;
  policy: QuorumPolicy;
  status: VerificationDecision;
  decisionExplanation?: string;
}

export interface Builder {
  id: string;
  name: string;
  shortCode: string;
  operator: string;
  address: string;
  environment: string;
  os: string;
  runtime: string;
  region: string;
  status: BuilderStatus;
  trusted: boolean;
  uptime: number; // percentage
  latestAttestationTime: string;
  lastArtifactHash: string;
  signatureStatus: 'VALID' | 'INVALID';
  totalBuilds: number;
  agreementRate: number; // percentage
  verifiedByContract: boolean;
}

export interface Attestation {
  id: string;
  releaseId: string;
  builderId: string;
  builderName: string;
  builderAddress: string;
  artifactHash: string;
  signature: string;
  signatureValid: boolean;
  timestamp: string;
  status: AttestationStatus;
  environment: string;
  buildDurationMs: number;
  logsAvailable: boolean;
  ipfsCid?: string;
}

export interface VerificationResult {
  release: Release;
  builders: Builder[];
  attestations: Attestation[];
  agreement: number;
  totalBuilders: number;
  consensusHash: string | null;
  conflictDetected: boolean;
  conflictingBuilders: string[];
  policy: QuorumPolicy;
  policySatisfied: boolean;
  decision: VerificationDecision;
  explanation: string;
  signaturesValid: boolean;
  verifiedAt: string;
  auditChainHash: string;
  transactionHash?: string;
  blockNumber?: number;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  timeFormatted: string;
  type: 'RELEASE_REGISTERED' | 'BUILDERS_DISPATCHED' | 'ATTESTATION_SUBMITTED' | 'SIGNATURE_VERIFIED' | 'CONFLICT_DETECTED' | 'QUORUM_EVALUATED' | 'DECISION_FINALIZED' | 'AUDIT_SEALED';
  title: string;
  description: string;
  builderId?: string;
  builderName?: string;
  txHash?: string;
  blockNumber?: number;
  evidenceHash?: string;
  status: 'info' | 'success' | 'warning' | 'error';
}

export interface AuditReport {
  id: string;
  schemaVersion: string;
  releaseId: string;
  repo: string;
  commit: string;
  artifactName: string;
  publishedArtifactHash: string;
  consensusHash: string | null;
  decision: VerificationDecision;
  policy: QuorumPolicy;
  agreement: number;
  totalBuilders: number;
  conflictDetected: boolean;
  attestations: Attestation[];
  evidenceHash: string;
  policyHash: string;
  contractAddress: string;
  transactionHash: string;
  blockNumber: number;
  timestamp: string;
  gasUsed: string;
  rootSignature: string;
  anchored?: boolean;
  onChainMatch?: boolean | null;
  chainId?: number | null;
  offlineVerificationCommand?: string;
  rawReport?: object;
}

export type ScenarioId = 'valid' | 'conflict' | 'tampered' | 'invalidSignature' | 'auditTampering';

export interface ScenarioDefinition {
  id: ScenarioId;
  name: string;
  badge: string;
  subtitle: string;
  description: string;
  threatModel: string;
  builderHashes: {
    builder01: string;
    builder02: string;
    builder03: string;
  };
  signatureValidity: {
    builder01: boolean;
    builder02: boolean;
    builder03: boolean;
  };
  expectedDecision2of3: VerificationDecision;
  expectedDecision3of3: VerificationDecision;
  auditHashMatch: boolean;
  explanation: string;
}

export interface SystemStats {
  releasesVerified: number;
  releasesRejected: number;
  conflictsDetected: number;
  activeBuilders: number;
  network: string;
  contractAddress: string;
  consensusHealth: number;
  averageVerificationTimeSeconds: number;
  isBackendConnected: boolean;
  backendLatencyMs: number | null;
}

export interface ConsumerArtifactVerification {
  releaseId: string;
  artifactName: string;
  artifactSha256: string;
  consensusSha256: string | null;
  hashMatches: boolean;
  quorumStatus: 'verified' | 'rejected' | 'disagreement' | 'pending';
  decision: 'accepted' | 'rejected' | 'conflict' | 'pending';
  reason: string;
  verifiedAt: string;
  auditChainHash: string | null;
}
