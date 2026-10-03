export type ApiVerificationStatus =
  | 'verified'
  | 'rejected'
  | 'disagreement'
  | 'pending';

export interface ApiVerificationRules {
  signatures: boolean;
  matches: boolean;
  operators: boolean;
  candidate: boolean;
  conflicts: boolean;
}

export interface ApiBuilderEvidence {
  id: string;
  name: string;
  operator: string;
  platform: string;
  artifact_sha256: string;
  signature_valid: boolean;
  built_at: string;
  environment: string;
  attestation_schema: string;
  signing_key_fingerprint: string;
  signature: string;
  signed_payload: Record<string, string>;
  evidence_digest: string;
}

export interface ApiReleaseRecord {
  id: string;
  repository_url: string;
  source_commit: string;
  artifact_name: string;
  recipe_sha256: string;
  candidate_sha256: string;
  threshold: number;
  expected_builders: number;
  reject_on_conflict: boolean;
  status: ApiVerificationStatus;
  consensus_sha256: string | null;
  created_at: string;
}

export interface ApiBuilderRegistryResponse {
  id: string;
  name: string;
  operator: string;
  platform: string;
  signing_key_fingerprint: string;
  trusted: boolean;
  created_at: string;
  latest_artifact_sha256: string | null;
  latest_attestation_at: string | null;
  total_builds: number;
  agreement_rate: number;
}

export interface ApiAuditEvent {
  event_type: string;
  event_json: string;
  previous_hash: string;
  event_hash: string;
  created_at: string;
}

export interface ApiVerificationResponse {
  schema_version: 'quorum.api.v1';
  release_id: string;
  status: ApiVerificationStatus;
  consensus_sha256: string | null;
  candidate_sha256: string;
  attestation_count: number;
  threshold: number;
  rules: ApiVerificationRules;
  builders: ApiBuilderEvidence[];
  audit_chain_head: string | null;
  release: ApiReleaseRecord;
  audit_events: ApiAuditEvent[];
}

export interface ApiConsumerArtifactResponse {
  schema_version: 'quorum.api.v1';
  release_id: string;
  artifact_name: string;
  artifact_sha256: string;
  consensus_sha256: string | null;
  hash_matches: boolean;
  quorum_status: ApiVerificationStatus;
  decision: 'accepted' | 'rejected' | 'conflict' | 'pending';
  reason: string;
  verified_at: string;
  audit_chain_head: string | null;
}

export interface ApiSystemStatsResponse {
  releases_verified: number;
  releases_rejected: number;
  conflicts_detected: number;
  active_builders: number;
  network: string;
  contract_address: string;
  consensus_health: number;
  average_verification_time_seconds: number;
}
