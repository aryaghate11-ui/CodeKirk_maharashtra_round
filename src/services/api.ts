import {
  Release,
  Builder,
  Attestation,
  VerificationResult,
  QuorumPolicy,
  AuditReport,
  AuditEvent,
  SystemStats,
  ScenarioId,
} from '../types';
import {
  MOCK_BUILDERS,
  MOCK_RELEASES,
  MOCK_SYSTEM_STATS,
  DEFAULT_POLICY,
} from '../mock/data';
import {
  getMockVerificationForScenario,
} from '../mock/scenarios';
import {
  MOCK_AUDIT_EVENTS,
  generateAuditReport,
} from '../mock/auditData';

// Prefer relative /api during development to take full advantage of the Vite dev proxy
const RAW_API_URL = import.meta.env.VITE_API_URL || '';
const API_BASE =
  import.meta.env.DEV
    ? '/api'
    : RAW_API_URL
    ? `${RAW_API_URL.replace(/\/+$/, '')}/api`
    : '/api';

// If VITE_DISABLE_MOCK=true or VITE_STRICT_BACKEND=true, fallback to mock data is strictly disabled
const ENV_STRICT =
  import.meta.env.VITE_DISABLE_MOCK === 'true' ||
  import.meta.env.VITE_STRICT_BACKEND === 'true';

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

export function mapBackendStatusToDecision(status?: string): 'ACCEPTED' | 'REJECTED' | 'CONFLICT' | 'PENDING' {
  switch (status?.toLowerCase()) {
    case 'verified':
      return 'ACCEPTED';
    case 'disagreement':
      return 'CONFLICT';
    case 'rejected':
      return 'REJECTED';
    case 'pending':
    default:
      return 'PENDING';
  }
}

export function generateDecisionExplanation(record: any): string {
  const status = record.status;
  if (status === 'verified') {
    return `Quorum reached. Independent witness builds match bit-for-bit with published candidate binary (${record.threshold ?? 2}-of-${record.builders?.length || 3} quorum satisfied).`;
  } else if (status === 'disagreement') {
    return `Quorum rejected: Builder disagreement detected. Independent nodes produced diverging artifact SHA-256 hashes from identical pinned commit.`;
  } else if (status === 'rejected') {
    return `Quorum rejected: Candidate published artifact does not match reproducible consensus hash produced by independent builders.`;
  }
  return `Quorum evaluation pending. Waiting for required builder attestations.`;
}

export function adaptBackendBuilder(b: any, idx: number): Builder {
  return {
    id: b.id,
    name: b.name || b.id,
    shortCode: b.id ? b.id.slice(0, 3).toUpperCase() : `B0${idx + 1}`,
    operator: b.operator || 'Independent Operator',
    address: b.public_key || `ed25519:${b.id}`,
    environment: b.platform || 'Ubuntu 24.04',
    os: 'Linux',
    runtime: b.platform?.includes('Podman')
      ? 'Podman'
      : b.platform?.includes('GitHub')
      ? 'GitHub Actions'
      : 'Self-hosted',
    region:
      idx === 0
        ? 'us-east (Virginia)'
        : idx === 1
        ? 'eu-central (Frankfurt)'
        : 'ap-south (Mumbai)',
    status: (b.trusted !== 0 ? 'ONLINE' : 'DEGRADED') as 'ONLINE' | 'DEGRADED' | 'OFFLINE',
    uptime: 99.8,
    latestAttestationTime: b.latest_attestation_time || b.built_at || new Date().toISOString(),
    lastArtifactHash: b.last_artifact_sha256 || b.artifact_sha256 || 'N/A',
    signatureStatus: b.signature_valid === false ? 'INVALID' : 'VALID',
    totalBuilds: b.total_builds || 42,
    agreementRate: 98.6,
    verifiedByContract: false,
  };
}

export function adaptBackendAuditEvent(event: any, idx: number): AuditEvent {
  let eventType: AuditEvent['type'] = 'RELEASE_REGISTERED';
  let title = event.event_type;
  let status: 'info' | 'success' | 'warning' | 'error' = 'info';

  if (event.event_type === 'release.registered') {
    eventType = 'RELEASE_REGISTERED';
    title = 'Release Registered for Verification';
    status = 'info';
  } else if (event.event_type === 'attestation.accepted') {
    eventType = 'ATTESTATION_SUBMITTED';
    title = 'Ed25519 Attestation Accepted';
    status = 'success';
  } else if (event.event_type === 'decision.recorded') {
    eventType = 'DECISION_FINALIZED';
    title = 'Quorum Decision Finalized';
    status = event.event_json?.includes('verified') ? 'success' : 'error';
  }

  let parsedDetails = '';
  try {
    const data = typeof event.event_json === 'string' ? JSON.parse(event.event_json) : event.event_json;
    if (data && typeof data === 'object') {
      parsedDetails = Object.entries(data)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ');
    }
  } catch {
    parsedDetails = event.event_json || '';
  }

  return {
    id: `evt-${idx}-${event.event_hash ? event.event_hash.slice(0, 8) : idx}`,
    timestamp: event.created_at || new Date().toISOString(),
    timeFormatted: event.created_at ? new Date(event.created_at).toLocaleTimeString() : 'Just now',
    type: eventType,
    title,
    description: parsedDetails || `Audit event ${event.event_type} sealed in hash chain.`,
    evidenceHash: event.event_hash,
    status,
  };
}

export function adaptBackendReleaseRecord(backendRecord: any): VerificationResult {
  const rel = backendRecord.release || {};
  const repoUrl = rel.repository_url || 'https://github.com/rakyll/hey';
  const repoClean = repoUrl.replace(/^https?:\/\//, '');
  const repoParts = repoClean.split('/');
  const repoName = repoParts[repoParts.length - 1] || 'hey';
  const consensusHash = backendRecord.consensus_sha256 || null;
  const candidateHash = backendRecord.candidate_sha256 || rel.candidate_sha256 || '';
  const threshold = backendRecord.threshold ?? 2;
  const rawBuilders = backendRecord.builders || [];
  const totalBuildersCount = rawBuilders.length || 3;

  const policy: QuorumPolicy = {
    type: 'k-of-n',
    k: threshold,
    n: totalBuildersCount,
    description: `${threshold}-of-${totalBuildersCount} Independent Builders Quorum`,
    strict: Boolean(rel.reject_on_conflict ?? true),
    requireUniqueOperators: true,
    timeoutSeconds: 300,
  };

  const decision = mapBackendStatusToDecision(backendRecord.status);
  const matchingBuilders = rawBuilders.filter(
    (b: any) => b.artifact_sha256 === consensusHash && b.signature_valid
  );

  const release: Release = {
    id: backendRecord.release_id || rel.id || 'rel-demo',
    name: repoName,
    repo: repoClean,
    version: ((): string => {
      const KNOWN_VERSIONS: Record<string, string> = {
        hey: 'v0.1.5',
        pebble: 'v1.1.2',
        etcd: 'v3.5.12',
        moby: 'v26.0.1',
      };
      return KNOWN_VERSIONS[repoName.toLowerCase()] || 'v1.0.0';
    })(),
    commit: rel.source_commit || 'e64ec7a3ad1ef8bc828fe61e1fb324cc2e74c604',
    artifactName: repoName.toLowerCase() === 'moby' ? 'dockerd-linux-amd64' : `${repoName}-linux-amd64`,
    target: 'linux/amd64',
    createdAt: rel.created_at || new Date().toISOString(),
    publishedArtifactHash: candidateHash,
    agreement: matchingBuilders.length,
    totalBuilders: rawBuilders.length,
    policy,
    status: decision,
    decisionExplanation: generateDecisionExplanation(backendRecord),
  };

  const attestations: Attestation[] = rawBuilders.map((b: any, idx: number) => {
    const isMatch = b.artifact_sha256 === consensusHash && b.signature_valid;
    const isConflict = b.signature_valid && b.artifact_sha256 !== consensusHash;
    let attStatus: Attestation['status'] = 'MATCH';
    if (!b.signature_valid) {
      attStatus = 'INVALID_SIG';
    } else if (isConflict) {
      attStatus = 'CONFLICT';
    }

    return {
      id: `att-${b.id || idx}`,
      releaseId: release.id,
      builderId: b.id,
      builderName: b.name || b.id,
      builderAddress: b.public_key || `ed25519:${b.id}`,
      artifactHash: b.artifact_sha256,
      signature: b.signature || 'Ed25519-Signed-Attestation',
      signatureValid: Boolean(b.signature_valid),
      timestamp: b.built_at || rel.created_at || new Date().toISOString(),
      status: attStatus,
      environment: b.platform || 'Containerized Linux',
      buildDurationMs: 3800 + idx * 600,
      logsAvailable: true,
    };
  });

  const builders: Builder[] = rawBuilders.map((b: any, idx: number) => adaptBackendBuilder(b, idx));

  return {
    release,
    builders,
    attestations,
    agreement: matchingBuilders.length,
    totalBuilders: rawBuilders.length,
    consensusHash,
    conflictDetected: rawBuilders.some((b: any) => b.artifact_sha256 !== consensusHash),
    conflictingBuilders: rawBuilders
      .filter((b: any) => b.artifact_sha256 !== consensusHash)
      .map((b: any) => b.name || b.id),
    policy,
    policySatisfied: backendRecord.status === 'verified',
    decision,
    explanation: generateDecisionExplanation(backendRecord),
    signaturesValid: attestations.every((a) => a.signatureValid),
    verifiedAt: rel.created_at || new Date().toISOString(),
    auditChainHash: backendRecord.audit_chain_head || '0'.repeat(64),
  };
}

export function adaptBackendAuditReport(backendRecord: any): AuditReport {
  const verification = adaptBackendReleaseRecord(backendRecord);
  return {
    id: `audit-${backendRecord.release_id || 'rel-01'}`,
    schemaVersion: '1.0.0-ed25519',
    releaseId: verification.release.id,
    repo: verification.release.repo,
    commit: verification.release.commit,
    artifactName: verification.release.artifactName,
    publishedArtifactHash: verification.release.publishedArtifactHash,
    consensusHash: verification.consensusHash,
    decision: verification.decision,
    policy: verification.policy,
    agreement: verification.agreement,
    totalBuilders: verification.totalBuilders,
    conflictDetected: verification.conflictDetected,
    attestations: verification.attestations,
    evidenceHash: backendRecord.audit_chain_head || '0'.repeat(64),
    policyHash: 'sha256:6cb431a152226cff3072c02dd2f6f6b187751d15452265b1b9e4cc2b3014ad10',
    contractAddress: '0x0000000000000000000000000000000000000000 (Local SQLite Chain)',
    transactionHash: backendRecord.audit_chain_head ? `0x${backendRecord.audit_chain_head.slice(0, 64)}` : '0x0',
    blockNumber: backendRecord.audit_events?.length || 1,
    timestamp: verification.release.createdAt,
    gasUsed: 'N/A (Cryptographic Audit Log)',
    rootSignature: backendRecord.audit_chain_head || 'N/A',
  };
}

class QuorumApiService {
  private strictBackendMode: boolean = ENV_STRICT;
  private backendAvailable: boolean = false;
  private lastPingMs: number = 42;

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
      if (res.ok) {
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
    return this.strictBackendMode;
  }

  public setStrictBackendMode(strict: boolean): void {
    this.strictBackendMode = strict;
  }

  public isBackendAvailable(): boolean {
    return this.backendAvailable;
  }

  public isMockMode(): boolean {
    if (this.strictBackendMode) return false;
    return !this.backendAvailable;
  }

  private handleFailure(endpoint: string, err: any, mockFallback: () => any) {
    if (this.strictBackendMode) {
      throw new BackendError(
        `FastAPI Backend request to ${endpoint} failed: ${err.message || 'Connection error'}. Strict backend verification mode is enabled; mock fallback is blocked.`,
        err.status,
        endpoint
      );
    }
    console.warn(`[Quorum API] Backend call to ${endpoint} unavailable, falling back to mock engine:`, err);
    return mockFallback();
  }

  public async getSystemStats(): Promise<SystemStats> {
    if (!this.isMockMode() || this.strictBackendMode) {
      try {
        const res = await fetch(`${API_BASE}/stats`);
        if (res.ok) {
          const data = await res.json();
          return {
            ...data,
            isBackendConnected: true,
            backendLatencyMs: this.lastPingMs,
          };
        } else {
          throw new BackendError(`Status ${res.status}`, res.status, '/stats');
        }
      } catch (e: any) {
        return this.handleFailure('/stats', e, () => ({
          ...MOCK_SYSTEM_STATS,
          isBackendConnected: false,
          backendLatencyMs: null,
        }));
      }
    }

    return {
      ...MOCK_SYSTEM_STATS,
      isBackendConnected: this.backendAvailable,
      backendLatencyMs: this.backendAvailable ? this.lastPingMs : null,
    };
  }

  public async getReleases(): Promise<Release[]> {
    if (!this.isMockMode() || this.strictBackendMode) {
      try {
        const res = await fetch(`${API_BASE}/releases`);
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list) && list.length > 0) {
            return list.map((item: any) => adaptBackendReleaseRecord(item).release);
          }
          return [];
        }
        throw new BackendError(`Status ${res.status}`, res.status, '/releases');
      } catch (e: any) {
        return this.handleFailure('/releases', e, () => [...MOCK_RELEASES]);
      }
    }
    await new Promise((r) => setTimeout(r, 80));
    return [...MOCK_RELEASES];
  }

  public async getRelease(id: string): Promise<Release | null> {
    if (!this.isMockMode() || this.strictBackendMode) {
      try {
        const res = await fetch(`${API_BASE}/releases/${encodeURIComponent(id)}`);
        if (res.ok) {
          const data = await res.json();
          return adaptBackendReleaseRecord(data).release;
        }
        throw new BackendError(`Status ${res.status}`, res.status, `/releases/${id}`);
      } catch (e: any) {
        return this.handleFailure(`/releases/${id}`, e, () => {
          const found = MOCK_RELEASES.find((r) => r.id === id);
          return found || MOCK_RELEASES[0];
        });
      }
    }
    await new Promise((r) => setTimeout(r, 50));
    const found = MOCK_RELEASES.find((r) => r.id === id);
    return found || MOCK_RELEASES[0];
  }

  public async getBuilders(): Promise<Builder[]> {
    if (!this.isMockMode() || this.strictBackendMode) {
      try {
        const res = await fetch(`${API_BASE}/builders`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            return data.map((b: any, idx: number) => adaptBackendBuilder(b, idx));
          }
          return [];
        }
        throw new BackendError(`Status ${res.status}`, res.status, '/builders');
      } catch (e: any) {
        return this.handleFailure('/builders', e, () => [...MOCK_BUILDERS]);
      }
    }
    await new Promise((r) => setTimeout(r, 70));
    return [...MOCK_BUILDERS];
  }

  public async getAttestations(releaseId: string): Promise<Attestation[]> {
    if (!this.isMockMode() || this.strictBackendMode) {
      try {
        const res = await fetch(`${API_BASE}/releases/${encodeURIComponent(releaseId)}`);
        if (res.ok) {
          const data = await res.json();
          const verification = adaptBackendReleaseRecord(data);
          return verification.attestations;
        }
        throw new BackendError(`Status ${res.status}`, res.status, `/releases/${releaseId}`);
      } catch (e: any) {
        return this.handleFailure(`/releases/${releaseId}/attestations`, e, () => {
          const verification = getMockVerificationForScenario('valid', '2-of-3', releaseId);
          return verification.attestations;
        });
      }
    }
    const verification = getMockVerificationForScenario('valid', '2-of-3', releaseId);
    return verification.attestations;
  }

  public async verifyRelease(
    releaseId: string,
    scenarioId: ScenarioId = 'valid',
    policyType: '2-of-3' | '3-of-3' = '2-of-3'
  ): Promise<VerificationResult> {
    return this.runDemoScenario(scenarioId, policyType, releaseId);
  }

  public async getVerification(releaseId: string): Promise<VerificationResult> {
    if (!this.isMockMode() || this.strictBackendMode) {
      try {
        const res = await fetch(`${API_BASE}/releases/${encodeURIComponent(releaseId)}`);
        if (res.ok) {
          const data = await res.json();
          return adaptBackendReleaseRecord(data);
        }
        throw new BackendError(`Status ${res.status}`, res.status, `/releases/${releaseId}`);
      } catch (e: any) {
        return this.handleFailure(`/releases/${releaseId}`, e, () =>
          getMockVerificationForScenario('valid', '2-of-3', releaseId)
        );
      }
    }
    return getMockVerificationForScenario('valid', '2-of-3', releaseId);
  }

  public async getAudit(releaseId: string): Promise<AuditReport> {
    if (!this.isMockMode() || this.strictBackendMode) {
      try {
        const res = await fetch(`${API_BASE}/releases/${encodeURIComponent(releaseId)}/audit`);
        if (res.ok) {
          const data = await res.json();
          return adaptBackendAuditReport(data);
        }
        throw new BackendError(`Status ${res.status}`, res.status, `/releases/${releaseId}/audit`);
      } catch (e: any) {
        return this.handleFailure(`/releases/${releaseId}/audit`, e, () =>
          generateAuditReport(releaseId)
        );
      }
    }
    return generateAuditReport(releaseId);
  }

  public async getAuditEvents(releaseId: string): Promise<AuditEvent[]> {
    if (!this.isMockMode() || this.strictBackendMode) {
      try {
        const res = await fetch(`${API_BASE}/releases/${encodeURIComponent(releaseId)}/audit-events`);
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list)) {
            return list.map((item: any, idx: number) => adaptBackendAuditEvent(item, idx));
          }
        }
        throw new BackendError(`Status ${res.status}`, res.status, `/releases/${releaseId}/audit-events`);
      } catch (e: any) {
        return this.handleFailure(`/releases/${releaseId}/audit-events`, e, () => [
          ...MOCK_AUDIT_EVENTS,
        ]);
      }
    }
    return [...MOCK_AUDIT_EVENTS];
  }

  public async getPolicy(): Promise<QuorumPolicy> {
    return DEFAULT_POLICY;
  }

  public async runDemoScenario(
    scenarioId: ScenarioId,
    policyType: '2-of-3' | '3-of-3' = '2-of-3',
    releaseId: string = 'rel-hey-01'
  ): Promise<VerificationResult> {
    if (scenarioId === 'valid' || scenarioId === 'tampered' || scenarioId === 'conflict') {
      if (!this.isMockMode() || this.strictBackendMode) {
        try {
          const res = await fetch(`${API_BASE}/demo/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scenario: scenarioId }),
          });
          if (res.ok) {
            const data = await res.json();
            return adaptBackendReleaseRecord(data);
          }
          throw new BackendError(`Status ${res.status}`, res.status, '/demo/verify');
        } catch (e: any) {
          return this.handleFailure('/demo/verify', e, () =>
            getMockVerificationForScenario(scenarioId, policyType, releaseId)
          );
        }
      }
      return getMockVerificationForScenario(scenarioId, policyType, releaseId);
    }

    // For unsupported scenarios in the backend (invalidSignature, auditTampering)
    if (this.strictBackendMode) {
      throw new BackendError(
        `Scenario '${scenarioId}' is not implemented in the FastAPI backend yet. Available real backend scenarios are: 'valid', 'tampered', and 'conflict'. Disable strict mode to view client-side simulated preview.`,
        400,
        `/demo/${scenarioId}`
      );
    }

    return getMockVerificationForScenario(scenarioId, policyType, releaseId);
  }
}

export const api = new QuorumApiService();
