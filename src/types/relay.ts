/**
 * Quorum Relay (USP 2) TypeScript interfaces and types.
 * Post-verification independent artifact integrity monitoring and witness checking.
 */

export type CheckResult = 'MATCH' | 'MISMATCH' | 'ERROR';

export type MonitorStatus = 'MATCH' | 'MISMATCH' | 'ERROR' | 'PENDING';

export type ProvenanceType = 'VERIFIED_RELEASE_CONSENSUS' | 'MANUAL_UNVERIFIED';

export interface ArtifactMonitor {
  id: string;
  name: string;
  artifact_url: string;
  expected_sha256: string;
  release_id: string | null;
  release_name: string | null;
  provenance: ProvenanceType;
  description: string | null;
  enabled: boolean;
  check_interval_seconds: number;
  created_at: string;
  last_checked_at: string | null;
  last_result: MonitorStatus;
  last_observed_sha256: string | null;
  last_error_summary: string | null;
  next_check_at: string | null;
  total_checks_count: number;
}

export interface RelayCheck {
  id: string;
  monitor_id: string;
  result: CheckResult;
  expected_sha256: string;
  observed_sha256: string | null;
  bytes_downloaded: number | null;
  http_status: number | null;
  response_time_ms: number;
  error_summary: string | null;
  checked_at: string;
}

export interface RelayStats {
  total_monitors: number;
  active_monitors: number;
  total_checks: number;
  matches_count: number;
  mismatches_count: number;
  errors_count: number;
  latest_check: RelayCheck | null;
}

export interface VerifiedReleaseItem {
  release_id: string;
  artifact_name: string;
  repository_url: string;
  source_commit: string;
  consensus_sha256: string;
  created_at: string;
}

export interface CreateMonitorInput {
  name: string;
  artifact_url: string;
  expected_sha256?: string;
  release_id?: string;
  description?: string;
  check_interval_seconds?: number;
}

export interface UpdateMonitorInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  check_interval_seconds?: number;
}
