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

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
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
        if (res.ok) return await res.json();
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
        if (res.ok) return await res.json();
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
        if (res.ok) return await res.json();
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
        const res = await fetch(`${API_BASE}/releases/${encodeURIComponent(releaseId)}/attestations`);
        if (res.ok) return await res.json();
        throw new BackendError(`Status ${res.status}`, res.status, `/releases/${releaseId}/attestations`);
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
    if (!this.isMockMode() || this.strictBackendMode) {
      try {
        const res = await fetch(`${API_BASE}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ releaseId, scenarioId, policyType }),
        });
        if (res.ok) return await res.json();
        throw new BackendError(`Status ${res.status}`, res.status, '/verify');
      } catch (e: any) {
        return this.handleFailure('/verify', e, () =>
          getMockVerificationForScenario(scenarioId, policyType, releaseId)
        );
      }
    }

    return getMockVerificationForScenario(scenarioId, policyType, releaseId);
  }

  public async getVerification(releaseId: string): Promise<VerificationResult> {
    if (!this.isMockMode() || this.strictBackendMode) {
      try {
        const res = await fetch(`${API_BASE}/releases/${encodeURIComponent(releaseId)}/verification`);
        if (res.ok) return await res.json();
        throw new BackendError(`Status ${res.status}`, res.status, `/releases/${releaseId}/verification`);
      } catch (e: any) {
        return this.handleFailure(`/releases/${releaseId}/verification`, e, () =>
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
        if (res.ok) return await res.json();
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
        if (res.ok) return await res.json();
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
    if (!this.isMockMode() || this.strictBackendMode) {
      try {
        const res = await fetch(`${API_BASE}/policy`);
        if (res.ok) return await res.json();
        throw new BackendError(`Status ${res.status}`, res.status, '/policy');
      } catch (e: any) {
        return this.handleFailure('/policy', e, () => DEFAULT_POLICY);
      }
    }
    return DEFAULT_POLICY;
  }

  public async runDemoScenario(
    scenarioId: ScenarioId,
    policyType: '2-of-3' | '3-of-3' = '2-of-3',
    releaseId: string = 'rel-hey-01'
  ): Promise<VerificationResult> {
    if (!this.isMockMode() || this.strictBackendMode) {
      try {
        const res = await fetch(
          `${API_BASE}/demo/${encodeURIComponent(scenarioId)}?policy=${policyType}&releaseId=${encodeURIComponent(releaseId)}`,
          {
            method: 'POST',
          }
        );
        if (res.ok) return await res.json();
        throw new BackendError(`Status ${res.status}`, res.status, `/demo/${scenarioId}`);
      } catch (e: any) {
        return this.handleFailure(`/demo/${scenarioId}`, e, () =>
          getMockVerificationForScenario(scenarioId, policyType, releaseId)
        );
      }
    }

    return getMockVerificationForScenario(scenarioId, policyType, releaseId);
  }
}

export const api = new QuorumApiService();
