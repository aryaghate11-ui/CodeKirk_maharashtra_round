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

class QuorumApiService {
  private useMockMode: boolean = true;
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

  public isMockMode(): boolean {
    return this.useMockMode || !this.backendAvailable;
  }

  public setMockMode(forceMock: boolean): void {
    this.useMockMode = forceMock;
  }

  public async getSystemStats(): Promise<SystemStats> {
    if (!this.isMockMode()) {
      try {
        const res = await fetch(`${API_BASE}/stats`);
        if (res.ok) {
          const data = await res.json();
          return {
            ...data,
            isBackendConnected: true,
            backendLatencyMs: this.lastPingMs,
          };
        }
      } catch (e) {
        console.warn('Backend /stats failed, falling back to mock service', e);
      }
    }

    return {
      ...MOCK_SYSTEM_STATS,
      isBackendConnected: this.backendAvailable && !this.useMockMode,
      backendLatencyMs: this.backendAvailable ? this.lastPingMs : null,
    };
  }

  public async getReleases(): Promise<Release[]> {
    if (!this.isMockMode()) {
      try {
        const res = await fetch(`${API_BASE}/releases`);
        if (res.ok) return await res.json();
      } catch (e) {
        console.warn('Backend /releases failed, falling back to mock data', e);
      }
    }
    // Simulate slight async network delay
    await new Promise((r) => setTimeout(r, 120));
    return [...MOCK_RELEASES];
  }

  public async getRelease(id: string): Promise<Release | null> {
    if (!this.isMockMode()) {
      try {
        const res = await fetch(`${API_BASE}/releases/${encodeURIComponent(id)}`);
        if (res.ok) return await res.json();
      } catch (e) {
        console.warn(`Backend /releases/${id} failed, falling back to mock`, e);
      }
    }
    await new Promise((r) => setTimeout(r, 80));
    const found = MOCK_RELEASES.find((r) => r.id === id);
    return found || MOCK_RELEASES[0];
  }

  public async getBuilders(): Promise<Builder[]> {
    if (!this.isMockMode()) {
      try {
        const res = await fetch(`${API_BASE}/builders`);
        if (res.ok) return await res.json();
      } catch (e) {
        console.warn('Backend /builders failed, falling back to mock data', e);
      }
    }
    await new Promise((r) => setTimeout(r, 100));
    return [...MOCK_BUILDERS];
  }

  public async getAttestations(releaseId: string): Promise<Attestation[]> {
    if (!this.isMockMode()) {
      try {
        const res = await fetch(`${API_BASE}/releases/${encodeURIComponent(releaseId)}/attestations`);
        if (res.ok) return await res.json();
      } catch (e) {
        console.warn('Backend /attestations failed, falling back to mock', e);
      }
    }
    const verification = getMockVerificationForScenario('valid');
    return verification.attestations;
  }

  public async verifyRelease(
    releaseId: string,
    scenarioId: ScenarioId = 'valid',
    policyType: '2-of-3' | '3-of-3' = '2-of-3'
  ): Promise<VerificationResult> {
    if (!this.isMockMode()) {
      try {
        const res = await fetch(`${API_BASE}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ releaseId, policyType }),
        });
        if (res.ok) return await res.json();
      } catch (e) {
        console.warn('Backend /verify failed, falling back to mock verification', e);
      }
    }

    // Return the corresponding mock verification computed result
    return getMockVerificationForScenario(scenarioId, policyType);
  }

  public async getVerification(releaseId: string): Promise<VerificationResult> {
    if (!this.isMockMode()) {
      try {
        const res = await fetch(`${API_BASE}/releases/${encodeURIComponent(releaseId)}/verification`);
        if (res.ok) return await res.json();
      } catch (e) {
        console.warn('Backend /verification failed, falling back to mock', e);
      }
    }
    return getMockVerificationForScenario('valid');
  }

  public async getAudit(releaseId: string): Promise<AuditReport> {
    if (!this.isMockMode()) {
      try {
        const res = await fetch(`${API_BASE}/releases/${encodeURIComponent(releaseId)}/audit`);
        if (res.ok) return await res.json();
      } catch (e) {
        console.warn('Backend /audit failed, falling back to mock', e);
      }
    }
    return generateAuditReport(releaseId);
  }

  public async getAuditEvents(releaseId: string): Promise<AuditEvent[]> {
    if (!this.isMockMode()) {
      try {
        const res = await fetch(`${API_BASE}/releases/${encodeURIComponent(releaseId)}/audit-events`);
        if (res.ok) return await res.json();
      } catch (e) {
        console.warn('Backend /audit-events failed, falling back to mock', e);
      }
    }
    return [...MOCK_AUDIT_EVENTS];
  }

  public async getPolicy(): Promise<QuorumPolicy> {
    if (!this.isMockMode()) {
      try {
        const res = await fetch(`${API_BASE}/policy`);
        if (res.ok) return await res.json();
      } catch (e) {
        console.warn('Backend /policy failed, falling back to mock', e);
      }
    }
    return DEFAULT_POLICY;
  }

  public async runDemoScenario(
    scenarioId: ScenarioId,
    policyType: '2-of-3' | '3-of-3' = '2-of-3'
  ): Promise<VerificationResult> {
    if (!this.isMockMode()) {
      try {
        const res = await fetch(`${API_BASE}/demo/${encodeURIComponent(scenarioId)}?policy=${policyType}`, {
          method: 'POST',
        });
        if (res.ok) return await res.json();
      } catch (e) {
        console.warn('Backend /demo failed, falling back to mock scenario runner', e);
      }
    }

    return getMockVerificationForScenario(scenarioId, policyType);
  }
}

export const api = new QuorumApiService();
