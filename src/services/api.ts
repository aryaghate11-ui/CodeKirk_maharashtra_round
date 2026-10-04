import {
  Release,
  Builder,
  Attestation,
  VerificationResult,
  QuorumPolicy,
  AuditReport,
  AuditEvent,
  SystemStats,
  ConsumerArtifactVerification,
  ReleaseTrustSummary,
  BuilderBuild,
} from '../types';
import {
  ApiConsumerArtifactResponse,
  ApiBuilderRegistryResponse,
  ApiAuditEvent,
  ApiAuditReportResponse,
  ApiSystemStatsResponse,
  ApiVerificationResponse,
  ApiVerificationStatus,
  ApiReleaseTrustSummaryResponse,
  ApiBuilderBuildResponse,
} from '../types/api';
import {
  FixtureItem,
  CompareRequest,
  ComparisonResponse,
  ComparisonListItem,
  ReviewRequest,
} from '../types/sentinel';
import {
  ArtifactMonitor,
  RelayCheck,
  RelayStats,
  VerifiedReleaseItem,
  CreateMonitorInput,
  UpdateMonitorInput,
  GitHubReleaseInfo,
  EstablishBaselineInput,
  RelayBaselineEvent,
} from '../types/relay';
import {
  CreateLivingIncident,
  LivingAssessment,
  LivingBuilder,
  LivingIncident,
  LivingIncidentResult,
  LivingStats,
} from '../types/living';
const RAW_API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
export const API_BASE = RAW_API_URL
  ? (RAW_API_URL.endsWith('/api/v1') ? RAW_API_URL : `${RAW_API_URL}/api/v1`)
  : '/api/v1';
// Runtime verification always fails closed. Synthetic data is confined to the
// explicit Attack Lab backend and is never substituted for release evidence.

const decisionFromStatus = (status: ApiVerificationStatus): VerificationResult['decision'] => ({
  verified: 'ACCEPTED',
  rejected: 'REJECTED',
  disagreement: 'CONFLICT',
  pending: 'PENDING',
}[status] as VerificationResult['decision']);

const repositoryLabel = (url: string): string =>
  url.replace(/^https?:\/\//, '').replace(/\/$/, '');

const mapVerificationResponse = (
  data: ApiVerificationResponse,
  policyType: '2-of-3' | '3-of-3'
): VerificationResult => {
  const consensusHash = data.consensus_sha256;
  const agreement = consensusHash
    ? data.builders.filter((builder) => builder.artifact_sha256 === consensusHash).length
    : 0;
  const totalBuilders = data.release.expected_builders || 3;
  const decision = decisionFromStatus(data.status);
  const policy: QuorumPolicy = {
    type: 'k-of-n',
    k: data.threshold,
    n: totalBuilders,
    description: `${policyType} signed builder quorum`,
    strict: data.release.reject_on_conflict,
    requireUniqueOperators: true,
    timeoutSeconds: 300,
  };
  const repo = repositoryLabel(data.release.repository_url);
  const packageName = repo.split('/').pop() || 'release';

  // Only evidence returned by the backend is represented as a builder result.
  // Missing submissions are expressed by expected_builders minus this list,
  // never by manufacturing placeholder builders or attestations.
  const builders: Builder[] = data.builders.map((builder, index) => {
    return {
      id: builder.id,
      name: builder.name,
      shortCode: builder.name
        .split(/\s+/)
        .map((word) => word[0])
        .join('')
        .slice(0, 2)
        .toUpperCase(),
      operator: builder.operator,
      address: `ed25519:${builder.signing_key_fingerprint}`,
      environment: builder.environment,
      os: builder.platform,
      runtime: builder.attestation_schema,
      region: `Builder ${index + 1}`,
      status: 'ATTESTED',
      trusted: true,
      uptime: null,
      latestAttestationTime: builder.built_at,
      lastArtifactHash: builder.artifact_sha256,
      signatureStatus: builder.signature_valid ? 'VALID' : 'INVALID',
      livenessStatus: 'UNKNOWN',
      deploymentClass: builder.id === 'github-actions' || builder.id === 'gitlab-ci'
        ? 'HOSTED_RUNNER'
        : 'LOCAL_ISOLATED',
      independenceVerified: false,
      independenceEvidence: builder.id === 'local-builder'
        ? 'Evidence was signed by the registered local builder key.'
        : 'Evidence was signed by the registered hosted CI builder key.',
      totalBuilds: 1,
      agreementRate: builder.artifact_sha256 === consensusHash ? 100 : 0,
      verifiedByContract: false,
    };
  });

  const attestations: Attestation[] = data.builders.map((builder) => {
    const isMatch = builder.signature_valid && builder.artifact_sha256 === consensusHash;
    const isInvalidSig = !builder.signature_valid;

    return {
      id: builder.evidence_digest,
      releaseId: data.release_id,
      builderId: builder.id,
      builderName: builder.name,
      builderAddress: `ed25519:${builder.signing_key_fingerprint}`,
      artifactHash: builder.artifact_sha256,
      signature: builder.signature,
      signatureValid: builder.signature_valid,
      timestamp: builder.built_at,
      status: isInvalidSig
        ? 'INVALID_SIG'
        : isMatch
        ? 'MATCH'
        : 'CONFLICT',
      environment: builder.environment,
      buildDurationMs: 0,
      logsAvailable: false,
    };
  });

  const explanation = data.status === 'verified'
    ? `${agreement} of ${totalBuilders} signed builder results match the release artifact.`
    : data.status === 'disagreement'
      ? 'Trusted builders produced conflicting artifact hashes.'
      : data.status === 'rejected'
        ? 'The available signed evidence does not satisfy this release policy.'
        : 'More independent signed evidence is required before this release can be trusted.';

  return {
    release: {
      id: data.release_id,
      name: packageName,
      repo,
      version: `commit ${data.release.source_commit.slice(0, 7)}`,
      commit: data.release.source_commit,
      artifactName: data.release.artifact_name,
      target: 'linux / amd64',
      createdAt: data.release.created_at,
      publishedArtifactHash: data.candidate_sha256,
      agreement,
      totalBuilders,
      policy,
      status: decision,
      decisionExplanation: explanation,
    },
    builders,
    attestations,
    agreement,
    totalBuilders,
    consensusHash,
    conflictDetected: !data.rules.conflicts,
    conflictingBuilders: data.builders
      .filter((builder) => builder.artifact_sha256 !== consensusHash)
      .map((builder) => builder.id),
    policy,
    policySatisfied: data.status === 'verified',
    decision,
    explanation,
    signaturesValid: data.rules.signatures,
    verifiedAt: data.audit_events[data.audit_events.length - 1]?.created_at || data.release.created_at,
    auditChainHash: data.audit_chain_head || '',
  };
};

const mapAuditEvent = (event: ApiAuditEvent, index: number): AuditEvent => {
  const details = JSON.parse(event.event_json) as Record<string, unknown>;
  const definitions: Record<string, Pick<AuditEvent, 'type' | 'title' | 'status'>> = {
    'release.registered': {
      type: 'RELEASE_REGISTERED',
      title: 'Release registered for verification',
      status: 'info',
    },
    'attestation.accepted': {
      type: 'ATTESTATION_SUBMITTED',
      title: 'Signed builder attestation accepted',
      status: 'success',
    },
    'decision.recorded': {
      type: 'DECISION_FINALIZED',
      title: 'Quorum decision finalized',
      status: details.status === 'verified' ? 'success' : 'warning',
    },
    'consumer.artifact.verified': {
      type: 'SIGNATURE_VERIFIED',
      title: 'Consumer artifact checked',
      status: details.hash_matches ? 'success' : 'error',
    },
    'blockchain.evidence.anchored': {
      type: 'AUDIT_SEALED',
      title: 'Evidence SHA-256 anchored on Anvil',
      status: 'success',
    },
  };
  const definition = definitions[event.event_type] || {
    type: 'QUORUM_EVALUATED' as const,
    title: event.event_type,
    status: 'info' as const,
  };
  return {
    id: event.event_hash || `event-${index}`,
    timestamp: event.created_at,
    timeFormatted: new Date(event.created_at).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
    ...definition,
    description: Object.entries(details)
      .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
      .join(' · '),
    builderId: typeof details.builder_id === 'string' ? details.builder_id : undefined,
    txHash: typeof details.transaction_hash === 'string' ? details.transaction_hash : undefined,
    blockNumber: typeof details.block_number === 'number' ? details.block_number : undefined,
    evidenceHash: event.event_hash,
  };
};

const mapAuditReport = (data: ApiAuditReportResponse): AuditReport => {
  const evidence = data.evidence;
  const consensusHash = evidence.decision.consensus_sha256;
  const agreement = consensusHash
    ? evidence.builders.filter((builder) => builder.artifact_sha256 === consensusHash).length
    : 0;
  const policy: QuorumPolicy = {
    type: 'k-of-n',
    k: evidence.policy.threshold,
    n: evidence.policy.expected_builders,
    description: `${evidence.policy.threshold}-of-${evidence.policy.expected_builders} signed builder quorum`,
    strict: evidence.policy.reject_on_conflict,
    requireUniqueOperators: evidence.policy.minimum_operators > 1,
    timeoutSeconds: 300,
  };
  const attestations: Attestation[] = evidence.builders.map((builder) => ({
    id: builder.evidence_digest,
    releaseId: data.release_id,
    builderId: builder.id,
    builderName: builder.name,
    builderAddress: `ed25519:${builder.signing_key_fingerprint}`,
    artifactHash: builder.artifact_sha256,
    signature: builder.signature,
    signatureValid: builder.signature_valid,
    timestamp: builder.built_at,
    status: builder.artifact_sha256 === consensusHash ? 'MATCH' : 'CONFLICT',
    environment: builder.environment,
    buildDurationMs: 0,
    logsAvailable: false,
  }));
  return {
    id: `audit-${data.release_id}`,
    schemaVersion: data.schema_version,
    releaseId: data.release_id,
    repo: repositoryLabel(evidence.release.repository_url),
    commit: evidence.release.source_commit,
    artifactName: evidence.release.artifact_name,
    publishedArtifactHash: evidence.release.candidate_sha256,
    consensusHash,
    decision: decisionFromStatus(evidence.decision.status),
    policy,
    agreement,
    totalBuilders: evidence.builders.length,
    conflictDetected: !evidence.decision.rules.conflicts,
    attestations,
    evidenceHash: data.evidence_sha256,
    policyHash: evidence.policy_sha256,
    contractAddress: data.blockchain.contract_address || 'Not anchored',
    transactionHash: data.blockchain.transaction_hash || '',
    blockNumber: data.blockchain.block_number || 0,
    timestamp: data.blockchain.anchored_at || data.generated_at,
    gasUsed: data.blockchain.gas_used?.toLocaleString() || '—',
    rootSignature: data.report_signature.signature,
    anchored: data.blockchain.anchored,
    onChainMatch: data.blockchain.on_chain_match,
    chainId: data.blockchain.chain_id || null,
    offlineVerificationCommand: data.offline_verification.command,
    rawReport: data,
  };
};

export class BackendError extends Error {
  constructor(
    message: string,
    public status?: number,
    public endpoint?: string
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

class QuorumApiService {
  private backendAvailable: boolean = false;
  private lastPingMs: number = 42;
  private adminToken: string = typeof window !== 'undefined' ? sessionStorage.getItem('quorum-admin-token') || '' : '';

  constructor() {
    this.detectBackend();
  }

  public async detectBackend(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const start = performance.now();
      const res = await fetch(`${API_BASE}/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const health = await res.json();
        if (health.status !== 'ok' || health.api_version !== 'v1') {
          this.backendAvailable = false;
          return false;
        }
        this.backendAvailable = true;
        this.lastPingMs = Math.round(performance.now() - start);
        return true;
      }
    } catch {
      this.backendAvailable = false;
    }
    return false;
  }

  public isStrictBackendMode(): boolean {
    return true;
  }

  public setStrictBackendMode(_strict: boolean): void {
    // Compatibility no-op: verification is always fail-closed.
  }

  public isBackendAvailable(): boolean {
    return this.backendAvailable;
  }

  private adminHeaders(): Record<string, string> {
    return this.adminToken ? { 'X-Quorum-Admin-Token': this.adminToken } : {};
  }

  public isAdminUnlocked(): boolean {
    return Boolean(this.adminToken);
  }

  public lockAdmin(): void {
    this.adminToken = '';
    if (typeof window !== 'undefined') sessionStorage.removeItem('quorum-admin-token');
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('quorum-admin-change'));
  }

  public async unlockAdmin(token: string): Promise<void> {
    const cleanToken = token.trim();
    const res = await fetch(`${API_BASE}/auth/verify`, {
      method: 'POST',
      headers: { 'X-Quorum-Admin-Token': cleanToken },
    });
    if (!res.ok) throw new BackendError('Invalid administrator token.', res.status, '/auth/verify');
    this.adminToken = cleanToken;
    if (typeof window !== 'undefined') sessionStorage.setItem('quorum-admin-token', cleanToken);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('quorum-admin-change'));
  }

  private async requiredAdminHeaders(includeJson = false): Promise<Record<string, string>> {
    if (!this.adminToken && typeof window !== 'undefined') {
      const token = window.prompt(
        'This security action requires administrator authorization. Enter the Quorum admin token printed in the backend terminal:'
      );
      if (token?.trim()) await this.unlockAdmin(token);
    }
    if (!this.adminToken) {
      throw new BackendError(
        'Administrator authorization is required for this action. Use “Admin locked” in the header and enter the token printed by the backend.',
        401,
      );
    }
    return {
      ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
      ...this.adminHeaders(),
    };
  }

  public isMockMode(): boolean {
    return false;
  }

  public async getSystemStats(): Promise<SystemStats> {
    const res = await fetch(`${API_BASE}/stats`);
    if (!res.ok) {
      throw new BackendError(`Status ${res.status}; no mock state substituted`, res.status, '/stats');
    }
    this.backendAvailable = true;
    const data = await res.json() as ApiSystemStatsResponse;
    return {
      releasesVerified: data.releases_verified,
      releasesRejected: data.releases_rejected,
      conflictsDetected: data.conflicts_detected,
      activeBuilders: data.active_builders,
      network: data.network,
      contractAddress: data.contract_address,
      consensusHealth: data.consensus_health,
      averageVerificationTimeSeconds: data.average_verification_time_seconds,
      isBackendConnected: true,
      backendLatencyMs: this.lastPingMs,
    };
  }

  public async getReleases(): Promise<Release[]> {
    const res = await fetch(`${API_BASE}/releases`);
    if (!res.ok) throw new BackendError(`Status ${res.status}; no mock state substituted`, res.status, '/releases');
    const data = await res.json() as ApiVerificationResponse[];
    return data.map((item) => mapVerificationResponse(
      item,
      item.threshold === 3 ? '3-of-3' : '2-of-3'
    ).release);
  }

  public async getRelease(id: string): Promise<Release | null> {
    const endpoint = `/releases/${encodeURIComponent(id)}`;
    const res = await fetch(`${API_BASE}${endpoint}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new BackendError(`Status ${res.status}; no mock state substituted`, res.status, endpoint);
    const data = await res.json() as ApiVerificationResponse;
    return mapVerificationResponse(data, data.threshold === 3 ? '3-of-3' : '2-of-3').release;
  }

  public async getTrustSummary(releaseId: string): Promise<ReleaseTrustSummary> {
    try {
      const res = await fetch(`${API_BASE}/releases/${releaseId}/trust-summary`);
      if (!res.ok) {
        throw new BackendError(`Status ${res.status}`, res.status, `/releases/${releaseId}/trust-summary`);
      }
      const data = await res.json() as ApiReleaseTrustSummaryResponse;
      return {
        schemaVersion: data.schema_version,
        releaseId: data.release_id,
        historicalStatus: data.historical_status,
        currentStatus: data.current_status,
        installationAllowed: data.installation_allowed,
        decisionReason: data.decision_reason,
        overallRecommendation: data.overall_recommendation,
        recommendationReason: data.recommendation_reason,
        artifactReproducibility: data.artifact_reproducibility,
        livingVerification: data.living_verification,
        sourceSentinel: data.source_sentinel,
        relay: data.relay,
        blockchain: data.blockchain,
      };
    } catch (error: any) {
      throw error instanceof BackendError
        ? error
        : new BackendError(
            `Release trust summary failed: ${error.message || 'Connection error'}`,
            error.status,
            `/releases/${releaseId}/trust-summary`,
          );
    }
  }

  public async getBuilders(): Promise<Builder[]> {
    const res = await fetch(`${API_BASE}/builders`);
    if (!res.ok) throw new BackendError(`Status ${res.status}; no mock state substituted`, res.status, '/builders');
    const data = await res.json() as ApiBuilderRegistryResponse[];
    return data.map((builder) => ({
            id: builder.id,
            name: builder.name,
            shortCode: builder.name
              .split(/\s+/)
              .map((word) => word[0])
              .join('')
              .slice(0, 2)
              .toUpperCase(),
            operator: builder.operator,
            address: `ed25519:${builder.signing_key_fingerprint}`,
            environment: builder.platform,
            os: builder.platform,
            runtime: 'quorum.attestation.v2',
            region: builder.operator,
            status: builder.evidence_status,
            trusted: builder.trusted,
            uptime: null,
            latestAttestationTime: builder.latest_attestation_at,
            lastArtifactHash: builder.latest_artifact_sha256,
            signatureStatus: builder.latest_signature_valid === null
              ? 'NOT_ATTESTED'
              : builder.latest_signature_valid ? 'VALID' : 'INVALID',
            livenessStatus: builder.liveness_status,
            deploymentClass: builder.deployment_class,
            independenceVerified: builder.independence_verified,
            independenceEvidence: builder.independence_evidence,
            totalBuilds: builder.total_builds,
            agreementRate: builder.agreement_rate,
            verifiedByContract: false,
          }));
  }

  public async getBuilderBuilds(builderId: string): Promise<BuilderBuild[]> {
    const endpoint = `/builders/${encodeURIComponent(builderId)}/builds`;
    const res = await fetch(`${API_BASE}${endpoint}`);
    if (!res.ok) throw new BackendError(`Status ${res.status}: Failed to load builder outputs`, res.status, endpoint);
    return (await res.json() as ApiBuilderBuildResponse[]).map((build) => ({
      releaseId: build.release_id,
      repositoryUrl: build.repository_url,
      sourceCommit: build.source_commit,
      artifactName: build.artifact_name,
      artifactSha256: build.artifact_sha256,
      candidateSha256: build.candidate_sha256,
      consensusSha256: build.consensus_sha256,
      releaseStatus: build.release_status,
      signatureValid: build.signature_valid,
      matchesConsensus: build.matches_consensus,
      matchesCandidate: build.matches_candidate,
      builtAt: build.built_at,
      environment: build.environment,
      attestationSchema: build.attestation_schema,
      evidenceDigest: build.evidence_digest,
    }));
  }

  public async getVerification(releaseId: string): Promise<VerificationResult> {
    const endpoint = `/releases/${encodeURIComponent(releaseId)}`;
    const res = await fetch(`${API_BASE}${endpoint}`);
    if (!res.ok) throw new BackendError(`Status ${res.status}; no mock decision substituted`, res.status, endpoint);
    const data = await res.json() as ApiVerificationResponse;
    return mapVerificationResponse(data, data.threshold === 3 ? '3-of-3' : '2-of-3');
  }

  public async evaluateRelease(
    releaseId: string,
    policyType: '2-of-3' | '3-of-3'
  ): Promise<VerificationResult> {
    const endpoint = `/releases/${encodeURIComponent(releaseId)}/evaluate`;
    const threshold = policyType === '3-of-3' ? 3 : 2;
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify({
        mode: policyType === '3-of-3' ? 'all' : 'k-of-n',
        threshold,
        expected_builders: 3,
        minimum_operators: threshold,
        reject_on_conflict: true,
      }),
    });
    if (!res.ok) throw new BackendError(`Status ${res.status}`, res.status, endpoint);
    const evaluation = await res.json() as Pick<ApiVerificationResponse,
      'status' | 'consensus_sha256' | 'candidate_sha256' | 'attestation_count' | 'rules'>;
    const currentResponse = await fetch(`${API_BASE}/releases/${encodeURIComponent(releaseId)}`);
    if (!currentResponse.ok) {
      throw new BackendError(`Status ${currentResponse.status}`, currentResponse.status, endpoint);
    }
    const current = await currentResponse.json() as ApiVerificationResponse;
    return mapVerificationResponse({ ...current, ...evaluation, threshold }, policyType);
  }

  public async getAudit(releaseId: string): Promise<AuditReport> {
    const endpoint = `/releases/${encodeURIComponent(releaseId)}/audit-report`;
    const res = await fetch(`${API_BASE}${endpoint}`);
    if (res.ok) return mapAuditReport(await res.json() as ApiAuditReportResponse);
    throw new BackendError(`Status ${res.status}; no mock evidence substituted`, res.status, endpoint);
  }

  public async getAuditEvents(releaseId: string): Promise<AuditEvent[]> {
    const res = await fetch(`${API_BASE}/releases/${encodeURIComponent(releaseId)}/audit-events`);
    if (!res.ok) throw new BackendError(`Status ${res.status}`, res.status, `/releases/${releaseId}/audit-events`);
    return (await res.json() as ApiAuditEvent[]).map(mapAuditEvent);
  }

  public async anchorRelease(releaseId: string): Promise<AuditReport> {
    const endpoint = `/releases/${encodeURIComponent(releaseId)}/anchor`;
    const res = await fetch(`${API_BASE}${endpoint}`, { method: 'POST', headers: this.adminHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { detail?: string };
      throw new BackendError(body.detail || `Status ${res.status}`, res.status, endpoint);
    }
    return mapAuditReport(await res.json() as ApiAuditReportResponse);
  }

  public async verifyConsumerArtifact(
    releaseId: string,
    artifactName: string,
    artifactSha256: string
  ): Promise<ConsumerArtifactVerification> {
    const backendReady = this.backendAvailable || await this.detectBackend();
    const endpoint = `/releases/${encodeURIComponent(releaseId)}/consumer-verifications`;
    if (!backendReady) {
      throw new BackendError(
        'The FastAPI verifier must be connected before a local artifact can be checked.',
        undefined,
        endpoint
      );
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artifact_name: artifactName,
        artifact_sha256: artifactSha256,
      }),
    });
    if (!res.ok) {
      throw new BackendError(`Status ${res.status}`, res.status, endpoint);
    }
    const data = await res.json() as ApiConsumerArtifactResponse;
    return {
      releaseId: data.release_id,
      artifactName: data.artifact_name,
      artifactSha256: data.artifact_sha256,
      consensusSha256: data.consensus_sha256,
      hashMatches: data.hash_matches,
      quorumStatus: data.quorum_status,
      decision: data.decision,
      reason: data.reason,
      verifiedAt: data.verified_at,
      auditChainHash: data.audit_chain_head,
    };
  }

  public async getSentinelFixtures(): Promise<FixtureItem[]> {
    const res = await fetch(`${API_BASE}/sentinel/fixtures`);
    if (!res.ok) throw new BackendError(`Status ${res.status}: Failed to fetch Sentinel fixtures`, res.status, '/sentinel/fixtures');
    return await res.json();
  }

  public async compareSource(req: CompareRequest): Promise<ComparisonResponse> {
    const headers = await this.requiredAdminHeaders(true);
    const res = await fetch(`${API_BASE}/sentinel/compare`, {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = errBody.detail || `Status ${res.status}: Comparison failed`;
      throw new BackendError(msg, res.status, '/sentinel/compare');
    }
    return await res.json();
  }

  public async getSentinelComparisons(limit = 50): Promise<ComparisonListItem[]> {
    const res = await fetch(`${API_BASE}/sentinel/comparisons?limit=${limit}`);
    if (!res.ok) throw new BackendError(`Status ${res.status}: Failed to fetch comparisons`, res.status, '/sentinel/comparisons');
    return await res.json();
  }

  public async getSentinelComparison(id: string): Promise<ComparisonResponse> {
    const res = await fetch(`${API_BASE}/sentinel/comparisons/${encodeURIComponent(id)}`);
    if (!res.ok) throw new BackendError(`Status ${res.status}: Failed to load comparison ${id}`, res.status, `/sentinel/comparisons/${id}`);
    return await res.json();
  }

  public async updateSentinelReview(id: string, req: ReviewRequest): Promise<ComparisonResponse> {
    const headers = await this.requiredAdminHeaders(true);
    const res = await fetch(`${API_BASE}/sentinel/comparisons/${encodeURIComponent(id)}/review`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = errBody.detail || `Status ${res.status}: Review update failed`;
      throw new BackendError(msg, res.status, `/sentinel/comparisons/${id}/review`);
    }
    return await res.json();
  }

  public async getRelayStats(): Promise<RelayStats> {
    const res = await fetch(`${API_BASE}/relay/stats`);
    if (!res.ok) throw new BackendError(`Status ${res.status}: Failed to fetch Relay stats`, res.status, '/relay/stats');
    return await res.json();
  }

  public async getEligibleVerifiedReleases(): Promise<VerifiedReleaseItem[]> {
    const res = await fetch(`${API_BASE}/relay/verified-releases`);
    if (!res.ok) throw new BackendError(`Status ${res.status}: Failed to fetch verified releases`, res.status, '/relay/verified-releases');
    return await res.json();
  }

  public async getGitHubReleaseInfo(repo: string, tag?: string): Promise<GitHubReleaseInfo> {
    const url = new URL(`${API_BASE}/relay/github-releases`);
    url.searchParams.set('repo', repo.trim());
    if (tag && tag.trim()) {
      url.searchParams.set('tag', tag.trim());
    }
    const res = await fetch(url.toString());
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = errBody.detail || `Status ${res.status}: Failed to fetch GitHub release information`;
      throw new BackendError(msg, res.status, '/relay/github-releases');
    }
    return await res.json();
  }

  public async getRelayMonitors(): Promise<ArtifactMonitor[]> {
    const res = await fetch(`${API_BASE}/relay/monitors`);
    if (!res.ok) throw new BackendError(`Status ${res.status}: Failed to fetch Relay monitors`, res.status, '/relay/monitors');
    return await res.json();
  }

  public async getRelayMonitor(id: string): Promise<ArtifactMonitor> {
    const res = await fetch(`${API_BASE}/relay/monitors/${encodeURIComponent(id)}`);
    if (!res.ok) throw new BackendError(`Status ${res.status}: Failed to fetch monitor ${id}`, res.status, `/relay/monitors/${id}`);
    return await res.json();
  }

  public async createRelayMonitor(req: CreateMonitorInput): Promise<ArtifactMonitor> {
    const headers = await this.requiredAdminHeaders(true);
    const res = await fetch(`${API_BASE}/relay/monitors`, {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = errBody.detail || `Status ${res.status}: Failed to register artifact monitor`;
      throw new BackendError(msg, res.status, '/relay/monitors');
    }
    return await res.json();
  }

  public async updateRelayMonitor(id: string, req: UpdateMonitorInput): Promise<ArtifactMonitor> {
    const headers = await this.requiredAdminHeaders(true);
    const res = await fetch(`${API_BASE}/relay/monitors/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = errBody.detail || `Status ${res.status}: Failed to update monitor`;
      throw new BackendError(msg, res.status, `/relay/monitors/${id}`);
    }
    return await res.json();
  }

  public async deleteRelayMonitor(id: string): Promise<{ deleted: boolean; id: string }> {
    const headers = await this.requiredAdminHeaders();
    const res = await fetch(`${API_BASE}/relay/monitors/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = errBody.detail || `Status ${res.status}: Failed to delete monitor`;
      throw new BackendError(msg, res.status, `/relay/monitors/${id}`);
    }
    return await res.json();
  }

  public async triggerRelayCheck(id: string): Promise<RelayCheck> {
    const headers = await this.requiredAdminHeaders();
    const res = await fetch(`${API_BASE}/relay/monitors/${encodeURIComponent(id)}/check`, {
      method: 'POST',
      headers,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = errBody.detail || `Status ${res.status}: Artifact check failed`;
      throw new BackendError(msg, res.status, `/relay/monitors/${id}/check`);
    }
    return await res.json();
  }

  public async getRelayMonitorHistory(id: string, limit = 50): Promise<RelayCheck[]> {
    const res = await fetch(`${API_BASE}/relay/monitors/${encodeURIComponent(id)}/history?limit=${limit}`);
    if (!res.ok) throw new BackendError(`Status ${res.status}: Failed to fetch monitor check history`, res.status, `/relay/monitors/${id}/history`);
    return await res.json();
  }

  public async getLivingStats(): Promise<LivingStats> {
    const res = await fetch(`${API_BASE}/living/stats`);
    if (!res.ok) throw new BackendError(`Status ${res.status}: Failed to load Living Verification`, res.status, '/living/stats');
    return await res.json();
  }

  public async getLivingBuilders(): Promise<LivingBuilder[]> {
    const res = await fetch(`${API_BASE}/living/builders`);
    if (!res.ok) throw new BackendError(`Status ${res.status}: Failed to load builder trust`, res.status, '/living/builders');
    return await res.json();
  }

  public async getLivingIncidents(): Promise<LivingIncident[]> {
    const res = await fetch(`${API_BASE}/living/incidents`);
    if (!res.ok) throw new BackendError(`Status ${res.status}: Failed to load incidents`, res.status, '/living/incidents');
    return await res.json();
  }

  public async getLivingReleases(): Promise<LivingAssessment[]> {
    const res = await fetch(`${API_BASE}/living/releases`);
    if (!res.ok) throw new BackendError(`Status ${res.status}: Failed to load release assessments`, res.status, '/living/releases');
    return await res.json();
  }

  public async createLivingIncident(input: CreateLivingIncident): Promise<LivingIncidentResult> {
    const headers = await this.requiredAdminHeaders(true);
    const res = await fetch(`${API_BASE}/living/incidents`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new BackendError(body.detail || `Status ${res.status}: Incident rejected`, res.status, '/living/incidents');
    }
    return await res.json();
  }

  public async reevaluateLivingReleases(): Promise<{ reevaluated: number; trust_degraded: number; assessments: LivingAssessment[] }> {
    const headers = await this.requiredAdminHeaders();
    const res = await fetch(`${API_BASE}/living/re-evaluate`, { method: 'POST', headers });
    if (!res.ok) throw new BackendError(`Status ${res.status}: Re-evaluation failed`, res.status, '/living/re-evaluate');
    return await res.json();
  }

  public async repairLivingIncidentChain(): Promise<{ repaired: boolean; message: string }> {
    const headers = await this.requiredAdminHeaders();
    const res = await fetch(`${API_BASE}/living/repair-chain`, { method: 'POST', headers });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new BackendError(body.detail || `Status ${res.status}: Chain recovery failed`, res.status, '/living/repair-chain');
    return body;
  }

  public async establishRelayBaseline(id: string, req: EstablishBaselineInput): Promise<ArtifactMonitor> {
    const headers = await this.requiredAdminHeaders(true);
    const res = await fetch(`${API_BASE}/relay/monitors/${encodeURIComponent(id)}/baseline`, {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = errBody.detail || `Status ${res.status}: Failed to establish trusted baseline`;
      throw new BackendError(msg, res.status, `/relay/monitors/${id}/baseline`);
    }
    return await res.json();
  }

  public async getRelayBaselineHistory(id: string): Promise<RelayBaselineEvent[]> {
    const res = await fetch(`${API_BASE}/relay/monitors/${encodeURIComponent(id)}/baseline-history`);
    if (!res.ok) throw new BackendError(`Status ${res.status}: Failed to fetch monitor baseline history`, res.status, `/relay/monitors/${id}/baseline-history`);
    return await res.json();
  }
}

export const api = new QuorumApiService();
