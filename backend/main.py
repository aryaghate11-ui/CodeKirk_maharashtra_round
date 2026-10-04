from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import sqlite3
import uuid
from collections import Counter
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, HttpUrl, model_validator

from backend import blockchain
from backend.auth import require_admin
from backend.policy import QuorumPolicy, decide
from backend.sentinel import sentinel_router, init_sentinel_db
from backend.relay import relay_router, init_relay_db, start_relay_scheduler, stop_relay_scheduler
from backend.living import (
    living_router,
    get_assessment,
    init_living_db,
    is_builder_compromised,
    list_incidents,
    reassess_all,
    reassess_release,
    verify_incident_chain,
)


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.getenv("QUORUM_DB_PATH", ROOT / "backend" / "data" / "quorum.db"))
DEMO_SOURCE_COMMIT = "e64ec7a3ad1ef8bc828fe61e1fb324cc2e74c604"
DEMO_RECIPE_SHA256 = "6cb431a152226cff3072c02dd2f6f6b187751d15452265b1b9e4cc2b3014ad10"
GOOD_ARTIFACT_SHA256 = "73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f"
BAD_ARTIFACT_SHA256 = "badd09f10e8f9315c7c9e649a535311185f922c154a2ca58048c2ba5d42277c2"
ATTESTATION_SCHEMA = "quorum.attestation.v1"
REAL_ATTESTATION_SCHEMA = "quorum.attestation.v2"
RUNTIME_BUILDER_IDS = ("local-builder", "github-actions", "gitlab-ci")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def canonical_json(value: dict) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, factory=ClosingConnection)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db() -> None:
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS builders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                operator TEXT NOT NULL,
                platform TEXT NOT NULL,
                public_key TEXT NOT NULL,
                trusted INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS builder_trust_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                builder_id TEXT NOT NULL REFERENCES builders(id),
                action TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                reason TEXT NOT NULL,
                previous_hash TEXT NOT NULL,
                event_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS releases (
                id TEXT PRIMARY KEY,
                repository_url TEXT NOT NULL,
                source_commit TEXT NOT NULL,
                artifact_name TEXT NOT NULL DEFAULT 'release-artifact',
                recipe_sha256 TEXT NOT NULL,
                candidate_sha256 TEXT NOT NULL,
                threshold INTEGER NOT NULL DEFAULT 2,
                expected_builders INTEGER NOT NULL DEFAULT 3,
                reject_on_conflict INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'pending',
                consensus_sha256 TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS attestations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
                builder_id TEXT NOT NULL REFERENCES builders(id),
                artifact_sha256 TEXT NOT NULL,
                environment TEXT NOT NULL,
                built_at TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                signature TEXT NOT NULL,
                signature_valid INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(release_id, builder_id)
            );

            CREATE TABLE IF NOT EXISTS audit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
                event_type TEXT NOT NULL,
                event_json TEXT NOT NULL,
                previous_hash TEXT NOT NULL,
                event_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS blockchain_anchors (
                release_id TEXT PRIMARY KEY REFERENCES releases(id) ON DELETE CASCADE,
                evidence_sha256 TEXT NOT NULL,
                evidence_json TEXT NOT NULL,
                release_id_hash TEXT NOT NULL,
                chain_id INTEGER NOT NULL,
                contract_address TEXT NOT NULL,
                transaction_hash TEXT NOT NULL,
                block_number INTEGER NOT NULL,
                gas_used INTEGER NOT NULL,
                submitter TEXT NOT NULL,
                anchored_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_attestations_release_id
            ON attestations(release_id);

            CREATE INDEX IF NOT EXISTS idx_audit_events_release_id
            ON audit_events(release_id, id);

            CREATE INDEX IF NOT EXISTS idx_builder_trust_events
            ON builder_trust_events(id);
            """
        )
        release_columns = {
            row["name"] for row in db.execute("PRAGMA table_info(releases)").fetchall()
        }
        if "artifact_name" not in release_columns:
            cursor = db.execute(
                "ALTER TABLE releases ADD COLUMN artifact_name TEXT NOT NULL DEFAULT 'release-artifact'"
            )
        if "expected_builders" not in release_columns:
            db.execute(
                "ALTER TABLE releases ADD COLUMN expected_builders INTEGER NOT NULL DEFAULT 3"
            )
        db.execute("PRAGMA optimize")
        db.execute('CREATE TABLE IF NOT EXISTS release_policies (release_id TEXT PRIMARY KEY REFERENCES releases(id), policy_json TEXT NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS release_recipes (release_id TEXT PRIMARY KEY REFERENCES releases(id), recipe_json TEXT NOT NULL)')
        legacy_trusted = db.execute(
            """SELECT b.id, b.public_key FROM builders b
               WHERE b.trusted = 1 AND NOT EXISTS (
                   SELECT 1 FROM builder_trust_events e WHERE e.builder_id = b.id
               )"""
        ).fetchall()
        for builder in legacy_trusted:
            append_builder_trust_event(
                db, builder["id"], "legacy-import-approved",
                hashlib.sha256(base64.b64decode(builder["public_key"])).hexdigest(),
                "Trusted identity migrated from the pre-approval registry",
            )
        init_sentinel_db(db)
        init_relay_db(db)
        init_living_db(db)


def demo_private_key(builder_id: str) -> Ed25519PrivateKey:
    seed = hashlib.sha256(f"quorum-demo-only:{builder_id}".encode()).digest()
    return Ed25519PrivateKey.from_private_bytes(seed)


def encode_public_key(key: Ed25519PublicKey) -> str:
    raw = key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return base64.b64encode(raw).decode()


def seed_demo_builders() -> None:
    builders = [
        ("northstar-ci", "Northstar CI", "Northstar", "GitHub Actions · Ubuntu 24.04"),
        ("parallax-labs", "Parallax Labs", "Parallax", "Podman · Debian 13"),
        ("local-witness", "Local Witness", "Community Witness", "Self-hosted · Fedora 43"),
    ]
    with connect() as db:
        for builder_id, name, operator, platform in builders:
            public_key = encode_public_key(demo_private_key(builder_id).public_key())
            cursor = db.execute(
                """
                INSERT OR IGNORE INTO builders
                    (id, name, operator, platform, public_key, trusted, created_at)
                VALUES (?, ?, ?, ?, ?, 1, ?)
                """,
                (builder_id, name, operator, platform, public_key, utc_now()),
            )
            if cursor.rowcount:
                append_builder_trust_event(
                    db, builder_id, "demo-seed-approved",
                    hashlib.sha256(base64.b64decode(public_key)).hexdigest(),
                    "Built-in deterministic demonstration identity",
                )


def append_builder_trust_event(
    db: sqlite3.Connection,
    builder_id: str,
    action: str,
    fingerprint: str,
    reason: str,
) -> str:
    previous = db.execute(
        "SELECT event_hash FROM builder_trust_events ORDER BY id DESC LIMIT 1"
    ).fetchone()
    previous_hash = previous["event_hash"] if previous else "0" * 64
    created_at = utc_now()
    payload = canonical_json({
        "builder_id": builder_id,
        "action": action,
        "fingerprint": fingerprint,
        "reason": reason,
    })
    event_hash = hashlib.sha256(
        f"{previous_hash}|{payload}|{created_at}".encode()
    ).hexdigest()
    db.execute(
        """INSERT INTO builder_trust_events
           (builder_id, action, fingerprint, reason, previous_hash, event_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (builder_id, action, fingerprint, reason, previous_hash, event_hash, created_at),
    )
    return event_hash


def verify_builder_trust_chain() -> dict:
    with connect() as db:
        rows = db.execute("SELECT * FROM builder_trust_events ORDER BY id").fetchall()
    previous_hash = "0" * 64
    errors = []
    for row in rows:
        payload = canonical_json({
            "builder_id": row["builder_id"], "action": row["action"],
            "fingerprint": row["fingerprint"], "reason": row["reason"],
        })
        expected = hashlib.sha256(
            f"{previous_hash}|{payload}|{row['created_at']}".encode()
        ).hexdigest()
        if row["previous_hash"] != previous_hash or row["event_hash"] != expected:
            errors.append(f"Invalid builder trust event {row['id']}")
            break
        previous_hash = expected
    return {
        "valid": not errors,
        "event_count": len(rows),
        "chain_head": previous_hash if rows else None,
        "errors": errors,
    }


def get_builder_trust_events() -> list[dict]:
    with connect() as db:
        return [dict(row) for row in db.execute(
            """SELECT builder_id, action, fingerprint, reason, previous_hash,
                      event_hash, created_at
               FROM builder_trust_events ORDER BY id"""
        ).fetchall()]


def set_builder_trust(
    builder_id: str,
    *,
    trusted: bool,
    expected_fingerprint: str,
    reason: str,
) -> dict:
    with connect() as db:
        builder = db.execute("SELECT * FROM builders WHERE id = ?", (builder_id,)).fetchone()
        if not builder:
            raise ValueError(f"Unknown builder: {builder_id}")
        actual = hashlib.sha256(base64.b64decode(builder["public_key"], validate=True)).hexdigest()
        if actual != expected_fingerprint.lower():
            raise ValueError("Builder fingerprint does not match the independently reviewed key")
        if bool(builder["trusted"]) != trusted:
            db.execute("UPDATE builders SET trusted = ? WHERE id = ?", (int(trusted), builder_id))
            append_builder_trust_event(
                db, builder_id, "approved" if trusted else "revoked", actual, reason
            )
    return next(builder for builder in list_builders() if builder["id"] == builder_id)


def append_audit_event(db: sqlite3.Connection, release_id: str, event_type: str, event: dict) -> str:
    previous = db.execute(
        "SELECT event_hash FROM audit_events WHERE release_id = ? ORDER BY id DESC LIMIT 1",
        (release_id,),
    ).fetchone()
    previous_hash = previous["event_hash"] if previous else "0" * 64
    created_at = utc_now()
    event_json = canonical_json(event)
    event_hash = hashlib.sha256(
        f"{previous_hash}|{event_type}|{event_json}|{created_at}".encode()
    ).hexdigest()
    db.execute(
        """
        INSERT INTO audit_events
            (release_id, event_type, event_json, previous_hash, event_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (release_id, event_type, event_json, previous_hash, event_hash, created_at),
    )
    return event_hash


class ReleaseCreate(BaseModel):
    repository_url: HttpUrl
    source_commit: str = Field(pattern=r"^[0-9a-f]{40}$")
    artifact_name: str = Field(default="release-artifact", min_length=1, max_length=200)
    recipe_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    candidate_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    threshold: int = Field(default=2, ge=1, le=20)
    expected_builders: int = Field(default=3, ge=1, le=20)
    reject_on_conflict: bool = True
    policy: QuorumPolicy | None = None
    recipe: dict | None = None

    @model_validator(mode='after')
    def validate_recipe_and_policy(self):
        if self.policy is None:
            QuorumPolicy(threshold=self.threshold, expected_builders=self.expected_builders,
                         minimum_operators=self.threshold, reject_on_conflict=self.reject_on_conflict)
        if self.recipe is not None:
            if hashlib.sha256(canonical_json(self.recipe).encode()).hexdigest() != self.recipe_sha256:
                raise ValueError('Recipe does not match recipe_sha256')
            for field, expected in [('source_commit', self.source_commit), ('repository_url', str(self.repository_url)), ('artifact_name', self.artifact_name)]:
                if self.recipe.get(field) != expected:
                    raise ValueError(f'Recipe {field} does not match release')
        return self


class AttestationCreate(BaseModel):
    schema_version: Literal["quorum.attestation.v1", "quorum.attestation.v2"] = ATTESTATION_SCHEMA
    builder_id: str
    artifact_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    environment: str = Field(min_length=3, max_length=200)
    built_at: str
    signature: str


class BuilderRegistrationRequest(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$")
    name: str = Field(min_length=2, max_length=100)
    operator: str = Field(min_length=2, max_length=100)
    platform: str = Field(min_length=3, max_length=200)
    public_key: str = Field(min_length=40, max_length=100)


class BuilderRegistryResponse(BaseModel):
    id: str
    name: str
    operator: str
    platform: str
    signing_key_fingerprint: str
    trusted: bool
    created_at: str
    latest_artifact_sha256: str | None
    latest_attestation_at: str | None
    latest_signature_valid: bool | None
    total_builds: int
    agreement_rate: float
    evidence_status: Literal["REGISTERED", "PENDING_APPROVAL", "APPROVED", "ATTESTED", "COMPROMISED"]
    liveness_status: Literal["UNKNOWN"] = "UNKNOWN"
    deployment_class: Literal["DEMO_IDENTITY", "LOCAL_ISOLATED", "HOSTED_RUNNER", "PHYSICALLY_INDEPENDENT"]
    independence_verified: bool
    independence_evidence: str


class TrustLayerResponse(BaseModel):
    status: str
    label: str
    reason: str
    assessed: bool


class ReleaseTrustSummaryResponse(BaseModel):
    schema_version: Literal["quorum.trust-summary.v1"] = "quorum.trust-summary.v1"
    release_id: str
    historical_status: str
    current_status: str
    installation_allowed: bool
    decision_reason: str
    overall_recommendation: Literal["INSTALL_RECOMMENDED", "REVIEW_REQUIRED", "DO_NOT_INSTALL"]
    recommendation_reason: str
    artifact_reproducibility: TrustLayerResponse
    living_verification: TrustLayerResponse
    source_sentinel: TrustLayerResponse
    relay: TrustLayerResponse
    blockchain: TrustLayerResponse


class DemoRequest(BaseModel):
    scenario: Literal["valid", "tampered", "conflict"] = "valid"


class DemoVerificationRequest(BaseModel):
    scenario: Literal["valid", "tampered", "conflict"] = "valid"
    policy: Literal["2-of-3", "3-of-3"] = "2-of-3"


class ConsumerArtifactRequest(BaseModel):
    artifact_name: str = Field(min_length=1, max_length=255)
    artifact_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class VerificationRulesResponse(BaseModel):
    signatures: bool
    matches: bool
    operators: bool
    candidate: bool
    conflicts: bool


class BuilderEvidenceResponse(BaseModel):
    id: str
    name: str
    operator: str
    platform: str
    artifact_sha256: str
    signature_valid: bool
    built_at: str
    environment: str
    attestation_schema: str
    signing_key_fingerprint: str
    signature: str
    signed_payload: dict
    evidence_digest: str


class ReleaseRecordResponse(BaseModel):
    id: str
    repository_url: str
    source_commit: str
    artifact_name: str
    recipe_sha256: str
    candidate_sha256: str
    threshold: int
    expected_builders: int
    reject_on_conflict: bool
    status: str
    consensus_sha256: str | None
    created_at: str


class AuditEventResponse(BaseModel):
    event_type: str
    event_json: str
    previous_hash: str
    event_hash: str
    created_at: str


class VerificationResponse(BaseModel):
    schema_version: Literal["quorum.api.v1"] = "quorum.api.v1"
    release_id: str
    status: Literal["verified", "rejected", "disagreement", "pending"]
    consensus_sha256: str | None
    candidate_sha256: str
    attestation_count: int
    threshold: int
    rules: VerificationRulesResponse
    builders: list[BuilderEvidenceResponse]
    audit_chain_head: str | None
    release: ReleaseRecordResponse
    audit_events: list[AuditEventResponse]


class ConsumerArtifactResponse(BaseModel):
    schema_version: Literal["quorum.api.v1"] = "quorum.api.v1"
    release_id: str
    artifact_name: str
    artifact_sha256: str
    consensus_sha256: str | None
    hash_matches: bool
    quorum_status: Literal["verified", "rejected", "disagreement", "pending"]
    decision: Literal["accepted", "rejected", "conflict", "pending"]
    reason: str
    verified_at: str
    audit_chain_head: str | None


class HealthResponse(BaseModel):
    status: Literal["ok"]
    database: Literal["sqlite"]
    mode: Literal["local"]
    api_version: Literal["v1"] = "v1"


class SystemStatsResponse(BaseModel):
    releases_verified: int
    releases_rejected: int
    conflicts_detected: int
    active_builders: int
    network: str
    contract_address: str
    consensus_health: float
    average_verification_time_seconds: float


def create_release(data: ReleaseCreate) -> dict:
    policy = data.policy or QuorumPolicy(threshold=data.threshold, expected_builders=data.expected_builders,
                                        minimum_operators=data.threshold, reject_on_conflict=data.reject_on_conflict)
    data = data.model_copy(update=dict(threshold=policy.threshold, expected_builders=policy.expected_builders,
                                      reject_on_conflict=policy.reject_on_conflict))
    release_id = str(uuid.uuid4())
    with connect() as db:
        db.execute(
            """
            INSERT INTO releases
                (id, repository_url, source_commit, artifact_name, recipe_sha256, candidate_sha256,
                 threshold, expected_builders, reject_on_conflict, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
            """,
            (
                release_id,
                str(data.repository_url),
                data.source_commit,
                data.artifact_name,
                data.recipe_sha256,
                data.candidate_sha256,
                data.threshold,
                data.expected_builders,
                int(data.reject_on_conflict),
                utc_now(),
            ),
        )
        db.execute('INSERT INTO release_policies VALUES (?, ?)', (release_id, canonical_json(policy.model_dump())))
        if data.recipe is not None:
            db.execute('INSERT INTO release_recipes VALUES (?, ?)', (release_id, canonical_json(data.recipe)))
        chain_head = append_audit_event(
            db,
            release_id,
            "release.registered",
            {
                "repository_url": str(data.repository_url),
                "source_commit": data.source_commit,
                "artifact_name": data.artifact_name,
                "recipe_sha256": data.recipe_sha256,
                "policy": policy.model_dump(),
            },
        )
    return {"id": release_id, "status": "pending", "audit_chain_head": chain_head}


def attestation_payload(release: sqlite3.Row, data: AttestationCreate) -> dict:
    if data.schema_version == REAL_ATTESTATION_SCHEMA:
        return {
            "schema_version": REAL_ATTESTATION_SCHEMA,
            "repository_url": release["repository_url"],
            "artifact_sha256": data.artifact_sha256,
            "artifact_name": release["artifact_name"],
            "builder_id": data.builder_id,
            "environment_sha256": hashlib.sha256(data.environment.encode()).hexdigest(),
            "recipe_sha256": release["recipe_sha256"],
            "source_commit": release["source_commit"],
        }
    return {
        "schema_version": ATTESTATION_SCHEMA,
        "repository_url": release["repository_url"],
        "artifact_sha256": data.artifact_sha256,
        "artifact_name": release["artifact_name"],
        "builder_id": data.builder_id,
        "built_at": data.built_at,
        "environment": data.environment,
        "environment_sha256": hashlib.sha256(data.environment.encode()).hexdigest(),
        "recipe_sha256": release["recipe_sha256"],
        "release_id": release["id"],
        "source_commit": release["source_commit"],
    }


def submit_attestation(release_id: str, data: AttestationCreate) -> dict:
    with connect() as db:
        release = db.execute("SELECT * FROM releases WHERE id = ?", (release_id,)).fetchone()
        if not release:
            raise HTTPException(status_code=404, detail="Release not found")
        builder = db.execute("SELECT * FROM builders WHERE id = ?", (data.builder_id,)).fetchone()
        if not builder or not builder["trusted"]:
            raise HTTPException(status_code=403, detail="Builder is not trusted")
        if is_builder_compromised(data.builder_id):
            raise HTTPException(
                status_code=403,
                detail="Builder is blocked by an active Living Verification compromise incident",
            )

        payload = attestation_payload(release, data)
        try:
            public_key = Ed25519PublicKey.from_public_bytes(base64.b64decode(builder["public_key"]))
            public_key.verify(base64.b64decode(data.signature), canonical_json(payload).encode())
        except (InvalidSignature, ValueError, binascii.Error):
            raise HTTPException(status_code=400, detail="Invalid builder signature") from None

        try:
            db.execute(
                """
                INSERT INTO attestations
                    (release_id, builder_id, artifact_sha256, environment, built_at,
                     payload_json, signature, signature_valid, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
                """,
                (
                    release_id,
                    data.builder_id,
                    data.artifact_sha256,
                    data.environment,
                    data.built_at,
                    canonical_json(payload),
                    data.signature,
                    utc_now(),
                ),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="Builder already attested to this release") from None

        append_audit_event(
            db,
            release_id,
            "attestation.accepted",
            {"builder_id": data.builder_id, "artifact_sha256": data.artifact_sha256},
        )
    return evaluate_release(release_id)


def evaluate_release(release_id: str) -> dict:
    with connect() as db:
        release = db.execute("SELECT * FROM releases WHERE id = ?", (release_id,)).fetchone()
        if not release:
            raise HTTPException(status_code=404, detail="Release not found")
        rows = db.execute(
            """
            SELECT a.*, b.name, b.operator, b.platform, b.public_key
            FROM attestations a
            JOIN builders b ON b.id = a.builder_id
            WHERE a.release_id = ? AND a.signature_valid = 1 AND b.trusted = 1
            ORDER BY a.id
            """,
            (release_id,),
        ).fetchall()

        for row in rows:
            try:
                payload = json.loads(row['payload_json'])
                schema = payload.get('schema_version')
                if schema not in (None, ATTESTATION_SCHEMA, REAL_ATTESTATION_SCHEMA):
                    raise ValueError('Unsupported stored attestation schema')
                required_bindings = {
                    'builder_id': row['builder_id'],
                    'artifact_sha256': row['artifact_sha256'],
                    'source_commit': release['source_commit'],
                    'recipe_sha256': release['recipe_sha256'],
                }
                if any(payload.get(field) != expected for field, expected in required_bindings.items()):
                    raise ValueError('Stored attestation binding changed')
                for field, expected in (('release_id', release['id']), ('built_at', row['built_at']),
                                        ('environment', row['environment'])):
                    if schema != REAL_ATTESTATION_SCHEMA and payload.get(field) != expected:
                        raise ValueError('Stored attestation binding changed')
                if schema is not None:
                    stored = AttestationCreate(schema_version=schema, builder_id=row['builder_id'],
                        artifact_sha256=row['artifact_sha256'], environment=row['environment'],
                        built_at=row['built_at'], signature=row['signature'])
                    if canonical_json(attestation_payload(release, stored)) != row['payload_json']:
                        raise ValueError('Stored attestation binding changed')
                Ed25519PublicKey.from_public_bytes(base64.b64decode(row['public_key'], validate=True)).verify(
                    base64.b64decode(row['signature'], validate=True), canonical_json(payload).encode())
            except (ValueError, KeyError, InvalidSignature, binascii.Error):
                raise HTTPException(status_code=409, detail='Stored attestation integrity failure') from None
        counts = Counter(row["artifact_sha256"] for row in rows)
        consensus_hash, matching = counts.most_common(1)[0] if counts else (None, 0)
        consensus_rows = [row for row in rows if row["artifact_sha256"] == consensus_hash]
        distinct_operators = len({row["operator"] for row in consensus_rows})
        has_conflict = len(counts) > 1
        candidate_matches = consensus_hash == release["candidate_sha256"] if consensus_hash else False
        signatures_valid = bool(rows) and all(row["signature_valid"] for row in rows)

        saved_policy = db.execute('SELECT policy_json FROM release_policies WHERE release_id = ?', (release_id,)).fetchone()
        policy = QuorumPolicy.model_validate_json(saved_policy[0]) if saved_policy else QuorumPolicy(
            threshold=release['threshold'], expected_builders=release['expected_builders'],
            minimum_operators=release['threshold'], reject_on_conflict=bool(release['reject_on_conflict']))
        outcome = decide([dict(row, id=row['builder_id']) for row in rows], release['candidate_sha256'], policy)
        status = outcome['status']
        previous_status = release["status"]
        db.execute(
            "UPDATE releases SET status = ?, consensus_sha256 = ? WHERE id = ?",
            (status, consensus_hash, release_id),
        )
        if status != previous_status and status != "pending":
            append_audit_event(
                db,
                release_id,
                "decision.recorded",
                {"status": status, "consensus_sha256": consensus_hash},
            )
        head = db.execute(
            "SELECT event_hash FROM audit_events WHERE release_id = ? ORDER BY id DESC LIMIT 1",
            (release_id,),
        ).fetchone()

    return {
        "release_id": release_id,
        "status": status,
        "consensus_sha256": consensus_hash,
        "candidate_sha256": release["candidate_sha256"],
        "attestation_count": len(rows),
        "threshold": release["threshold"],
        "rules": {
            "signatures": signatures_valid,
            "matches": matching >= release["threshold"],
            "operators": distinct_operators >= policy.minimum_operators,
            "candidate": candidate_matches,
            "conflicts": not has_conflict,
        },
        "builders": [
            {
                "id": row["builder_id"],
                "name": row["name"],
                "operator": row["operator"],
                "platform": row["platform"],
                "artifact_sha256": row["artifact_sha256"],
                "signature_valid": bool(row["signature_valid"]),
                "built_at": row["built_at"],
                "environment": row["environment"],
                "attestation_schema": json.loads(row["payload_json"]).get(
                    "schema_version", "quorum.attestation.legacy-v0"
                ),
                "signing_key_fingerprint": hashlib.sha256(
                    base64.b64decode(row["public_key"])
                ).hexdigest(),
                "signature": row["signature"],
                "signed_payload": json.loads(row["payload_json"]),
                "evidence_digest": hashlib.sha256(
                    f'{row["payload_json"]}|{row["signature"]}'.encode()
                ).hexdigest(),
            }
            for row in rows
        ],
        "audit_chain_head": head["event_hash"] if head else None,
    }


def get_release_record(release_id: str) -> dict:
    result = evaluate_release(release_id)
    with connect() as db:
        release = db.execute("SELECT * FROM releases WHERE id = ?", (release_id,)).fetchone()
        events = db.execute(
            "SELECT event_type, event_json, previous_hash, event_hash, created_at FROM audit_events WHERE release_id = ? ORDER BY id",
            (release_id,),
        ).fetchall()
    result["schema_version"] = "quorum.api.v1"
    result["release"] = dict(release)
    result["audit_events"] = [dict(event) for event in events]
    return result


def build_evidence_snapshot(release_id: str) -> dict:
    reassess_release(release_id)
    verification = get_release_record(release_id)
    with connect() as db:
        public_keys = {
            row["id"]: row["public_key"]
            for row in db.execute("SELECT id, public_key FROM builders").fetchall()
        }
    builders = [
        {**builder, "public_key": public_keys[builder["id"]]}
        for builder in verification["builders"]
    ]
    release = verification["release"]
    with connect() as db:
        saved = db.execute('SELECT policy_json FROM release_policies WHERE release_id = ?', (release_id,)).fetchone()
        recipe = db.execute('SELECT recipe_json FROM release_recipes WHERE release_id = ?', (release_id,)).fetchone()
    policy = json.loads(saved[0]) if saved else QuorumPolicy(threshold=release['threshold'],
        expected_builders=release['expected_builders'], minimum_operators=release['threshold'],
        reject_on_conflict=bool(release['reject_on_conflict'])).model_dump()
    return {
        "schema_version": "quorum.evidence.v1",
        "recipe": json.loads(recipe[0]) if recipe else None,
        "recipe_available": recipe is not None,
        "release": release,
        "decision": {
            "status": verification["status"],
            "consensus_sha256": verification["consensus_sha256"],
            "candidate_sha256": verification["candidate_sha256"],
            "attestation_count": verification["attestation_count"],
            "rules": verification["rules"],
        },
        "policy": policy,
        "policy_sha256": hashlib.sha256(canonical_json(policy).encode()).hexdigest(),
        "builders": builders,
        "builder_trust_events": get_builder_trust_events(),
        "builder_trust_chain": verify_builder_trust_chain(),
        "living_verification": {
            "assessment": get_assessment(release_id),
            "incidents": list_incidents(),
            "incident_chain": verify_incident_chain(),
        },
        "audit_events": verification["audit_events"],
        "audit_chain_head": verification["audit_chain_head"],
    }


def get_blockchain_anchor(release_id: str) -> dict | None:
    with connect() as db:
        row = db.execute(
            "SELECT * FROM blockchain_anchors WHERE release_id = ?", (release_id,)
        ).fetchone()
    return dict(row) if row else None


def blockchain_record_for_release(release_id: str, evidence_sha256: str) -> dict:
    """Return one canonical description of the stored and on-chain anchor state."""
    anchor = get_blockchain_anchor(release_id)
    if not anchor:
        return {"anchored": False, "on_chain_match": None, "independent_public_anchor": False}

    record: dict = {
        "anchored": True,
        "chain_id": anchor["chain_id"],
        "contract_address": anchor["contract_address"],
        "transaction_hash": anchor["transaction_hash"],
        "block_number": anchor["block_number"],
        "gas_used": anchor["gas_used"],
        "release_id_hash": anchor["release_id_hash"],
        "submitter": anchor["submitter"],
        "anchored_at": anchor["anchored_at"],
        "network": blockchain.network_name(anchor["chain_id"]),
        "anchor_scope": "public-network" if blockchain.is_public_chain(anchor["chain_id"]) else "local-or-private-network",
        "independent_public_anchor": False,
        "on_chain_match": None,
    }
    config = blockchain.load_config()
    config_matches = bool(
        config
        and config.chain_id == anchor["chain_id"]
        and config.contract_address.lower() == anchor["contract_address"].lower()
    )
    if config_matches:
        record["get_anchor_selector"] = config.get_anchor_selector
    try:
        on_chain = blockchain.read_anchor(config, release_id) if config_matches else None
        record["on_chain_match"] = bool(
            on_chain
            and on_chain["evidence_sha256"] == evidence_sha256
            and on_chain["release_id_hash"] == anchor["release_id_hash"]
        ) if config_matches else None
        record["independent_public_anchor"] = bool(
            record["on_chain_match"] and blockchain.is_public_chain(anchor["chain_id"])
        )
    except blockchain.BlockchainError:
        record["on_chain_match"] = None
    return record


def build_release_trust_summary(release_id: str) -> dict:
    """Combine every trust layer into one fail-closed release view for all clients."""
    verification = get_release_record(release_id)
    release = verification["release"]
    assessment = reassess_release(release_id)
    incident_chain = verify_incident_chain()

    living_status = assessment["current_status"]
    living_label = living_status.replace("_", " ")
    living_reason = assessment["reason"]
    if not incident_chain["valid"]:
        living_status = "INTEGRITY_FAILURE"
        living_label = "Incident chain invalid"
        living_reason = "; ".join(incident_chain["errors"]) or "Living Verification incident history failed integrity verification."

    with connect() as db:
        sentinel = db.execute(
            """
            SELECT id, risk_level, review_status, created_at
            FROM source_comparisons
            WHERE repository_url = ? AND target_commit = ?
            ORDER BY rowid DESC LIMIT 1
            """,
            (release["repository_url"], release["source_commit"]),
        ).fetchone()
        relay_rows = db.execute(
            """
            SELECT last_result, enabled, last_checked_at, last_error_summary
            FROM artifact_monitors WHERE release_id = ? ORDER BY created_at DESC
            """,
            (release_id,),
        ).fetchall()

    if sentinel:
        sentinel_status = f"{sentinel['risk_level']}_RISK"
        sentinel_layer = {
            "status": sentinel_status,
            "label": f"{sentinel['risk_level']} risk",
            "reason": f"Source Sentinel comparison {sentinel['id']} is {sentinel['review_status'].lower()}.",
            "assessed": True,
        }
    else:
        sentinel_layer = {
            "status": "NOT_ASSESSED",
            "label": "Not assessed",
            "reason": "No Source Sentinel comparison is bound to this repository and commit.",
            "assessed": False,
        }

    relay_results = [row["last_result"] or "PENDING" for row in relay_rows]
    if not relay_rows:
        relay_layer = {
            "status": "NO_MONITOR",
            "label": "No monitor",
            "reason": "No Quorum Relay monitor is bound to this release.",
            "assessed": False,
        }
    else:
        relay_status = (
            "MISMATCH" if "MISMATCH" in relay_results else
            "ERROR" if "ERROR" in relay_results else
            "PENDING" if "PENDING" in relay_results else
            "MATCH"
        )
        relay_layer = {
            "status": relay_status,
            "label": {
                "MATCH": "Distribution matches",
                "MISMATCH": "Distribution mismatch",
                "ERROR": "Monitor error",
                "PENDING": "Check pending",
            }[relay_status],
            "reason": f"{len(relay_rows)} release monitor(s); observed states: {', '.join(sorted(set(relay_results)))}.",
            "assessed": relay_status in {"MATCH", "MISMATCH"},
        }

    anchor = get_blockchain_anchor(release_id)
    blockchain_record = blockchain_record_for_release(
        release_id,
        anchor["evidence_sha256"] if anchor else "",
    )
    if not blockchain_record["anchored"]:
        blockchain_layer = {
            "status": "NOT_ANCHORED",
            "label": "Not anchored",
            "reason": "No blockchain anchor has been recorded for this release.",
            "assessed": False,
        }
    elif blockchain_record["on_chain_match"] is False:
        blockchain_layer = {
            "status": "ANCHOR_MISMATCH",
            "label": "Anchor mismatch",
            "reason": "The stored evidence does not match the configured blockchain record.",
            "assessed": True,
        }
    elif blockchain_record["on_chain_match"] is True:
        is_public = blockchain_record["anchor_scope"] == "public-network"
        blockchain_layer = {
            "status": "CONFIRMED_PUBLIC" if is_public else "CONFIRMED_LOCAL",
            "label": "Confirmed publicly" if is_public else "Confirmed on local Anvil",
            "reason": f"Evidence matches the recorded transaction on {blockchain_record['network']}.",
            "assessed": True,
        }
    else:
        blockchain_layer = {
            "status": "RECORDED_UNCONFIRMED",
            "label": "Recorded · chain unavailable",
            "reason": "An anchor receipt is stored, but the configured chain is currently unavailable for confirmation.",
            "assessed": True,
        }

    current_status = living_status
    anchor_integrity_failed = blockchain_layer["status"] == "ANCHOR_MISMATCH"
    consensus_sha256 = verification["consensus_sha256"]
    matching_builders = sum(
        1 for builder in verification["builders"]
        if consensus_sha256 and builder["artifact_sha256"] == consensus_sha256
    )
    total_builders = len(verification["builders"])
    quorum_reason = {
        "verified": f"{matching_builders} of {total_builders} signed builder results match the release artifact.",
        "disagreement": "Trusted builders produced conflicting artifact hashes.",
        "rejected": "The available signed evidence does not satisfy this release policy.",
        "pending": "More independent signed evidence is required before this release can be trusted.",
    }[verification["status"]]
    reproducibility_verified = (
        current_status == "VERIFIED"
        and verification["status"] == "verified"
        and incident_chain["valid"]
        and not anchor_integrity_failed
    )
    if not incident_chain["valid"]:
        decision_reason = living_reason
    elif anchor_integrity_failed:
        current_status = "INTEGRITY_FAILURE"
        decision_reason = blockchain_layer["reason"]
    elif current_status != verification["status"].upper():
        decision_reason = living_reason
    else:
        decision_reason = quorum_reason

    artifact_layer = {
        "status": verification["status"].upper(),
        "label": "VERIFIED" if verification["status"] == "verified" else verification["status"].upper(),
        "reason": quorum_reason,
        "assessed": True,
    }
    source_clear = bool(
        sentinel
        and sentinel["review_status"] == "APPROVED"
        and sentinel["risk_level"] in {"INFO", "LOW"}
    )
    source_blocked = bool(
        sentinel
        and (sentinel["review_status"] == "FLAGGED" or sentinel["risk_level"] in {"HIGH", "CRITICAL"})
    )
    relay_clear = relay_layer["status"] == "MATCH"
    relay_blocked = relay_layer["status"] in {"MISMATCH", "ERROR"}
    if not reproducibility_verified or source_blocked or relay_blocked:
        recommendation = "DO_NOT_INSTALL"
        recommendation_reason = (
            "Installation is blocked because a required trust check failed."
            if reproducibility_verified else decision_reason
        )
    elif not source_clear or not relay_clear:
        recommendation = "REVIEW_REQUIRED"
        missing = []
        if not source_clear:
            missing.append("source safety review")
        if not relay_clear:
            missing.append("distribution monitoring")
        recommendation_reason = f"Artifact reproducibility is verified, but {' and '.join(missing)} are incomplete."
    else:
        recommendation = "INSTALL_RECOMMENDED"
        recommendation_reason = "Reproducibility, current builder trust, source review and distribution integrity checks all pass."
    installation_allowed = recommendation == "INSTALL_RECOMMENDED"

    return {
        "schema_version": "quorum.trust-summary.v1",
        "release_id": release_id,
        "historical_status": verification["status"].upper(),
        "current_status": current_status,
        "installation_allowed": installation_allowed,
        "decision_reason": decision_reason,
        "overall_recommendation": recommendation,
        "recommendation_reason": recommendation_reason,
        "artifact_reproducibility": artifact_layer,
        "living_verification": {
            "status": living_status,
            "label": living_label,
            "reason": living_reason,
            "assessed": True,
        },
        "source_sentinel": sentinel_layer,
        "relay": relay_layer,
        "blockchain": blockchain_layer,
    }


def generate_audit_report(release_id: str) -> dict:
    anchor = get_blockchain_anchor(release_id)
    evidence = (
        json.loads(anchor["evidence_json"]) if anchor else build_evidence_snapshot(release_id)
    )
    evidence_sha256 = hashlib.sha256(canonical_json(evidence).encode()).hexdigest()
    if anchor and evidence_sha256 != anchor["evidence_sha256"]:
        raise HTTPException(status_code=500, detail="Stored evidence no longer matches its anchor")

    blockchain_record = blockchain_record_for_release(release_id, evidence_sha256)

    report = {
        "schema_version": "quorum.audit-report.v1",
        "generated_at": utc_now(),
        "release_id": release_id,
        "evidence_sha256": evidence_sha256,
        "evidence": evidence,
        "blockchain": blockchain_record,
        "offline_verification": {
            "command": "python scripts/verify_audit_report.py audit-report.json --trusted-report-key YOUR_TRUSTED_PUBLIC_KEY",
            "checks": [
                "evidence SHA-256",
                "Ed25519 builder signatures",
                "audit hash chain",
                "quorum decision replay",
            ],
        },
    }
    from backend.passport import sign_report, verify_passport
    signed = sign_report(report, DB_PATH.with_suffix('.report-key'))
    if not verify_passport(signed)['valid']:
        raise HTTPException(status_code=409, detail='Evidence integrity failure; refusing to issue passport')
    return signed


def anchor_release(release_id: str) -> dict:
    existing = get_blockchain_anchor(release_id)
    if existing:
        return generate_audit_report(release_id)

    evidence = generate_audit_report(release_id)['evidence']
    decision = evidence["decision"]["status"]
    if decision == "pending":
        raise HTTPException(status_code=409, detail="A pending release cannot be anchored")
    config = blockchain.load_config()
    if not config:
        raise HTTPException(
            status_code=503,
            detail="Blockchain is not configured. Run scripts/deploy_blockchain.py first.",
        )
    evidence_json = canonical_json(evidence)
    evidence_sha256 = hashlib.sha256(evidence_json.encode()).hexdigest()
    try:
        chain_record = blockchain.anchor_evidence(
            config,
            release_id=release_id,
            evidence_sha256=evidence_sha256,
            decision=decision,
            conflict=not evidence["decision"]["rules"]["conflicts"],
        )
    except blockchain.BlockchainError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error

    anchored_at = utc_now()
    with connect() as db:
        db.execute(
            """
            INSERT INTO blockchain_anchors
                (release_id, evidence_sha256, evidence_json, release_id_hash, chain_id,
                 contract_address, transaction_hash, block_number, gas_used, submitter, anchored_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                release_id,
                evidence_sha256,
                evidence_json,
                chain_record["release_id_hash"],
                chain_record["chain_id"],
                chain_record["contract_address"],
                chain_record["transaction_hash"],
                chain_record["block_number"],
                chain_record["gas_used"],
                chain_record["submitter"],
                anchored_at,
            ),
        )
        append_audit_event(
            db,
            release_id,
            "blockchain.evidence.anchored",
            {
                "evidence_sha256": evidence_sha256,
                "transaction_hash": chain_record["transaction_hash"],
                "block_number": chain_record["block_number"],
                "chain_id": chain_record["chain_id"],
            },
        )
    return generate_audit_report(release_id)


def run_demo_verification(
    scenario: Literal["valid", "tampered", "conflict"],
    *,
    threshold: int = 2,
    reject_on_conflict: bool = True,
) -> dict:
    candidate = BAD_ARTIFACT_SHA256 if scenario == "tampered" else GOOD_ARTIFACT_SHA256
    created = create_release(
        ReleaseCreate(
            repository_url="https://github.com/rakyll/hey",
            source_commit=DEMO_SOURCE_COMMIT,
            artifact_name="hey-linux-amd64",
            recipe_sha256=DEMO_RECIPE_SHA256,
            candidate_sha256=candidate,
            threshold=threshold,
            expected_builders=3,
            reject_on_conflict=reject_on_conflict,
        )
    )
    release_id = created["id"]
    builders = [
        ("northstar-ci", "GitHub Actions · Ubuntu 24.04"),
        ("parallax-labs", "Podman · Debian 13"),
        ("local-witness", "Self-hosted · Fedora 43"),
    ]
    for index, (builder_id, platform) in enumerate(builders):
        artifact_hash = BAD_ARTIFACT_SHA256 if scenario == "conflict" and index == 2 else GOOD_ARTIFACT_SHA256
        submit_attestation(release_id, sign_demo_attestation(release_id, builder_id, artifact_hash, platform))
    return get_release_record(release_id)


def verify_consumer_artifact(release_id: str, data: ConsumerArtifactRequest) -> dict:
    verification = get_release_record(release_id)
    consensus_hash = verification["consensus_sha256"]
    hash_matches = consensus_hash is not None and data.artifact_sha256 == consensus_hash
    release = verification["release"]

    if consensus_hash is None:
        decision = "pending"
        reason = "No builder consensus is available yet."
    elif not hash_matches:
        decision = "rejected"
        reason = "The selected file does not match the hash reproduced by the builders."
    elif verification["status"] == "disagreement":
        decision = "conflict"
        reason = "The active policy rejects disagreement between builders."
    elif verification["status"] == "rejected":
        decision = "rejected"
        reason = "The release itself was rejected by the quorum policy."
    elif verification["status"] != "verified":
        decision = "pending"
        reason = "The release has not reached a final verified quorum decision."
    elif data.artifact_sha256 != release["candidate_sha256"]:
        decision = "rejected"
        reason = "The selected file does not match the published release candidate."
    elif verification["rules"]["matches"] and verification["rules"]["operators"]:
        decision = "accepted"
        reason = "The selected file matches the independently reproduced consensus hash."
    else:
        decision = "pending"
        reason = "The file matches available evidence, but the quorum policy is not yet satisfied."

    verified_at = utc_now()
    with connect() as db:
        chain_head = append_audit_event(
            db,
            release_id,
            "consumer.artifact.verified",
            {
                "artifact_name": data.artifact_name,
                "artifact_sha256": data.artifact_sha256,
                "decision": decision,
                "hash_matches": hash_matches,
            },
        )

    return {
        "schema_version": "quorum.api.v1",
        "release_id": release_id,
        "artifact_name": data.artifact_name,
        "artifact_sha256": data.artifact_sha256,
        "consensus_sha256": consensus_hash,
        "hash_matches": hash_matches,
        "quorum_status": verification["status"],
        "decision": decision,
        "reason": reason,
        "verified_at": verified_at,
        "audit_chain_head": chain_head,
    }


def verify_system_integrity(*, runtime_only: bool = False) -> dict:
    """Verify every release independently so one corrupt record cannot hide the rest."""
    from backend.passport import verify_passport

    if runtime_only:
        release_ids = list(reversed(runtime_release_ids()))
    else:
        with connect() as db:
            release_ids = [row["id"] for row in db.execute(
                "SELECT id FROM releases ORDER BY created_at, rowid"
            ).fetchall()]

    releases = []
    for release_id in release_ids:
        try:
            report = generate_audit_report(release_id)
            result = verify_passport(report, report["report_signature"]["public_key"])
            anchor = report["blockchain"]
            releases.append({
                "release_id": release_id,
                "valid": result["valid"],
                "checks": result["checks"],
                "errors": result["errors"],
                "anchored": bool(anchor.get("anchored")),
                "on_chain_match": anchor.get("on_chain_match"),
                "independent_public_anchor": bool(anchor.get("independent_public_anchor")),
            })
        except Exception as error:
            releases.append({
                "release_id": release_id,
                "valid": False,
                "checks": {},
                "errors": [str(error) or type(error).__name__],
                "anchored": False,
                "on_chain_match": None,
                "independent_public_anchor": False,
            })

    valid_count = sum(item["valid"] for item in releases)
    externally_anchored_count = sum(item["independent_public_anchor"] for item in releases)
    builder_trust = verify_builder_trust_chain()
    living_incidents = verify_incident_chain()
    return {
        "schema_version": "quorum.system-integrity.v1",
        "checked_at": utc_now(),
        "valid": valid_count == len(releases) and builder_trust["valid"] and living_incidents["valid"],
        "release_count": len(releases),
        "valid_release_count": valid_count,
        "externally_anchored_count": externally_anchored_count,
        "external_anchoring_complete": bool(releases) and externally_anchored_count == len(releases),
        "scope": "Local signed evidence and audit chains; public anchoring is reported separately.",
        "builder_trust_chain": builder_trust,
        "living_incident_chain": living_incidents,
        "releases": releases,
    }


def runtime_release_ids() -> list[str]:
    """Return releases backed only by the three deployable builder identities.

    A newly created challenge has no attestations and remains visible as PENDING.
    Attack Lab/demo fixture releases disappear from normal product APIs as soon as
    their synthetic attestations are added.
    """
    placeholders = ",".join("?" for _ in RUNTIME_BUILDER_IDS)
    with connect() as db:
        return [row["id"] for row in db.execute(
            f"""
            SELECT r.id FROM releases r
            WHERE NOT EXISTS (
                SELECT 1 FROM attestations a
                WHERE a.release_id = r.id AND a.builder_id NOT IN ({placeholders})
            )
            ORDER BY r.created_at DESC, r.rowid DESC
            """,
            RUNTIME_BUILDER_IDS,
        ).fetchall()]


def get_system_stats(*, runtime_only: bool = False) -> dict:
    with connect() as db:
        release_filter = runtime_release_ids() if runtime_only else None
        if release_filter is not None:
            if release_filter:
                placeholders = ",".join("?" for _ in release_filter)
                count_rows = db.execute(
                    f"SELECT status, COUNT(*) AS count FROM releases WHERE id IN ({placeholders}) GROUP BY status",
                    release_filter,
                ).fetchall()
            else:
                count_rows = []
        else:
            count_rows = db.execute(
                "SELECT status, COUNT(*) AS count FROM releases GROUP BY status"
            ).fetchall()
        release_counts = {
            row["status"]: row["count"]
            for row in count_rows
        }
        if runtime_only:
            active_builders = db.execute(
                "SELECT COUNT(*) AS count FROM builders WHERE trusted = 1 AND id IN (?, ?, ?)",
                RUNTIME_BUILDER_IDS,
            ).fetchone()["count"]
        else:
            active_builders = db.execute(
                "SELECT COUNT(*) AS count FROM builders WHERE trusted = 1"
            ).fetchone()["count"]
    completed = sum(
        release_counts.get(status, 0)
        for status in ("verified", "rejected", "disagreement")
    )
    consensus_health = (
        round(release_counts.get("verified", 0) * 100 / completed, 1)
        if completed
        else 100.0
    )
    blockchain_config = blockchain.load_config()
    return {
        "releases_verified": release_counts.get("verified", 0),
        "releases_rejected": release_counts.get("rejected", 0),
        "conflicts_detected": release_counts.get("disagreement", 0),
        "active_builders": active_builders,
        "network": blockchain.network_name(blockchain_config.chain_id) if blockchain_config else "Local verifier",
        "contract_address": blockchain_config.contract_address if blockchain_config else "Not configured",
        "consensus_health": consensus_health,
        "average_verification_time_seconds": 0.0,
    }


def register_builder(data: BuilderRegistrationRequest) -> dict:
    try:
        public_key_raw = base64.b64decode(data.public_key, validate=True)
        if len(public_key_raw) != 32:
            raise ValueError
        Ed25519PublicKey.from_public_bytes(public_key_raw)
    except (ValueError, binascii.Error):
        raise HTTPException(status_code=422, detail="public_key must be a base64 Ed25519 public key") from None

    with connect() as db:
        existing = db.execute(
            "SELECT public_key, operator FROM builders WHERE id = ?", (data.id,)
        ).fetchone()
        if existing and existing["public_key"] != data.public_key:
            raise HTTPException(
                status_code=409,
                detail="Builder id is already bound to a different signing key",
            )
        if existing and existing['operator'] != data.operator:
            raise HTTPException(status_code=409, detail='Builder operator identity is immutable')
        duplicate = db.execute('SELECT id FROM builders WHERE public_key = ? AND id != ?', (data.public_key, data.id)).fetchone()
        if duplicate:
            raise HTTPException(status_code=409, detail='Signing key is already registered to another builder')
        cursor = db.execute(
            """
            INSERT INTO builders (id, name, operator, platform, public_key, trusted, created_at)
            VALUES (?, ?, ?, ?, ?, 0, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                operator = excluded.operator,
                platform = excluded.platform
            """,
            (data.id, data.name, data.operator, data.platform, data.public_key, utc_now()),
        )
        if cursor.rowcount and not existing:
            append_builder_trust_event(
                db, data.id, "registered-pending", hashlib.sha256(public_key_raw).hexdigest(),
                "Registration does not grant trust",
            )
    return next(builder for builder in list_builders() if builder["id"] == data.id)


def list_builders(*, runtime_only: bool = False) -> list[dict]:
    with connect() as db:
        where = "WHERE b.id IN (?, ?, ?)" if runtime_only else ""
        params = RUNTIME_BUILDER_IDS if runtime_only else ()
        rows = db.execute(
            f"""
            SELECT
                b.*,
                (SELECT a.artifact_sha256 FROM attestations a
                 WHERE a.builder_id = b.id ORDER BY a.id DESC LIMIT 1) AS latest_artifact_sha256,
                (SELECT a.built_at FROM attestations a
                 WHERE a.builder_id = b.id ORDER BY a.id DESC LIMIT 1) AS latest_attestation_at,
                (SELECT a.signature_valid FROM attestations a
                 WHERE a.builder_id = b.id ORDER BY a.id DESC LIMIT 1) AS latest_signature_valid,
                (SELECT COUNT(*) FROM attestations a WHERE a.builder_id = b.id) AS total_builds,
                (SELECT COUNT(*) FROM attestations a
                 JOIN releases r ON r.id = a.release_id
                 WHERE a.builder_id = b.id
                   AND r.consensus_sha256 IS NOT NULL
                   AND a.artifact_sha256 = r.consensus_sha256) AS matching_builds
            FROM builders b
            {where}
            ORDER BY b.created_at, b.id
            """,
            params,
        ).fetchall()
    builders = []
    for row in rows:
        total_builds = row["total_builds"]
        compromised = is_builder_compromised(row["id"])
        if compromised:
            evidence_status = "COMPROMISED"
        elif not row["trusted"]:
            evidence_status = "PENDING_APPROVAL"
        elif total_builds:
            evidence_status = "ATTESTED"
        else:
            evidence_status = "APPROVED"
        if row["id"] in {"northstar-ci", "parallax-labs", "local-witness"}:
            deployment_class = "DEMO_IDENTITY"
            independence_evidence = "Seeded demonstration identity; no physical independence claim."
        elif row["id"] in {"github-actions", "gitlab-ci"} or "hosted-runner" in row["platform"].lower():
            deployment_class = "HOSTED_RUNNER"
            independence_evidence = "Signed evidence reports an independently operated hosted CI runner."
        else:
            deployment_class = "LOCAL_ISOLATED"
            independence_evidence = "Separate key/workspace evidence only; physical-device and operator independence are unverified."
        builders.append(
            {
                "id": row["id"],
                "name": row["name"],
                "operator": row["operator"],
                "platform": row["platform"],
                "signing_key_fingerprint": hashlib.sha256(
                    base64.b64decode(row["public_key"])
                ).hexdigest(),
                "trusted": bool(row["trusted"]),
                "created_at": row["created_at"],
                "latest_artifact_sha256": row["latest_artifact_sha256"],
                "latest_attestation_at": row["latest_attestation_at"],
                "latest_signature_valid": bool(row["latest_signature_valid"])
                if row["latest_signature_valid"] is not None else None,
                "total_builds": total_builds,
                "agreement_rate": round(row["matching_builds"] * 100 / total_builds, 1)
                if total_builds
                else 0.0,
                "evidence_status": evidence_status,
                "liveness_status": "UNKNOWN",
                "deployment_class": deployment_class,
                "independence_verified": False,
                "independence_evidence": independence_evidence,
            }
        )
    return builders


def sign_demo_attestation(release_id: str, builder_id: str, artifact_hash: str, platform: str) -> AttestationCreate:
    seed_demo_builders()
    with connect() as db:
        release = db.execute("SELECT * FROM releases WHERE id = ?", (release_id,)).fetchone()
    built_at = utc_now()
    unsigned = AttestationCreate(
        builder_id=builder_id,
        artifact_sha256=artifact_hash,
        environment=platform,
        built_at=built_at,
        signature="pending",
    )
    signature = demo_private_key(builder_id).sign(canonical_json(attestation_payload(release, unsigned)).encode())
    return unsigned.model_copy(update={"signature": base64.b64encode(signature).decode()})


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    reassess_all()
    start_relay_scheduler()
    try:
        yield
    finally:
        stop_relay_scheduler()


app = FastAPI(title="Quorum Verification API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:8000",
        "http://localhost:8000",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-Quorum-Admin-Token"],
)
app.include_router(sentinel_router)
app.include_router(relay_router)
app.include_router(living_router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "database": "sqlite", "mode": "local", "api_version": "v1"}


@app.get("/api/v1/health", response_model=HealthResponse)
def health_v1() -> dict:
    return health()


@app.get("/api/v1/auth/status")
def auth_status_v1() -> dict:
    return {"admin_token_required": True, "header": "X-Quorum-Admin-Token"}


@app.post("/api/v1/auth/verify", dependencies=[Depends(require_admin)])
def verify_admin_access_v1() -> dict:
    return {"authorized": True, "role": "ADMIN"}


@app.get("/api/v1/stats", response_model=SystemStatsResponse)
def system_stats_v1() -> dict:
    return get_system_stats(runtime_only=True)


@app.get("/api/v1/blockchain/status")
def blockchain_status_v1() -> dict:
    return blockchain.status()


@app.get("/api/v1/builders", response_model=list[BuilderRegistryResponse])
def builders_v1() -> list[dict]:
    return list_builders(runtime_only=True)


@app.post("/api/v1/builders", response_model=BuilderRegistryResponse, status_code=201, dependencies=[Depends(require_admin)])
def register_builder_v1(data: BuilderRegistrationRequest) -> dict:
    if data.id not in RUNTIME_BUILDER_IDS:
        raise HTTPException(
            status_code=422,
            detail=f"Runtime builder id must be one of: {', '.join(RUNTIME_BUILDER_IDS)}",
        )
    return register_builder(data)


@app.post("/api/v1/releases", status_code=201, dependencies=[Depends(require_admin)])
def register_release_v1(data: ReleaseCreate) -> dict:
    return create_release(data)


@app.post("/api/v1/releases/{release_id}/attestations", status_code=201)
def register_attestation_v1(release_id: str, data: AttestationCreate) -> dict:
    return submit_attestation(release_id, data)


@app.post("/api/releases", status_code=201, dependencies=[Depends(require_admin)])
def register_release(data: ReleaseCreate) -> dict:
    return create_release(data)


@app.post("/api/releases/{release_id}/attestations", status_code=201)
def register_attestation(release_id: str, data: AttestationCreate) -> dict:
    return submit_attestation(release_id, data)


@app.get("/api/releases/{release_id}")
def release_details(release_id: str) -> dict:
    return get_release_record(release_id)


@app.post("/api/demo/verify")
def demo_verify(data: DemoRequest) -> dict:
    return run_demo_verification(data.scenario)


@app.post("/api/v1/demo/verify", response_model=VerificationResponse)
def demo_verify_v1(data: DemoVerificationRequest) -> dict:
    threshold = 2 if data.policy == "2-of-3" else 3
    return run_demo_verification(
        data.scenario,
        threshold=threshold,
        reject_on_conflict=False,
    )


@app.get("/api/v1/releases", response_model=list[VerificationResponse])
def list_releases_v1() -> list[dict]:
    release_ids = runtime_release_ids()[:50]
    return [get_release_record(release_id) for release_id in release_ids]


@app.get("/api/v1/releases/{release_id}", response_model=VerificationResponse)
def release_details_v1(release_id: str) -> dict:
    return get_release_record(release_id)


@app.get("/api/v1/releases/{release_id}/audit-events", response_model=list[AuditEventResponse])
def audit_events_v1(release_id: str) -> list[dict]:
    return get_release_record(release_id)["audit_events"]


@app.get("/api/v1/releases/{release_id}/audit-report")
def audit_report_v1(release_id: str) -> JSONResponse:
    report = generate_audit_report(release_id)
    return JSONResponse(
        content=report,
        headers={
            "Content-Disposition": f'attachment; filename="quorum-audit-{release_id}.json"'
        },
    )


@app.get(
    "/api/v1/releases/{release_id}/trust-summary",
    response_model=ReleaseTrustSummaryResponse,
)
def release_trust_summary_v1(release_id: str) -> dict:
    return build_release_trust_summary(release_id)


@app.post("/api/v1/releases/{release_id}/anchor", dependencies=[Depends(require_admin)])
def anchor_release_v1(release_id: str) -> dict:
    return anchor_release(release_id)


@app.post(
    "/api/v1/releases/{release_id}/consumer-verifications",
    response_model=ConsumerArtifactResponse,
)
def consumer_artifact_verification(release_id: str, data: ConsumerArtifactRequest) -> dict:
    return verify_consumer_artifact(release_id, data)


@app.post('/api/v1/releases/{release_id}/evaluate')
def evaluate_policy_v1(release_id: str, policy: QuorumPolicy) -> dict:
    evidence = build_evidence_snapshot(release_id)
    result = decide(evidence['builders'], evidence['release']['candidate_sha256'], policy)
    with connect() as db:
        append_audit_event(db, release_id, 'policy.evaluated', {'policy': policy.model_dump(), 'decision': result})
    return {'release_id': release_id, 'policy': policy.model_dump(), **result,
            'scope': 'Consumer evaluation; original release policy is unchanged'}


@app.get('/api/v1/releases/{release_id}/integrity')
def integrity_v1(release_id: str) -> dict:
    from backend.passport import verify_passport
    report = generate_audit_report(release_id)
    result = verify_passport(report, report['report_signature']['public_key'])
    return {**result, 'scope': 'Current backend snapshot, not an external checkpoint',
            'report_public_key': report['report_signature']['public_key']}


@app.get('/api/v1/integrity')
def system_integrity_v1() -> dict:
    return verify_system_integrity(runtime_only=True)


class AttackRequest(BaseModel):
    scenario: Literal['valid', 'modified-candidate', 'conflicting-output', 'invalid-signature',
                      'unknown-builder', 'wrong-commit', 'replay', 'modified-report']
    policy: QuorumPolicy = Field(default_factory=QuorumPolicy)


@app.post('/api/v1/attack-lab/run')
def attack_lab_v1(data: AttackRequest) -> dict:
    from backend.passport import verify_passport
    seed_demo_builders()
    clean = hashlib.sha256(b'Quorum attack-lab fixture v1').hexdigest()
    altered = hashlib.sha256(b'Quorum attack-lab fixture v1\x00injected').hexdigest()
    created = create_release(ReleaseCreate(repository_url='https://github.com/rakyll/hey',
        source_commit=DEMO_SOURCE_COMMIT, artifact_name='attack-lab-fixture',
        recipe_sha256=DEMO_RECIPE_SHA256,
        candidate_sha256=altered if data.scenario == 'modified-candidate' else clean,
        policy=data.policy))
    release_id = created['id']
    observed = []
    expected_errors = {'invalid-signature': 400, 'unknown-builder': 403, 'wrong-commit': 400, 'replay': 409}
    for index, builder_id in enumerate(('northstar-ci', 'parallax-labs', 'local-witness')):
        digest = altered if data.scenario == 'conflicting-output' and index == 2 else clean
        signed = sign_demo_attestation(release_id, builder_id, digest, 'Attack Lab fixture (not a source build)')
        if index == 2:
            if data.scenario == 'invalid-signature':
                signed = signed.model_copy(update={'signature': base64.b64encode(bytes(64)).decode()})
            elif data.scenario == 'unknown-builder':
                signed = signed.model_copy(update={'builder_id': 'unregistered-attacker'})
            elif data.scenario == 'wrong-commit':
                with connect() as db:
                    release = dict(db.execute('SELECT * FROM releases WHERE id = ?', (release_id,)).fetchone())
                release['source_commit'] = '0' * 40
                payload = attestation_payload(release, signed)
                signed = signed.model_copy(update={'signature': base64.b64encode(demo_private_key(builder_id).sign(canonical_json(payload).encode())).decode()})
        try:
            submit_attestation(release_id, signed)
            if data.scenario == 'replay' and index == 2:
                submit_attestation(release_id, signed)
        except HTTPException as error:
            observed.append({'builder_id': signed.builder_id, 'status_code': error.status_code, 'reason': error.detail})
    verification = get_release_record(release_id)
    report_check = None
    if data.scenario == 'modified-report':
        report = generate_audit_report(release_id)
        report['evidence']['audit_events'].pop()
        report['evidence_sha256'] = hashlib.sha256(canonical_json(report['evidence']).encode()).hexdigest()
        report_check = verify_passport(report, report['report_signature']['public_key'])
    expected = expected_errors.get(data.scenario)
    if expected:
        passed = any(item['status_code'] == expected for item in observed)
    elif report_check is not None:
        passed = not report_check['valid']
    elif data.scenario == 'valid':
        passed = verification['status'] == 'verified'
    elif data.scenario == 'modified-candidate':
        passed = verification['status'] == 'rejected'
    else:
        passed = not verification['rules']['conflicts'] and (not data.policy.reject_on_conflict or verification['status'] == 'disagreement')
    with connect() as db:
        append_audit_event(db, release_id, 'attack.exercise', {'scenario': data.scenario, 'observed_rejections': observed, 'passed': passed})
    return {'scenario': data.scenario, 'passed': passed, 'observed_rejections': observed,
            'report_check': report_check, 'verification': get_release_record(release_id),
            'evidence_mode': 'Synthetic artifact bytes; real SHA-256, Ed25519, API admission checks and policy engine. No source compilation in this exercise.'}


app.mount("/", StaticFiles(directory=ROOT / "dist", html=True), name="frontend")

