/**
 * Quorum Relay (USP 2) TypeScript interfaces and types.
 * Post-verification independent artifact integrity monitoring and witness checking.
 */

export type CheckResult = 'MATCH' | 'MISMATCH' | 'ERROR';

export type MonitorStatus = 'MATCH' | 'MISMATCH' | 'ERROR' | 'PENDING';

export type ProvenanceType = 'VERIFIED_RELEASE_CONSENSUS' | 'MANUAL_UNVERIFIED';

export type BaselineResult = 'MATCH' | 'CHANGED' | 'NOT_ESTABLISHED' | 'ERROR';

export type BaselineStatus = 'MATCH' | 'CHANGED' | 'NOT_ESTABLISHED' | 'ERROR' | 'PENDING';

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
  trusted_baseline_sha256: string | null;
  baseline_established_at: string | null;
  baseline_approved_by: string | null;
  baseline_approval_notes: string | null;
  previous_baseline_sha256: string | null;
  last_baseline_result: BaselineStatus;
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
  trusted_baseline_sha256: string | null;
  baseline_result: BaselineResult | null;
  baseline_change_detected: boolean;
}

export interface RelayStats {
  total_monitors: number;
  active_monitors: number;
  total_checks: number;
  matches_count: number;
  mismatches_count: number;
  errors_count: number;
  baselines_established_count?: number;
  baseline_changes_count?: number;
  latest_check: RelayCheck | null;
}

export interface EstablishBaselineInput {
  baseline_sha256: string;
  approved_by?: string;
  notes?: string;
}

export interface RelayBaselineEvent {
  id: string;
  monitor_id: string;
  event_type: 'BASELINE_ESTABLISHED' | 'BASELINE_UPDATED' | 'BASELINE_DIVERGENCE';
  previous_baseline_sha256: string | null;
  trusted_baseline_sha256: string | null;
  observed_sha256: string | null;
  artifact_url: string;
  approved_by: string | null;
  notes: string | null;
  created_at: string;
}

export interface VerifiedReleaseItem {
  release_id: string;
  artifact_name: string;
  repository_url: string;
  source_commit: string;
  consensus_sha256: string;
  threshold?: number;
  expected_builders?: number;
  attestation_count?: number;
  created_at: string;
}

export interface GitHubReleaseAsset {
  name: string;
  download_url: string;
  size_bytes: number;
  content_type: string | null;
  expected_sha256: string | null;
  hash_source: string | null;
  is_manifest: boolean;
}

export interface GitHubReleaseInfo {
  repository: string;
  tag_name: string;
  release_name: string;
  published_at: string | null;
  html_url: string;
  manifest_found: boolean;
  manifest_name: string | null;
  manifest_url: string | null;
  manifest_signed: boolean;
  signature_asset_name: string | null;
  assets: GitHubReleaseAsset[];
  provenance_note: string;
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
