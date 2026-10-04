export type RiskLevel = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type FindingCategory =
  | 'AUTH_PERMISSIONS'
  | 'CRYPTO_SIGNATURES'
  | 'DEPENDENCY_CHANGES'
  | 'NETWORK_EXFILTRATION'
  | 'BUILD_WORKFLOWS'
  | 'SECRETS_HANDLING';

export type ChangeType = 'ADDED' | 'MODIFIED' | 'DELETED';
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'FLAGGED';

export interface SourceFinding {
  id: string;
  category: FindingCategory;
  severity: RiskLevel;
  file_path: string;
  line_number: number | null;
  change_type: ChangeType;
  title: string;
  snippet: string;
  explanation: string;
  reason: string;
  recommended_action: string;
}

export interface DiffFile {
  file_path: string;
  change_type: ChangeType;
  additions: number;
  deletions: number;
  diff_content: string;
}

export interface ComparisonSummary {
  files_changed_count: number;
  additions_count: number;
  deletions_count: number;
  findings_count: number;
  severity_counts: Record<RiskLevel, number>;
  category_counts: Record<FindingCategory, number>;
}

export interface ComparisonResponse {
  id: string;
  is_fixture: boolean;
  fixture_id: string | null;
  repository_url: string;
  base_commit: string;
  target_commit: string;
  base_snapshot_hash: string;
  target_snapshot_hash: string;
  risk_level: RiskLevel;
  review_status: ReviewStatus;
  reviewer_notes: string | null;
  reviewed_at: string | null;
  summary: ComparisonSummary;
  findings: SourceFinding[];
  diff_files: DiffFile[];
  created_at: string;
}

export interface ComparisonListItem {
  id: string;
  is_fixture: boolean;
  fixture_id: string | null;
  repository_url: string;
  base_commit: string;
  target_commit: string;
  risk_level: RiskLevel;
  review_status: ReviewStatus;
  files_changed_count: number;
  additions_count: number;
  deletions_count: number;
  findings_count: number;
  created_at: string;
}

export interface CompareRequest {
  mode: 'fixture' | 'git' | 'cross-repo';
  fixture_id?: string;
  repository_url?: string;
  base_commit?: string;
  target_commit?: string;
  base_repository_url?: string;
  target_repository_url?: string;
}

export interface ReviewRequest {
  review_status: ReviewStatus;
  notes?: string;
}

export interface FixtureItem {
  id: string;
  name: string;
  description: string;
  base_commit: string;
  target_commit: string;
  repository_url: string;
  expected_risk: RiskLevel;
  category_tags: string[];
}
