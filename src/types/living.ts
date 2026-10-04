export type LivingStatus = 'VERIFIED' | 'TRUST_DEGRADED' | 'PENDING' | 'REJECTED' | 'DISAGREEMENT';
export type IncidentAction = 'COMPROMISED' | 'REINSTATED';

export interface IncidentChain {
  valid: boolean;
  event_count: number;
  chain_head: string | null;
  errors: string[];
}

export interface LivingStats {
  total_releases: number;
  currently_verified: number;
  trust_degraded: number;
  active_compromises: number;
  last_reevaluated_at: string | null;
  incident_chain: IncidentChain;
}

export interface LivingBuilder {
  id: string;
  name: string;
  operator: string;
  platform: string;
  trusted: boolean;
  living_status: 'ACTIVE' | 'COMPROMISED';
  latest_incident_id: string | null;
  affected_release_count: number;
}

export interface LivingIncident {
  id: string;
  builder_id: string;
  builder_name: string;
  operator: string;
  action: IncidentAction;
  reason: string;
  effective_from: string | null;
  created_at: string;
  previous_hash: string;
  event_hash: string;
}

export interface LivingAssessment {
  release_id: string;
  artifact_name: string;
  repository_url: string;
  source_commit: string;
  candidate_sha256: string;
  consensus_sha256: string | null;
  historical_status: string;
  current_status: LivingStatus;
  recalculated_status: string;
  latest_incident_id: string | null;
  excluded_builders: string[];
  original_attestation_count: number;
  eligible_attestation_count: number;
  threshold: number;
  reason: string;
  reevaluated_at: string;
}

export interface CreateLivingIncident {
  builder_id: string;
  action: IncidentAction;
  reason: string;
  effective_from?: string;
}

export interface LivingIncidentResult {
  incident: LivingIncident;
  affected_releases: number;
  degraded_releases: number;
  incident_chain: IncidentChain;
}
