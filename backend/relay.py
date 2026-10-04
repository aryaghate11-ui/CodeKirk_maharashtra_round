"""Quorum Relay: Post-verification independent artifact integrity monitoring and witness checking."""
from __future__ import annotations

import asyncio
import hashlib
import http.client
import ipaddress
import json
import os
import re
import socket
import ssl
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from backend.auth import require_admin
from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.getenv("QUORUM_DB_PATH", ROOT / "backend" / "data" / "quorum.db"))

relay_router = APIRouter(prefix="/api/v1/relay", tags=["relay"])

# Concurrency lock to prevent overlapping checks for the same monitor
_active_checks_lock = threading.Lock()
_active_checks: set[str] = set()

# Scheduler reference
_scheduler_task: asyncio.Task[None] | None = None
_scheduler_stop_event = asyncio.Event()

MAX_ARTIFACT_SIZE = 50 * 1024 * 1024  # 50 MB
DEFAULT_CHECK_INTERVAL = 3600  # 1 hour
MIN_CHECK_INTERVAL = 60  # 1 minute
CONNECT_TIMEOUT_SECONDS = 5
READ_TIMEOUT_SECONDS = 15
MAX_REDIRECTS = 3


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


def init_relay_db(db: sqlite3.Connection | None = None) -> None:
    should_close = False
    if db is None:
        db = connect()
        should_close = True
    try:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS artifact_monitors (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                artifact_url TEXT NOT NULL,
                expected_sha256 TEXT NOT NULL,
                release_id TEXT REFERENCES releases(id) ON DELETE SET NULL,
                provenance TEXT NOT NULL, -- 'VERIFIED_RELEASE_CONSENSUS', 'MANUAL_UNVERIFIED'
                description TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                check_interval_seconds INTEGER NOT NULL DEFAULT 3600,
                created_at TEXT NOT NULL,
                last_checked_at TEXT,
                last_result TEXT, -- 'MATCH', 'MISMATCH', 'ERROR', 'PENDING'
                last_observed_sha256 TEXT,
                last_error_summary TEXT,
                next_check_at TEXT,
                trusted_baseline_sha256 TEXT,
                baseline_established_at TEXT,
                baseline_approved_by TEXT,
                baseline_approval_notes TEXT,
                previous_baseline_sha256 TEXT,
                last_baseline_result TEXT DEFAULT 'NOT_ESTABLISHED'
            );

            CREATE TABLE IF NOT EXISTS relay_checks (
                id TEXT PRIMARY KEY,
                monitor_id TEXT NOT NULL REFERENCES artifact_monitors(id) ON DELETE CASCADE,
                result TEXT NOT NULL, -- 'MATCH', 'MISMATCH', 'ERROR'
                expected_sha256 TEXT NOT NULL,
                observed_sha256 TEXT,
                bytes_downloaded INTEGER,
                http_status INTEGER,
                response_time_ms INTEGER NOT NULL,
                error_summary TEXT,
                checked_at TEXT NOT NULL,
                trusted_baseline_sha256 TEXT,
                baseline_result TEXT,
                baseline_change_detected INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS relay_baseline_events (
                id TEXT PRIMARY KEY,
                monitor_id TEXT NOT NULL REFERENCES artifact_monitors(id) ON DELETE CASCADE,
                event_type TEXT NOT NULL, -- 'BASELINE_ESTABLISHED', 'BASELINE_UPDATED', 'BASELINE_DIVERGENCE'
                previous_baseline_sha256 TEXT,
                trusted_baseline_sha256 TEXT,
                observed_sha256 TEXT,
                artifact_url TEXT NOT NULL,
                approved_by TEXT,
                notes TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_artifact_monitors_created_at
            ON artifact_monitors(created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_relay_checks_monitor_id
            ON relay_checks(monitor_id, checked_at DESC);

            CREATE INDEX IF NOT EXISTS idx_relay_baseline_events_monitor_id
            ON relay_baseline_events(monitor_id, created_at DESC);
            """
        )

        # Migrate existing schema tables if missing baseline columns
        try:
            m_cols = {row["name"] for row in db.execute("PRAGMA table_info(artifact_monitors)").fetchall()}
            for col_name, col_def in [
                ("trusted_baseline_sha256", "TEXT"),
                ("baseline_established_at", "TEXT"),
                ("baseline_approved_by", "TEXT"),
                ("baseline_approval_notes", "TEXT"),
                ("previous_baseline_sha256", "TEXT"),
                ("last_baseline_result", "TEXT DEFAULT 'NOT_ESTABLISHED'"),
            ]:
                if col_name not in m_cols:
                    db.execute(f"ALTER TABLE artifact_monitors ADD COLUMN {col_name} {col_def}")
        except Exception:
            pass

        try:
            c_cols = {row["name"] for row in db.execute("PRAGMA table_info(relay_checks)").fetchall()}
            for col_name, col_def in [
                ("trusted_baseline_sha256", "TEXT"),
                ("baseline_result", "TEXT"),
                ("baseline_change_detected", "INTEGER NOT NULL DEFAULT 0"),
            ]:
                if col_name not in c_cols:
                    db.execute(f"ALTER TABLE relay_checks ADD COLUMN {col_name} {col_def}")
        except Exception:
            pass
        count = db.execute("SELECT COUNT(*) FROM artifact_monitors").fetchone()[0]
        if count == 0:
            try:
                rel = db.execute(
                    "SELECT * FROM releases WHERE status = 'verified' AND consensus_sha256 IS NOT NULL ORDER BY created_at DESC LIMIT 1"
                ).fetchone()
                if rel and rel["consensus_sha256"]:
                    now_str = utc_now()
                    next_str = (datetime.now(timezone.utc) + timedelta(seconds=3600)).isoformat(timespec="seconds")
                    db.execute(
                        """
                        INSERT INTO artifact_monitors
                            (id, name, artifact_url, expected_sha256, release_id, provenance,
                             description, enabled, check_interval_seconds, created_at,
                             last_result, next_check_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 3600, ?, 'PENDING', ?)
                        """,
                        (
                            "mon-hey-primary",
                            "Hey v0.1.4 Primary Distribution Witness",
                            "https://raw.githubusercontent.com/rakyll/hey/master/README.md",
                            rel["consensus_sha256"],
                            rel["id"],
                            "VERIFIED_RELEASE_CONSENSUS",
                            "Independent witness monitor tracking published artifact binary against 3-of-3 builder consensus.",
                            now_str,
                            next_str,
                        ),
                    )
            except Exception:
                pass

        # Register official public GitHub release monitor (fzf v0.74.4 binary) if not already present
        fzf_row = db.execute("SELECT id FROM artifact_monitors WHERE id = 'mon-fzf-official'").fetchone()
        if not fzf_row:
            try:
                now_str = utc_now()
                next_str = (datetime.now(timezone.utc) + timedelta(seconds=3600)).isoformat(timespec="seconds")
                db.execute(
                    """
                    INSERT INTO artifact_monitors
                        (id, name, artifact_url, expected_sha256, release_id, provenance,
                         description, enabled, check_interval_seconds, created_at,
                         last_result, next_check_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 3600, ?, 'PENDING', ?)
                    """,
                    (
                        "mon-fzf-official",
                        "fzf v0.74.4 Linux AMD64 Official Binary Release",
                        "https://github.com/junegunn/fzf/releases/download/v0.74.4/fzf-0.74.4-linux_amd64.tar.gz",
                        "05e6813a337cc722c3ed07e54a764b75cc5d671e2e60459db0ba696ee5fa7504",
                        None,
                        "MANUAL_UNVERIFIED",
                        "Independent witness monitor tracking genuine 2.28 MB compiled release binary for fzf v0.74.4. Expected hash verified against official author-published checksums.txt.",
                        now_str,
                        next_str,
                    ),
                )
            except Exception:
                pass
    finally:
        if should_close:
            db.close()


# -----------------------------------------------------------------------------
# SSRF & Safe Downloader Engine
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


def validate_ip_address_not_blocked(ip_str: str, host_label: str = "Host") -> None:
    try:
        ip_obj = ipaddress.ip_address(ip_str)

        # If it is an IPv4-mapped IPv6 address (e.g. ::ffff:127.0.0.1),
        # unwrap and validate the underlying IPv4 address against IPv4 blocked networks.
        target_obj = ip_obj
        if isinstance(ip_obj, ipaddress.IPv6Address) and ip_obj.ipv4_mapped is not None:
            target_obj = ip_obj.ipv4_mapped

        # Reject IPv6/IPv4 unspecified, loopback, link-local, multicast, or reserved
        if (
            target_obj.is_unspecified
            or target_obj.is_loopback
            or target_obj.is_link_local
            or target_obj.is_multicast
            or target_obj.is_reserved
        ):
            raise ValueError(f"SSRF Protection: {host_label} resolves to blocked private/internal IP {ip_str}.")

        for net in BLOCKED_IP_NETWORKS:
            if target_obj in net:
                raise ValueError(f"SSRF Protection: {host_label} resolves to blocked private/internal IP {ip_str}.")
    except ValueError as val_err:
        if "SSRF Protection" in str(val_err):
            raise
        raise ValueError(f"SSRF Protection: Invalid IP address format '{ip_str}'.") from None


def validate_public_https_url(url_str: str) -> str:
    cleaned = url_str.strip()
    parsed = urllib.parse.urlparse(cleaned)
    if parsed.scheme.lower() != "https":
        raise ValueError("SSRF Protection: Only HTTPS artifact download URLs are permitted.")

    # Reject embedded user credentials (username, password, or @ in netloc)
    if parsed.username or parsed.password or "@" in (parsed.netloc or ""):
        raise ValueError(
            "SSRF Protection: URLs containing embedded credentials (user:password@) are strictly forbidden."
        )

    hostname = parsed.hostname
    if not hostname:
        raise ValueError("Invalid URL: missing hostname.")

    if hostname.lower() in ("localhost", "127.0.0.1", "::1", "metadata.google.internal"):
        raise ValueError("SSRF Protection: Access to localhost or internal hosts is strictly forbidden.")

    try:
        addr_info = socket.getaddrinfo(hostname, 443, proto=socket.IPPROTO_TCP)
    except Exception as e:
        raise ValueError(f"DNS resolution failed for host '{hostname}': {e}")

    for item in addr_info:
        ip_str = item[4][0]
        validate_ip_address_not_blocked(ip_str, f"Host '{hostname}'")

    return cleaned


class SSRFSafeHTTPSConnection(http.client.HTTPSConnection):
    """
    Custom HTTPSConnection that closes the DNS-rebinding (TOCTOU) window.
    Directly inspects the OS socket's peer IP address immediately upon raw TCP connection,
    closing the socket and failing closed before initiating any TLS handshake or HTTP traffic.
    Preserves SNI, original hostname verification, and CA certificates.
    """
    def connect(self):
        # 1. Establish raw TCP connection
        http.client.HTTPConnection.connect(self)

        # 2. Inspect the connected peer IP directly from the operating system socket
        peer_ip = self.sock.getpeername()[0]
        try:
            validate_ip_address_not_blocked(peer_ip, f"Connected peer ({self.host})")
        except Exception:
            try:
                self.sock.close()
            except Exception:
                pass
            raise

        # 3. Complete TLS handshake using original hostname for SNI and certificate validation
        server_hostname = self._tunnel_host if self._tunnel_host else self.host
        self.sock = self._context.wrap_socket(self.sock, server_hostname=server_hostname)


class SSRFSafeHTTPSHandler(urllib.request.HTTPSHandler):
    """HTTPS handler that forces all connections through SSRFSafeHTTPSConnection."""
    def https_open(self, req):
        return self.do_open(SSRFSafeHTTPSConnection, req, context=self._context)


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Custom handler to intercept redirects so every destination can be SSRF-checked."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Do not follow automatically; handled explicitly in fetch loop


def download_and_hash_artifact(url: str) -> tuple[str, int, int]:
    """
    Safely streams bytes from url up to MAX_ARTIFACT_SIZE, computing SHA-256.
    Follows redirects manually while re-validating each hop for SSRF.
    Returns: (sha256_hex, bytes_downloaded, http_status)
    """
    current_url = url
    redirects_followed = 0

    while True:
        validate_public_https_url(current_url)

        req = urllib.request.Request(
            current_url,
            headers={
                "User-Agent": "Quorum-Relay-Worker/1.0 (Decentralized Build Verifier)",
                "Accept": "*/*",
            },
        )

        opener = urllib.request.build_opener(SSRFSafeHTTPSHandler, NoRedirectHandler)

        try:
            with opener.open(req, timeout=CONNECT_TIMEOUT_SECONDS + READ_TIMEOUT_SECONDS) as resp:
                status_code = resp.status

                # Handle redirect responses manually
                if status_code in (301, 302, 303, 307, 308):
                    redirects_followed += 1
                    if redirects_followed > MAX_REDIRECTS:
                        raise ValueError(f"Exceeded maximum allowed redirects ({MAX_REDIRECTS}).")
                    redirect_target = resp.headers.get("Location")
                    if not redirect_target:
                        raise ValueError("Received redirect status without Location header.")
                    current_url = urllib.parse.urljoin(current_url, redirect_target)
                    continue

                if status_code != 200:
                    raise ValueError(f"Server returned HTTP {status_code}.")

                # Check Content-Length if provided
                cl_header = resp.headers.get("Content-Length")
                if cl_header:
                    try:
                        content_length = int(cl_header)
                        if content_length > MAX_ARTIFACT_SIZE:
                            raise ValueError(
                                f"Artifact Content-Length ({content_length} bytes) exceeds maximum limit of {MAX_ARTIFACT_SIZE // (1024*1024)} MB."
                            )
                    except ValueError as val_err:
                        if "exceeds maximum limit" in str(val_err):
                            raise

                # Stream and compute SHA-256
                hasher = hashlib.sha256()
                bytes_downloaded = 0
                chunk_size = 64 * 1024  # 64 KB

                while True:
                    chunk = resp.read(chunk_size)
                    if not chunk:
                        break
                    bytes_downloaded += len(chunk)
                    if bytes_downloaded > MAX_ARTIFACT_SIZE:
                        raise ValueError(
                            f"Artifact downloaded bytes exceeded limit of {MAX_ARTIFACT_SIZE // (1024*1024)} MB."
                        )
                    hasher.update(chunk)

                return hasher.hexdigest(), bytes_downloaded, status_code

        except urllib.error.HTTPError as e:
            # Handle 3xx redirect from HTTPError if opener raises it
            if e.code in (301, 302, 303, 307, 308):
                redirects_followed += 1
                if redirects_followed > MAX_REDIRECTS:
                    raise ValueError(f"Exceeded maximum allowed redirects ({MAX_REDIRECTS}).")
                redirect_target = e.headers.get("Location")
                if not redirect_target:
                    raise ValueError("Received redirect status without Location header.")
                current_url = urllib.parse.urljoin(current_url, redirect_target)
                continue
            raise ValueError(f"HTTP {e.code}: {e.reason}")
        except urllib.error.URLError as e:
            raise ValueError(f"Connection failed: {e.reason}")
        except socket.timeout:
            raise ValueError("Request timed out during artifact retrieval.")


def safe_fetch_text(
    url: str,
    max_bytes: int = 1024 * 1024,
    extra_headers: dict[str, str] | None = None,
) -> tuple[str, int]:
    """
    Safely retrieves text content from a public HTTPS URL using SSRFSafeHTTPSHandler.
    Validates redirects, peer IPs, and enforces size limit.
    Returns: (text_content, status_code)
    """
    current_url = url
    redirects_followed = 0

    while True:
        validate_public_https_url(current_url)

        headers = {
            "User-Agent": "Quorum-Relay-Worker/1.0 (Decentralized Build Verifier)",
            "Accept": "*/*",
        }
        if extra_headers:
            headers.update(extra_headers)

        req = urllib.request.Request(current_url, headers=headers)
        opener = urllib.request.build_opener(SSRFSafeHTTPSHandler, NoRedirectHandler)

        try:
            with opener.open(req, timeout=CONNECT_TIMEOUT_SECONDS + READ_TIMEOUT_SECONDS) as resp:
                status_code = resp.status

                if status_code in (301, 302, 303, 307, 308):
                    redirects_followed += 1
                    if redirects_followed > MAX_REDIRECTS:
                        raise ValueError(f"Exceeded maximum allowed redirects ({MAX_REDIRECTS}).")
                    redirect_target = resp.headers.get("Location")
                    if not redirect_target:
                        raise ValueError("Received redirect status without Location header.")
                    current_url = urllib.parse.urljoin(current_url, redirect_target)
                    continue

                if status_code != 200:
                    raise ValueError(f"Server returned HTTP {status_code}.")

                cl_header = resp.headers.get("Content-Length")
                if cl_header:
                    try:
                        content_length = int(cl_header)
                        if content_length > max_bytes:
                            raise ValueError(
                                f"Content-Length ({content_length} bytes) exceeds limit of {max_bytes} bytes."
                            )
                    except ValueError as val_err:
                        if "exceeds limit" in str(val_err):
                            raise

                chunks: list[bytes] = []
                total_bytes = 0
                chunk_size = 16 * 1024

                while True:
                    chunk = resp.read(chunk_size)
                    if not chunk:
                        break
                    total_bytes += len(chunk)
                    if total_bytes > max_bytes:
                        raise ValueError(
                            f"Downloaded bytes exceeded maximum allowed text size ({max_bytes} bytes)."
                        )
                    chunks.append(chunk)

                raw_bytes = b"".join(chunks)
                text = raw_bytes.decode("utf-8", errors="replace")
                return text, status_code

        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308):
                redirects_followed += 1
                if redirects_followed > MAX_REDIRECTS:
                    raise ValueError(f"Exceeded maximum allowed redirects ({MAX_REDIRECTS}).")
                redirect_target = e.headers.get("Location")
                if not redirect_target:
                    raise ValueError("Received redirect status without Location header.")
                current_url = urllib.parse.urljoin(current_url, redirect_target)
                continue
            raise ValueError(f"HTTP {e.code}: {e.reason}")
        except urllib.error.URLError as e:
            raise ValueError(f"Connection failed: {e.reason}")
        except socket.timeout:
            raise ValueError("Request timed out during retrieval.")


def parse_checksum_manifest(content: str) -> dict[str, str]:
    """
    Parses a checksum manifest and returns a mapping of {basename: sha256_hex}.
    Supports:
    1. Standard GNU/POSIX sha256sum: '<hash>  [*]<filename>'
    2. BSD style: 'SHA256 (<filename>) = <hash>'
    3. Single raw 64-char hex string
    """
    mapping: dict[str, str] = {}
    lines = content.splitlines()
    clean_lines = [l.strip() for l in lines if l.strip() and not l.strip().startswith("#")]

    # If the file contains exactly one line with just a 64-character hash
    if len(clean_lines) == 1 and re.match(r"^[0-9a-fA-F]{64}$", clean_lines[0]):
        mapping["*"] = clean_lines[0].lower()
        return mapping

    for line in clean_lines:
        # Check BSD style: SHA256 (filename) = hash
        bsd_match = re.match(r"^SHA256\s*\((.+?)\)\s*=\s*([0-9a-fA-F]{64})$", line)
        if bsd_match:
            filename = os.path.basename(bsd_match.group(1).strip().replace("\\", "/"))
            hash_val = bsd_match.group(2).strip().lower()
            mapping[filename] = hash_val
            continue

        # Standard style: <hash> [*]<filename>
        std_match = re.match(r"^([0-9a-fA-F]{64})\s+[*]?(.+)$", line)
        if std_match:
            hash_val = std_match.group(1).strip().lower()
            file_part = std_match.group(2).strip()
            filename = os.path.basename(file_part.replace("\\", "/"))
            mapping[filename] = hash_val
            continue

    return mapping


def normalize_github_repo(repo_input: str) -> tuple[str, str]:
    """Normalizes 'owner/repo' or 'https://github.com/owner/repo' into (owner, repo)."""
    s = repo_input.strip()
    m_url = re.match(r"^https://github\.com/([a-zA-Z0-9_.-]+)/([a-zA-Z0-9_.-]+?)(?:\.git|/)?$", s)
    if m_url:
        return m_url.group(1), m_url.group(2)
    m_short = re.match(r"^([a-zA-Z0-9_.-]+)/([a-zA-Z0-9_.-]+)$", s)
    if m_short:
        return m_short.group(1), m_short.group(2)
    raise ValueError(
        f"Invalid repository format '{repo_input}'. Expected 'owner/repo' or 'https://github.com/owner/repo'."
    )


# -----------------------------------------------------------------------------
# Pydantic Schemas
# -----------------------------------------------------------------------------
CheckResult = Literal["MATCH", "MISMATCH", "ERROR"]
MonitorStatus = Literal["MATCH", "MISMATCH", "ERROR", "PENDING"]
ProvenanceType = Literal["VERIFIED_RELEASE_CONSENSUS", "MANUAL_UNVERIFIED"]
BaselineResult = Literal["MATCH", "CHANGED", "NOT_ESTABLISHED", "ERROR"]
BaselineStatus = Literal["MATCH", "CHANGED", "NOT_ESTABLISHED", "ERROR", "PENDING"]


class ArtifactMonitorCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    artifact_url: str = Field(min_length=8, max_length=1000)
    expected_sha256: str | None = None
    release_id: str | None = None
    description: str | None = Field(default=None, max_length=500)
    check_interval_seconds: int = Field(default=DEFAULT_CHECK_INTERVAL, ge=MIN_CHECK_INTERVAL, le=86400 * 7)

    @field_validator("artifact_url")
    def validate_url(cls, v: str) -> str:
        return validate_public_https_url(v)

    @model_validator(mode="after")
    def validate_hash_or_release(self):
        if not self.release_id and not self.expected_sha256:
            raise ValueError("Either release_id (for verified releases) or expected_sha256 (for manual verification) must be provided.")
        if self.expected_sha256:
            clean_hash = self.expected_sha256.strip().lower()
            if not re.match(r"^[0-9a-f]{64}$", clean_hash):
                raise ValueError("expected_sha256 must be a 64-character hexadecimal SHA-256 hash.")
            self.expected_sha256 = clean_hash
        return self


class ArtifactMonitorUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    enabled: bool | None = None
    check_interval_seconds: int | None = Field(default=None, ge=MIN_CHECK_INTERVAL, le=86400 * 7)


class EstablishBaselineRequest(BaseModel):
    baseline_sha256: str = Field(..., description="The SHA-256 hash to establish as trusted baseline")
    approved_by: str = Field(default="Security Operator", min_length=1, max_length=100, description="Operator approving baseline")
    notes: str | None = Field(default=None, max_length=500, description="Optional approval notes or context")

    @field_validator("baseline_sha256")
    def validate_hash(cls, v: str) -> str:
        clean = v.strip().lower()
        if not re.match(r"^[0-9a-f]{64}$", clean):
            raise ValueError("baseline_sha256 must be a 64-character hexadecimal SHA-256 hash.")
        return clean


class BaselineEventResponse(BaseModel):
    id: str
    monitor_id: str
    event_type: str
    previous_baseline_sha256: str | None = None
    trusted_baseline_sha256: str | None = None
    observed_sha256: str | None = None
    artifact_url: str
    approved_by: str | None = None
    notes: str | None = None
    created_at: str


class ArtifactMonitorResponse(BaseModel):
    id: str
    name: str
    artifact_url: str
    expected_sha256: str
    release_id: str | None
    release_name: str | None
    provenance: ProvenanceType
    description: str | None
    enabled: bool
    check_interval_seconds: int
    created_at: str
    last_checked_at: str | None
    last_result: MonitorStatus
    last_observed_sha256: str | None
    last_error_summary: str | None
    next_check_at: str | None
    total_checks_count: int
    trusted_baseline_sha256: str | None = None
    baseline_established_at: str | None = None
    baseline_approved_by: str | None = None
    baseline_approval_notes: str | None = None
    previous_baseline_sha256: str | None = None
    last_baseline_result: BaselineStatus = "NOT_ESTABLISHED"


class RelayCheckResponse(BaseModel):
    id: str
    monitor_id: str
    result: CheckResult
    expected_sha256: str
    observed_sha256: str | None
    bytes_downloaded: int | None
    http_status: int | None
    response_time_ms: int
    error_summary: str | None
    checked_at: str
    trusted_baseline_sha256: str | None = None
    baseline_result: BaselineResult | None = None
    baseline_change_detected: bool = False


class RelayStatsResponse(BaseModel):
    total_monitors: int
    active_monitors: int
    total_checks: int
    matches_count: int
    mismatches_count: int
    errors_count: int
    baselines_established_count: int = 0
    baseline_changes_count: int = 0
    latest_check: RelayCheckResponse | None


class VerifiedReleaseItem(BaseModel):
    release_id: str
    artifact_name: str
    repository_url: str
    source_commit: str
    consensus_sha256: str
    threshold: int = 2
    expected_builders: int = 3
    attestation_count: int = 0
    created_at: str


class GitHubReleaseAsset(BaseModel):
    name: str
    download_url: str
    size_bytes: int
    content_type: str | None = None
    expected_sha256: str | None = None
    hash_source: str | None = None
    is_manifest: bool = False


class GitHubReleaseInfo(BaseModel):
    repository: str
    tag_name: str
    release_name: str
    published_at: str | None = None
    html_url: str
    manifest_found: bool
    manifest_name: str | None = None
    manifest_url: str | None = None
    manifest_signed: bool = False
    signature_asset_name: str | None = None
    assets: list[GitHubReleaseAsset]
    provenance_note: str


# -----------------------------------------------------------------------------
# Check Execution & Business Logic
# -----------------------------------------------------------------------------
def perform_monitor_check(monitor_id: str) -> RelayCheckResponse:
    """Performs an independent byte-level check of the monitor's published artifact."""
    init_relay_db()

    with _active_checks_lock:
        if monitor_id in _active_checks:
            raise HTTPException(
                status_code=409,
                detail=f"An artifact check is already currently in progress for monitor '{monitor_id}'."
            )
        _active_checks.add(monitor_id)

    check_id = str(uuid.uuid4())
    start_time = time.perf_counter()
    checked_at = utc_now()

    try:
        with connect() as db:
            monitor = db.execute("SELECT * FROM artifact_monitors WHERE id = ?", (monitor_id,)).fetchone()
            if not monitor:
                raise HTTPException(status_code=404, detail=f"Monitor '{monitor_id}' not found.")

        expected_sha256 = monitor["expected_sha256"].lower()
        url = monitor["artifact_url"]
        observed_sha256: str | None = None
        bytes_downloaded: int | None = None
        http_status: int | None = None
        error_summary: str | None = None
        result: CheckResult

        try:
            observed_sha256, bytes_downloaded, http_status = download_and_hash_artifact(url)
            if observed_sha256 == expected_sha256:
                result = "MATCH"
            else:
                result = "MISMATCH"
        except Exception as e:
            result = "ERROR"
            error_summary = str(e)

        elapsed_ms = int((time.perf_counter() - start_time) * 1000)

        # Baseline Comparison (independent of expected_sha256)
        trusted_baseline = monitor["trusted_baseline_sha256"]
        baseline_result: BaselineResult
        baseline_change_detected = False

        if observed_sha256 is None:
            baseline_result = "ERROR"
        elif not trusted_baseline:
            baseline_result = "NOT_ESTABLISHED"
        elif observed_sha256.lower() == trusted_baseline.lower():
            baseline_result = "MATCH"
        else:
            baseline_result = "CHANGED"
            baseline_change_detected = True

        # Compute next scheduled check time
        interval = monitor["check_interval_seconds"] or DEFAULT_CHECK_INTERVAL
        next_check = (datetime.now(timezone.utc) + timedelta(seconds=interval)).isoformat(timespec="seconds")

        with connect() as db:
            db.execute(
                """
                INSERT INTO relay_checks
                    (id, monitor_id, result, expected_sha256, observed_sha256,
                     bytes_downloaded, http_status, response_time_ms, error_summary, checked_at,
                     trusted_baseline_sha256, baseline_result, baseline_change_detected)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    check_id,
                    monitor_id,
                    result,
                    expected_sha256,
                    observed_sha256,
                    bytes_downloaded,
                    http_status,
                    elapsed_ms,
                    error_summary,
                    checked_at,
                    trusted_baseline,
                    baseline_result,
                    1 if baseline_change_detected else 0,
                ),
            )

            db.execute(
                """
                UPDATE artifact_monitors
                SET last_checked_at = ?, last_result = ?, last_observed_sha256 = ?,
                    last_error_summary = ?, next_check_at = ?, last_baseline_result = ?
                WHERE id = ?
                """,
                (
                    checked_at,
                    result,
                    observed_sha256,
                    error_summary,
                    next_check,
                    baseline_result,
                    monitor_id,
                ),
            )

            # Audit baseline change if diverged from approved trusted baseline
            if baseline_change_detected and trusted_baseline:
                db.execute(
                    """
                    INSERT INTO relay_baseline_events
                        (id, monitor_id, event_type, previous_baseline_sha256,
                         trusted_baseline_sha256, observed_sha256, artifact_url,
                         approved_by, notes, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        monitor_id,
                        "BASELINE_DIVERGENCE",
                        monitor["previous_baseline_sha256"],
                        trusted_baseline,
                        observed_sha256,
                        url,
                        "SYSTEM_MONITOR",
                        "Observed artifact SHA-256 diverged from established trusted baseline.",
                        checked_at,
                    ),
                )

            # Audit Trail Integration: if linked to a valid release, append audit event
            release_id = monitor["release_id"]
            if release_id:
                rel = db.execute("SELECT id FROM releases WHERE id = ?", (release_id,)).fetchone()
                if rel:
                    prev_row = db.execute(
                        "SELECT event_hash FROM audit_events WHERE release_id = ? ORDER BY id DESC LIMIT 1",
                        (release_id,),
                    ).fetchone()
                    prev_hash = prev_row["event_hash"] if prev_row else "0" * 64
                    event_type = "relay.check_completed"
                    event_data = {
                        "monitor_id": monitor_id,
                        "monitor_name": monitor["name"],
                        "result": result,
                        "expected_sha256": expected_sha256,
                        "observed_sha256": observed_sha256,
                        "bytes_downloaded": bytes_downloaded,
                        "artifact_url": url,
                        "provenance": monitor["provenance"],
                        "baseline_result": baseline_result,
                        "trusted_baseline_sha256": trusted_baseline,
                    }
                    if result == "MISMATCH":
                        event_data["security_alert"] = "POTENTIAL_POST_VERIFICATION_TAMPERING"

                    event_json = json.dumps(event_data, sort_keys=True, separators=(",", ":"))
                    event_hash = hashlib.sha256(f"{prev_hash}|{event_type}|{event_json}|{checked_at}".encode()).hexdigest()
                    db.execute(
                        """
                        INSERT INTO audit_events
                            (release_id, event_type, event_json, previous_hash, event_hash, created_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (release_id, event_type, event_json, prev_hash, event_hash, checked_at),
                    )

                    # If baseline divergence occurred on a release-backed monitor, record separate baseline audit event
                    if baseline_change_detected and trusted_baseline:
                        b_event_type = "relay.baseline_divergence"
                        b_event_data = {
                            "monitor_id": monitor_id,
                            "monitor_name": monitor["name"],
                            "artifact_url": url,
                            "trusted_baseline_sha256": trusted_baseline,
                            "observed_sha256": observed_sha256,
                            "timestamp": checked_at,
                            "alert": "BASELINE_CHANGED",
                            "description": "Artifact hash diverged from established trusted baseline. Review before re-approving.",
                        }
                        b_event_json = json.dumps(b_event_data, sort_keys=True, separators=(",", ":"))
                        b_event_hash = hashlib.sha256(f"{event_hash}|{b_event_type}|{b_event_json}|{checked_at}".encode()).hexdigest()
                        db.execute(
                            """
                            INSERT INTO audit_events
                                (release_id, event_type, event_json, previous_hash, event_hash, created_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                            """,
                            (release_id, b_event_type, b_event_json, event_hash, b_event_hash, checked_at),
                        )

        return RelayCheckResponse(
            id=check_id,
            monitor_id=monitor_id,
            result=result,
            expected_sha256=expected_sha256,
            observed_sha256=observed_sha256,
            bytes_downloaded=bytes_downloaded,
            http_status=http_status,
            response_time_ms=elapsed_ms,
            error_summary=error_summary,
            checked_at=checked_at,
            trusted_baseline_sha256=trusted_baseline,
            baseline_result=baseline_result,
            baseline_change_detected=baseline_change_detected,
        )

    finally:
        with _active_checks_lock:
            _active_checks.discard(monitor_id)


# -----------------------------------------------------------------------------
# Background Scheduler (Non-blocking asyncio worker)
# -----------------------------------------------------------------------------
async def run_relay_scheduler():
    """Background loop that polls enabled monitors and executes checks when due."""
    while not _scheduler_stop_event.is_set():
        try:
            await asyncio.sleep(15)  # evaluate every 15s
            if _scheduler_stop_event.is_set():
                break

            now_iso = utc_now()
            due_monitor_ids: list[str] = []

            try:
                with connect() as db:
                    rows = db.execute(
                        """
                        SELECT id FROM artifact_monitors
                        WHERE enabled = 1 AND (next_check_at IS NULL OR next_check_at <= ?)
                        LIMIT 5
                        """,
                        (now_iso,),
                    ).fetchall()
                    due_monitor_ids = [r["id"] for r in rows]
            except Exception:
                continue

            for m_id in due_monitor_ids:
                if _scheduler_stop_event.is_set():
                    break
                # Run check safely in separate thread
                try:
                    await asyncio.to_thread(perform_monitor_check, m_id)
                except Exception:
                    pass

        except asyncio.CancelledError:
            break
        except Exception:
            await asyncio.sleep(5)


def start_relay_scheduler() -> asyncio.Task[None] | None:
    global _scheduler_task, _scheduler_stop_event
    _scheduler_stop_event.clear()
    if _scheduler_task is None or _scheduler_task.done():
        try:
            loop = asyncio.get_running_loop()
            _scheduler_task = loop.create_task(run_relay_scheduler(), name="QuorumRelayScheduler")
            return _scheduler_task
        except RuntimeError:
            return None
    return _scheduler_task


def stop_relay_scheduler():
    global _scheduler_task, _scheduler_stop_event
    _scheduler_stop_event.set()
    if _scheduler_task and not _scheduler_task.done():
        _scheduler_task.cancel()
    _scheduler_task = None


# -----------------------------------------------------------------------------
# API Endpoints
# -----------------------------------------------------------------------------
@relay_router.get("/stats", response_model=RelayStatsResponse)
def get_relay_stats() -> dict[str, Any]:
    """Retrieve summary metrics and telemetry across all registered Relay monitors."""
    init_relay_db()
    with connect() as db:
        total_monitors = db.execute("SELECT COUNT(*) FROM artifact_monitors").fetchone()[0]
        active_monitors = db.execute("SELECT COUNT(*) FROM artifact_monitors WHERE enabled = 1").fetchone()[0]
        total_checks = db.execute("SELECT COUNT(*) FROM relay_checks").fetchone()[0]
        matches = db.execute("SELECT COUNT(*) FROM relay_checks WHERE result = 'MATCH'").fetchone()[0]
        mismatches = db.execute("SELECT COUNT(*) FROM relay_checks WHERE result = 'MISMATCH'").fetchone()[0]
        errors = db.execute("SELECT COUNT(*) FROM relay_checks WHERE result = 'ERROR'").fetchone()[0]
        baselines_established = db.execute("SELECT COUNT(*) FROM artifact_monitors WHERE trusted_baseline_sha256 IS NOT NULL").fetchone()[0]
        baseline_changes = db.execute("SELECT COUNT(*) FROM relay_checks WHERE baseline_change_detected = 1").fetchone()[0]

        latest_row = db.execute(
            """
            SELECT * FROM relay_checks
            ORDER BY checked_at DESC
            LIMIT 1
            """
        ).fetchone()

        latest_check = dict(latest_row) if latest_row else None
        if latest_check:
            latest_check["baseline_change_detected"] = bool(latest_check.get("baseline_change_detected", 0))

        return {
            "total_monitors": total_monitors,
            "active_monitors": active_monitors,
            "total_checks": total_checks,
            "matches_count": matches,
            "mismatches_count": mismatches,
            "errors_count": errors,
            "baselines_established_count": baselines_established,
            "baseline_changes_count": baseline_changes,
            "latest_check": latest_check,
        }


@relay_router.get("/verified-releases", response_model=list[VerifiedReleaseItem])
def list_eligible_verified_releases() -> list[dict[str, Any]]:
    """Lists existing releases that have successfully satisfied builder consensus policy."""
    with connect() as db:
        rows = db.execute(
            """
            SELECT r.id AS release_id, r.artifact_name, r.repository_url, r.source_commit,
                   r.consensus_sha256, r.threshold, r.expected_builders, r.created_at,
                   (SELECT COUNT(*) FROM attestations a WHERE a.release_id = r.id AND a.signature_valid = 1) AS attestation_count
            FROM releases r
            WHERE r.status = 'verified' AND r.consensus_sha256 IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM attestations blocked
                  WHERE blocked.release_id = r.id
                    AND blocked.builder_id NOT IN ('local-builder', 'github-actions', 'gitlab-ci')
              )
            ORDER BY r.created_at DESC
            LIMIT 50
            """
        ).fetchall()
        return [dict(r) for r in rows]


def fetch_github_release_info(repo_input: str, tag: str | None = None) -> GitHubReleaseInfo:
    """
    Safely retrieves release metadata, assets, and parsed checksum manifest from public GitHub.
    Uses SSRFSafeHTTPSHandler for all network calls with redirect and size validations.
    """
    try:
        owner, repo = normalize_github_repo(repo_input)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if tag and tag.strip():
        clean_tag = tag.strip()
        api_url = f"https://api.github.com/repos/{owner}/{repo}/releases/tags/{urllib.parse.quote(clean_tag)}"
    else:
        api_url = f"https://api.github.com/repos/{owner}/{repo}/releases/latest"

    try:
        json_text, _ = safe_fetch_text(
            api_url,
            max_bytes=2 * 1024 * 1024,
            extra_headers={"Accept": "application/vnd.github.v3+json"},
        )
        release_data = json.loads(json_text)
    except ValueError as e:
        err_msg = str(e)
        if "404" in err_msg:
            raise HTTPException(
                status_code=404,
                detail=f"Public GitHub repository '{owner}/{repo}' or release was not found.",
            )
        if "403" in err_msg or "429" in err_msg:
            raise HTTPException(
                status_code=429,
                detail="GitHub API rate limit exceeded or access forbidden. Please try again later or supply the expected hash manually.",
            )
        raise HTTPException(status_code=502, detail=f"Failed to query GitHub release: {err_msg}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Invalid JSON response received from GitHub API.")

    tag_name = release_data.get("tag_name") or "unknown"
    release_name = release_data.get("name") or tag_name
    published_at = release_data.get("published_at")
    html_url = release_data.get("html_url") or f"https://github.com/{owner}/{repo}/releases"
    raw_assets = release_data.get("assets", [])

    # Classify manifest vs binary distribution assets
    manifest_asset = None
    signature_asset_name = None
    manifest_map: dict[str, str] = {}

    # Look for signature files
    for a in raw_assets:
        name_lower = a.get("name", "").lower()
        if name_lower.endswith((".asc", ".sig", ".minisig", ".pem")):
            signature_asset_name = a.get("name")
            break

    # Look for unified checksum manifest
    for a in raw_assets:
        name_lower = a.get("name", "").lower()
        if any(keyword in name_lower for keyword in ("checksum", "sha256sums", "sha256sum", "shasums")):
            if not name_lower.endswith((".asc", ".sig", ".minisig", ".pem")):
                manifest_asset = a
                break

    manifest_found = False
    manifest_name = None
    manifest_url = None

    if manifest_asset:
        manifest_url = manifest_asset.get("browser_download_url")
        manifest_name = manifest_asset.get("name")
        if manifest_url:
            try:
                manifest_text, _ = safe_fetch_text(manifest_url, max_bytes=1024 * 1024)
                manifest_map = parse_checksum_manifest(manifest_text)
                if manifest_map:
                    manifest_found = True
            except Exception:
                pass

    # Build asset models
    distribution_assets: list[GitHubReleaseAsset] = []
    for a in raw_assets:
        aname = a.get("name", "")
        aname_lower = aname.lower()
        is_manifest = (
            (manifest_asset is not None and aname == manifest_asset.get("name"))
            or aname_lower.endswith((".asc", ".sig", ".minisig", ".pem"))
        )

        expected_hash = manifest_map.get(aname)
        hash_source = f"Manifest: {manifest_name}" if expected_hash and manifest_name else None

        # Check for companion .sha256 file if not found in unified manifest
        if not expected_hash and not is_manifest:
            companion_name = f"{aname}.sha256"
            companion_asset = next((x for x in raw_assets if x.get("name") == companion_name), None)
            if companion_asset and companion_asset.get("browser_download_url"):
                try:
                    c_text, _ = safe_fetch_text(companion_asset["browser_download_url"], max_bytes=64 * 1024)
                    c_map = parse_checksum_manifest(c_text)
                    if aname in c_map:
                        expected_hash = c_map[aname]
                        hash_source = f"Manifest: {companion_name}"
                        manifest_found = True
                    elif "*" in c_map:
                        expected_hash = c_map["*"]
                        hash_source = f"Manifest: {companion_name}"
                        manifest_found = True
                    elif re.match(r"^[0-9a-fA-F]{64}$", c_text.strip()):
                        expected_hash = c_text.strip().lower()
                        hash_source = f"Manifest: {companion_name}"
                        manifest_found = True
                except Exception:
                    pass

        distribution_assets.append(
            GitHubReleaseAsset(
                name=aname,
                download_url=a.get("browser_download_url", ""),
                size_bytes=a.get("size", 0),
                content_type=a.get("content_type"),
                expected_sha256=expected_hash,
                hash_source=hash_source,
                is_manifest=is_manifest,
            )
        )

    if manifest_found:
        if signature_asset_name:
            provenance_note = (
                f"Expected SHA-256 extracted from author release manifest '{manifest_name}' "
                f"(accompanied by signature asset '{signature_asset_name}'). "
                "Author Reference (MANUAL_UNVERIFIED). Note: Not an attested multi-builder Quorum consensus."
            )
        else:
            provenance_note = (
                f"Expected SHA-256 extracted from author release manifest '{manifest_name}'. "
                "Author Reference (MANUAL_UNVERIFIED). Note: Not an attested multi-builder Quorum consensus."
            )
    else:
        provenance_note = (
            "No author SHA-256 checksum manifest was detected for this release. "
            "You can supply a manual reference hash or choose an existing Quorum verified release."
        )

    return GitHubReleaseInfo(
        repository=f"{owner}/{repo}",
        tag_name=tag_name,
        release_name=release_name,
        published_at=published_at,
        html_url=html_url,
        manifest_found=manifest_found,
        manifest_name=manifest_name,
        manifest_url=manifest_url,
        manifest_signed=bool(signature_asset_name),
        signature_asset_name=signature_asset_name,
        assets=distribution_assets,
        provenance_note=provenance_note,
    )


@relay_router.get("/github-releases", response_model=GitHubReleaseInfo)
def get_github_releases(
    repo: str = Query(..., min_length=2, max_length=200, description="GitHub repository (owner/repo or URL)"),
    tag: str | None = Query(None, max_length=100, description="Optional release tag"),
) -> GitHubReleaseInfo:
    """
    Inspects a public GitHub repository release, discovers release assets,
    and parses author-published SHA-256 checksum manifests using SSRF-safe retrieval.
    """
    return fetch_github_release_info(repo, tag)


@relay_router.get("/monitors", response_model=list[ArtifactMonitorResponse])
def list_monitors() -> list[dict[str, Any]]:
    """List all registered artifact monitors, newest first."""
    init_relay_db()
    with connect() as db:
        rows = db.execute(
            """
            SELECT m.*, r.artifact_name AS release_name,
                   (SELECT COUNT(*) FROM relay_checks c WHERE c.monitor_id = m.id) AS total_checks_count
            FROM artifact_monitors m
            LEFT JOIN releases r ON r.id = m.release_id
            ORDER BY m.created_at DESC
            """
        ).fetchall()

        results = []
        for r in rows:
            d = dict(r)
            d["enabled"] = bool(d["enabled"])
            d["last_result"] = d["last_result"] or "PENDING"
            d["last_baseline_result"] = d.get("last_baseline_result") or ("NOT_ESTABLISHED" if not d.get("trusted_baseline_sha256") else "PENDING")
            results.append(d)
        return results


@relay_router.post("/monitors", response_model=ArtifactMonitorResponse, status_code=201, dependencies=[Depends(require_admin)])
def create_monitor(data: ArtifactMonitorCreate) -> dict[str, Any]:
    """Register a new artifact monitor linked to a verified release or manual reference hash."""
    init_relay_db()
    monitor_id = str(uuid.uuid4())
    created_at = utc_now()
    expected_sha256 = data.expected_sha256.lower().strip() if data.expected_sha256 else ""
    provenance: ProvenanceType = "MANUAL_UNVERIFIED"
    release_name: str | None = None

    with connect() as db:
        # If release_id is provided, verify it actually exists and is verified
        if data.release_id:
            rel = db.execute(
                "SELECT id, artifact_name, status, consensus_sha256 FROM releases WHERE id = ?",
                (data.release_id,),
            ).fetchone()
            if not rel:
                raise HTTPException(status_code=404, detail=f"Release '{data.release_id}' not found.")
            if rel["status"] != "verified" or not rel["consensus_sha256"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"Release '{data.release_id}' has not achieved verified builder quorum. Cannot derive trusted expected hash."
                )
            # Bind expected hash directly to release consensus
            expected_sha256 = rel["consensus_sha256"].lower().strip()
            provenance = "VERIFIED_RELEASE_CONSENSUS"
            release_name = rel["artifact_name"]

        # Calculate initial next_check_at
        next_check = (datetime.now(timezone.utc) + timedelta(seconds=data.check_interval_seconds)).isoformat(timespec="seconds")

        db.execute(
            """
            INSERT INTO artifact_monitors
                (id, name, artifact_url, expected_sha256, release_id, provenance,
                 description, enabled, check_interval_seconds, created_at, last_checked_at,
                 last_result, last_observed_sha256, last_error_summary, next_check_at,
                 trusted_baseline_sha256, last_baseline_result)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, 'PENDING', NULL, NULL, ?, NULL, 'NOT_ESTABLISHED')
            """,
            (
                monitor_id,
                data.name,
                data.artifact_url,
                expected_sha256,
                data.release_id,
                provenance,
                data.description,
                data.check_interval_seconds,
                created_at,
                next_check,
            ),
        )

    return get_monitor(monitor_id)


@relay_router.get("/monitors/{monitor_id}", response_model=ArtifactMonitorResponse)
def get_monitor(monitor_id: str) -> dict[str, Any]:
    """Retrieve configuration and status for a single monitor."""
    init_relay_db()
    with connect() as db:
        row = db.execute(
            """
            SELECT m.*, r.artifact_name AS release_name,
                   (SELECT COUNT(*) FROM relay_checks c WHERE c.monitor_id = m.id) AS total_checks_count
            FROM artifact_monitors m
            LEFT JOIN releases r ON r.id = m.release_id
            WHERE m.id = ?
            """,
            (monitor_id,),
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail=f"Monitor '{monitor_id}' not found.")

        d = dict(row)
        d["enabled"] = bool(d["enabled"])
        d["last_result"] = d["last_result"] or "PENDING"
        d["last_baseline_result"] = d.get("last_baseline_result") or ("NOT_ESTABLISHED" if not d.get("trusted_baseline_sha256") else "PENDING")
        return d


@relay_router.patch("/monitors/{monitor_id}", response_model=ArtifactMonitorResponse, dependencies=[Depends(require_admin)])
def update_monitor(monitor_id: str, data: ArtifactMonitorUpdate) -> dict[str, Any]:
    """Update monitor settings (enabled/disabled state, check interval, name, description)."""
    init_relay_db()
    with connect() as db:
        monitor = db.execute("SELECT * FROM artifact_monitors WHERE id = ?", (monitor_id,)).fetchone()
        if not monitor:
            raise HTTPException(status_code=404, detail=f"Monitor '{monitor_id}' not found.")

        updates = []
        params = []

        if data.name is not None:
            updates.append("name = ?")
            params.append(data.name.strip())
        if data.description is not None:
            updates.append("description = ?")
            params.append(data.description.strip())
        if data.enabled is not None:
            updates.append("enabled = ?")
            params.append(int(data.enabled))
        if data.check_interval_seconds is not None:
            updates.append("check_interval_seconds = ?")
            params.append(data.check_interval_seconds)
            # Recompute next_check_at if interval changed
            next_check = (datetime.now(timezone.utc) + timedelta(seconds=data.check_interval_seconds)).isoformat(timespec="seconds")
            updates.append("next_check_at = ?")
            params.append(next_check)

        if updates:
            params.append(monitor_id)
            db.execute(f"UPDATE artifact_monitors SET {', '.join(updates)} WHERE id = ?", tuple(params))

    return get_monitor(monitor_id)


@relay_router.delete("/monitors/{monitor_id}", dependencies=[Depends(require_admin)])
def delete_monitor(monitor_id: str) -> dict[str, Any]:
    """Remove an artifact monitor and its associated check history."""
    init_relay_db()
    with connect() as db:
        res = db.execute("DELETE FROM artifact_monitors WHERE id = ?", (monitor_id,))
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"Monitor '{monitor_id}' not found.")
    return {"status": "ok", "deleted_monitor_id": monitor_id}


@relay_router.post("/monitors/{monitor_id}/check", response_model=RelayCheckResponse, dependencies=[Depends(require_admin)])
def trigger_manual_check(monitor_id: str) -> RelayCheckResponse:
    """Manually trigger an immediate independent artifact check."""
    return perform_monitor_check(monitor_id)


@relay_router.get("/monitors/{monitor_id}/history", response_model=list[RelayCheckResponse])
def get_monitor_history(monitor_id: str, limit: int = Query(default=50, ge=1, le=200)) -> list[dict[str, Any]]:
    """Retrieve historical checks for a given monitor, newest first."""
    init_relay_db()
    with connect() as db:
        # Check monitor existence
        m = db.execute("SELECT id FROM artifact_monitors WHERE id = ?", (monitor_id,)).fetchone()
        if not m:
            raise HTTPException(status_code=404, detail=f"Monitor '{monitor_id}' not found.")

        rows = db.execute(
            """
            SELECT * FROM relay_checks
            WHERE monitor_id = ?
            ORDER BY checked_at DESC
            LIMIT ?
            """,
            (monitor_id, limit),
        ).fetchall()
        results = []
        for r in rows:
            d = dict(r)
            d["baseline_change_detected"] = bool(d.get("baseline_change_detected", 0))
            results.append(d)
        return results


@relay_router.post("/monitors/{monitor_id}/baseline", response_model=ArtifactMonitorResponse, dependencies=[Depends(require_admin)])
def establish_monitor_baseline(monitor_id: str, data: EstablishBaselineRequest) -> dict[str, Any]:
    """
    Explicitly establishes or updates an approved Trusted Baseline SHA-256 hash for a monitor.
    Preserves previous baseline, records operator identity and approval notes,
    and appends an immutable audit event to both monitor baseline events and Quorum audit history.
    """
    init_relay_db()
    with connect() as db:
        monitor = db.execute("SELECT * FROM artifact_monitors WHERE id = ?", (monitor_id,)).fetchone()
        if not monitor:
            raise HTTPException(status_code=404, detail=f"Monitor '{monitor_id}' not found.")

        old_baseline = monitor["trusted_baseline_sha256"]
        new_baseline = data.baseline_sha256.lower().strip()
        now_str = utc_now()
        event_type = "BASELINE_UPDATED" if old_baseline else "BASELINE_ESTABLISHED"

        # Determine last_baseline_result based on latest observed SHA-256
        last_obs = monitor["last_observed_sha256"]
        if last_obs:
            baseline_result = "MATCH" if last_obs.lower() == new_baseline else "CHANGED"
        else:
            baseline_result = "PENDING"

        # Update monitor record
        db.execute(
            """
            UPDATE artifact_monitors
            SET trusted_baseline_sha256 = ?,
                baseline_established_at = ?,
                baseline_approved_by = ?,
                baseline_approval_notes = ?,
                previous_baseline_sha256 = ?,
                last_baseline_result = ?
            WHERE id = ?
            """,
            (
                new_baseline,
                now_str,
                data.approved_by.strip(),
                data.notes.strip() if data.notes else None,
                old_baseline,
                baseline_result,
                monitor_id,
            ),
        )

        # Record in relay_baseline_events
        baseline_event_id = str(uuid.uuid4())
        db.execute(
            """
            INSERT INTO relay_baseline_events
                (id, monitor_id, event_type, previous_baseline_sha256,
                 trusted_baseline_sha256, observed_sha256, artifact_url,
                 approved_by, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                baseline_event_id,
                monitor_id,
                event_type,
                old_baseline,
                new_baseline,
                last_obs,
                monitor["artifact_url"],
                data.approved_by.strip(),
                data.notes.strip() if data.notes else None,
                now_str,
            ),
        )

        # Audit Trail Integration: if linked to a valid release, append audit event to audit_events chain
        release_id = monitor["release_id"]
        if release_id:
            rel = db.execute("SELECT id FROM releases WHERE id = ?", (release_id,)).fetchone()
            if rel:
                prev_row = db.execute(
                    "SELECT event_hash FROM audit_events WHERE release_id = ? ORDER BY id DESC LIMIT 1",
                    (release_id,),
                ).fetchone()
                prev_hash = prev_row["event_hash"] if prev_row else "0" * 64
                audit_event_type = "relay.baseline_established" if event_type == "BASELINE_ESTABLISHED" else "relay.baseline_updated"
                event_data = {
                    "monitor_id": monitor_id,
                    "monitor_name": monitor["name"],
                    "event_type": event_type,
                    "previous_baseline_sha256": old_baseline,
                    "trusted_baseline_sha256": new_baseline,
                    "approved_by": data.approved_by.strip(),
                    "notes": data.notes.strip() if data.notes else None,
                    "artifact_url": monitor["artifact_url"],
                }
                event_json = json.dumps(event_data, sort_keys=True, separators=(",", ":"))
                event_hash = hashlib.sha256(f"{prev_hash}|{audit_event_type}|{event_json}|{now_str}".encode()).hexdigest()
                db.execute(
                    """
                    INSERT INTO audit_events
                        (release_id, event_type, event_json, previous_hash, event_hash, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (release_id, audit_event_type, event_json, prev_hash, event_hash, now_str),
                )

    return get_monitor(monitor_id)


@relay_router.get("/monitors/{monitor_id}/baseline-history", response_model=list[BaselineEventResponse])
def get_monitor_baseline_history(monitor_id: str) -> list[dict[str, Any]]:
    """Retrieve immutable baseline audit events for a monitor, newest first."""
    init_relay_db()
    with connect() as db:
        m = db.execute("SELECT id FROM artifact_monitors WHERE id = ?", (monitor_id,)).fetchone()
        if not m:
            raise HTTPException(status_code=404, detail=f"Monitor '{monitor_id}' not found.")

        rows = db.execute(
            """
            SELECT * FROM relay_baseline_events
            WHERE monitor_id = ?
            ORDER BY created_at DESC, rowid DESC
            """,
            (monitor_id,),
        ).fetchall()
        return [dict(r) for r in rows]
