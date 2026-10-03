from __future__ import annotations

import base64
import hashlib
import json
import os
import sqlite3
import uuid
from collections import Counter
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, HttpUrl


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.getenv("QUORUM_DB_PATH", ROOT / "backend" / "data" / "quorum.db"))
DEMO_SOURCE_COMMIT = "e64ec7a3ad1ef8bc828fe61e1fb324cc2e74c604"
DEMO_RECIPE_SHA256 = "6cb431a152226cff3072c02dd2f6f6b187751d15452265b1b9e4cc2b3014ad10"
GOOD_ARTIFACT_SHA256 = "73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f"
BAD_ARTIFACT_SHA256 = "badd09f10e8f9315c7c9e649a535311185f922c154a2ca58048c2ba5d42277c2"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def canonical_json(value: dict) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


@contextmanager
def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


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
                trusted INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS releases (
                id TEXT PRIMARY KEY,
                repository_url TEXT NOT NULL,
                source_commit TEXT NOT NULL,
                recipe_sha256 TEXT NOT NULL,
                candidate_sha256 TEXT NOT NULL,
                threshold INTEGER NOT NULL DEFAULT 2,
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

            CREATE INDEX IF NOT EXISTS idx_attestations_release_id
            ON attestations(release_id);

            CREATE INDEX IF NOT EXISTS idx_audit_events_release_id
            ON audit_events(release_id, id);
            """
        )
        db.execute("PRAGMA optimize")
    seed_demo_builders()


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
            db.execute(
                """
                INSERT OR IGNORE INTO builders
                    (id, name, operator, platform, public_key, trusted, created_at)
                VALUES (?, ?, ?, ?, ?, 1, ?)
                """,
                (builder_id, name, operator, platform, public_key, utc_now()),
            )


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
    recipe_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    candidate_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    threshold: int = Field(default=2, ge=1, le=20)
    reject_on_conflict: bool = True


class AttestationCreate(BaseModel):
    builder_id: str
    artifact_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    environment: str = Field(min_length=3, max_length=200)
    built_at: str
    signature: str


class DemoRequest(BaseModel):
    scenario: Literal["valid", "tampered", "conflict"] = "valid"


def create_release(data: ReleaseCreate) -> dict:
    release_id = str(uuid.uuid4())
    with connect() as db:
        db.execute(
            """
            INSERT INTO releases
                (id, repository_url, source_commit, recipe_sha256, candidate_sha256,
                 threshold, reject_on_conflict, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
            """,
            (
                release_id,
                str(data.repository_url),
                data.source_commit,
                data.recipe_sha256,
                data.candidate_sha256,
                data.threshold,
                int(data.reject_on_conflict),
                utc_now(),
            ),
        )
        chain_head = append_audit_event(
            db,
            release_id,
            "release.registered",
            {"repository_url": str(data.repository_url), "source_commit": data.source_commit},
        )
    return {"id": release_id, "status": "pending", "audit_chain_head": chain_head}


def attestation_payload(release: sqlite3.Row, data: AttestationCreate) -> dict:
    return {
        "artifact_sha256": data.artifact_sha256,
        "builder_id": data.builder_id,
        "built_at": data.built_at,
        "environment": data.environment,
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

        payload = attestation_payload(release, data)
        try:
            public_key = Ed25519PublicKey.from_public_bytes(base64.b64decode(builder["public_key"]))
            public_key.verify(base64.b64decode(data.signature), canonical_json(payload).encode())
        except (InvalidSignature, ValueError):
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
        if not release and release_id in ("rel-hey-01", "latest", "demo"):
            release = db.execute("SELECT * FROM releases ORDER BY created_at DESC LIMIT 1").fetchone()
            if release:
                release_id = release["id"]
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

        counts = Counter(row["artifact_sha256"] for row in rows)
        consensus_hash, matching = counts.most_common(1)[0] if counts else (None, 0)
        consensus_rows = [row for row in rows if row["artifact_sha256"] == consensus_hash]
        distinct_operators = len({row["operator"] for row in consensus_rows})
        has_conflict = len(counts) > 1
        candidate_matches = consensus_hash == release["candidate_sha256"] if consensus_hash else False

        if len(rows) < release["threshold"]:
            status = "pending"
        elif has_conflict and release["reject_on_conflict"]:
            status = "disagreement"
        elif not candidate_matches:
            status = "rejected"
        elif matching >= release["threshold"] and distinct_operators >= release["threshold"]:
            status = "verified"
        else:
            status = "pending"

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
            "matches": matching >= release["threshold"],
            "operators": distinct_operators >= release["threshold"],
            "candidate": candidate_matches,
            "conflicts": not has_conflict,
        },
        "builders": [
            {
                "id": row["builder_id"],
                "name": row["name"],
                "operator": row["operator"],
                "platform": row["platform"],
                "public_key": row["public_key"],
                "artifact_sha256": row["artifact_sha256"],
                "signature": row["signature"],
                "signature_valid": bool(row["signature_valid"]),
                "built_at": row["built_at"],
            }
            for row in rows
        ],
        "audit_chain_head": head["event_hash"] if head else None,
    }


def get_release_record(release_id: str) -> dict:
    with connect() as db:
        release = db.execute("SELECT * FROM releases WHERE id = ?", (release_id,)).fetchone()
        if not release and release_id in ("rel-hey-01", "latest", "demo"):
            release = db.execute("SELECT * FROM releases ORDER BY created_at DESC LIMIT 1").fetchone()
            if release:
                release_id = release["id"]
    result = evaluate_release(release_id)
    with connect() as db:
        release = db.execute("SELECT * FROM releases WHERE id = ?", (release_id,)).fetchone()
        events = db.execute(
            "SELECT event_type, event_json, previous_hash, event_hash, created_at FROM audit_events WHERE release_id = ? ORDER BY id",
            (release_id,),
        ).fetchall()
    result["release"] = dict(release)
    result["audit_events"] = [dict(event) for event in events]
    return result


def sign_demo_attestation(release_id: str, builder_id: str, artifact_hash: str, platform: str) -> AttestationCreate:
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


DEMO_PACKAGES = [
    {
        "name": "hey",
        "repository_url": "https://github.com/rakyll/hey",
        "source_commit": DEMO_SOURCE_COMMIT,
        "recipe_sha256": DEMO_RECIPE_SHA256,
        "candidate_sha256": GOOD_ARTIFACT_SHA256,
    },
    {
        "name": "pebble",
        "repository_url": "https://github.com/cockroachdb/pebble",
        "source_commit": "9e382fa14c7d8129e0018f62a4d91384017bb320",
        "recipe_sha256": "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
        "candidate_sha256": "91ac82e8f192b0c441a980753d08154e1933ba20ef41680199d74e0d9b431718",
    },
    {
        "name": "etcd",
        "repository_url": "https://github.com/etcd-io/etcd",
        "source_commit": "8f23abc91054ed4a29c118742ba601934e81fa02",
        "recipe_sha256": "81928374619d83719001928347101928374a20f9182938471029384710293847",
        "candidate_sha256": "61a80c949182374e019283471829012398471029384710293847102938471029",
    },
    {
        "name": "moby",
        "repository_url": "https://github.com/moby/moby",
        "source_commit": "3b490a887e14d238f94cb41829e1628ca9401732",
        "recipe_sha256": "3b490a887e14d238f94cb41829e1628ca94017329182374619d8371900192834",
        "candidate_sha256": "badd09f1901829384710293847102938471029384710293847102938471077c2",
    },
]


def seed_demo_packages() -> None:
    for pkg in DEMO_PACKAGES:
        release_id: str | None = None
        with connect() as db:
            existing = db.execute(
                "SELECT id FROM releases WHERE repository_url = ? AND source_commit = ?",
                (pkg["repository_url"], pkg["source_commit"]),
            ).fetchone()
            if existing:
                continue

            release_id = str(uuid.uuid4())
            db.execute(
                """
                INSERT INTO releases
                    (id, repository_url, source_commit, recipe_sha256, candidate_sha256,
                     threshold, reject_on_conflict, status, created_at)
                VALUES (?, ?, ?, ?, ?, 2, 1, 'pending', ?)
                """,
                (
                    release_id,
                    pkg["repository_url"],
                    pkg["source_commit"],
                    pkg["recipe_sha256"],
                    pkg["candidate_sha256"],
                    utc_now(),
                ),
            )
            append_audit_event(
                db,
                release_id,
                "release.registered",
                {"repository_url": pkg["repository_url"], "source_commit": pkg["source_commit"]},
            )

        if not release_id:
            continue

        builders = [
            ("northstar-ci", "GitHub Actions · Ubuntu 24.04"),
            ("parallax-labs", "Podman · Debian 13"),
            ("local-witness", "Self-hosted · Fedora 43"),
        ]
        for builder_id, platform in builders:
            artifact_hash = pkg["candidate_sha256"]
            att = sign_demo_attestation(release_id, builder_id, artifact_hash, platform)
            submit_attestation(release_id, att)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    seed_demo_packages()
    yield


app = FastAPI(title="Quorum Verification API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:8000",
        "http://localhost:8000",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "database": "sqlite", "mode": "local"}


@app.get("/api/stats")
def system_stats() -> dict:
    with connect() as db:
        total_releases = db.execute("SELECT COUNT(*) FROM releases").fetchone()[0]
        verified_count = db.execute("SELECT COUNT(*) FROM releases WHERE status = 'verified'").fetchone()[0]
        rejected_count = db.execute("SELECT COUNT(*) FROM releases WHERE status = 'rejected'").fetchone()[0]
        conflict_count = db.execute("SELECT COUNT(*) FROM releases WHERE status = 'disagreement'").fetchone()[0]
        active_builders = db.execute("SELECT COUNT(*) FROM builders WHERE trusted = 1").fetchone()[0]

    consensus_health = round((verified_count / total_releases * 100) if total_releases > 0 else 100, 1)
    return {
        "releasesVerified": verified_count,
        "releasesRejected": rejected_count,
        "conflictsDetected": conflict_count,
        "activeBuilders": active_builders,
        "network": "Quorum Local Cluster",
        "contractAddress": "0x0000000000000000000000000000000000000000",
        "consensusHealth": consensus_health,
        "averageVerificationTimeSeconds": 1.2,
        "isBackendConnected": True,
        "backendLatencyMs": None,
    }


@app.get("/api/builders")
def list_builders() -> list[dict]:
    with connect() as db:
        rows = db.execute(
            "SELECT id, name, operator, platform, public_key, trusted, created_at FROM builders ORDER BY id"
        ).fetchall()
        builders = [dict(row) for row in rows]
        for b in builders:
            att = db.execute(
                "SELECT artifact_sha256, created_at FROM attestations WHERE builder_id = ? ORDER BY id DESC LIMIT 1",
                (b["id"],),
            ).fetchone()
            b["last_artifact_sha256"] = att["artifact_sha256"] if att else None
            b["latest_attestation_time"] = att["created_at"] if att else None
            b["total_builds"] = db.execute(
                "SELECT COUNT(*) FROM attestations WHERE builder_id = ?", (b["id"],)
            ).fetchone()[0]
    return builders


@app.get("/api/releases")
def list_releases() -> list[dict]:
    with connect() as db:
        rows = db.execute(
            """
            SELECT id FROM releases
            WHERE id IN (
                SELECT id FROM (
                    SELECT id, repository_url, source_commit, MAX(created_at)
                    FROM releases
                    GROUP BY repository_url, source_commit
                )
            )
            ORDER BY created_at DESC
            """
        ).fetchall()
    if not rows:
        return []
    return [get_release_record(r["id"]) for r in rows]


@app.post("/api/releases", status_code=201)
def register_release(data: ReleaseCreate) -> dict:
    return create_release(data)


@app.post("/api/releases/{release_id}/attestations", status_code=201)
def register_attestation(release_id: str, data: AttestationCreate) -> dict:
    return submit_attestation(release_id, data)


@app.get("/api/releases/{release_id}")
def release_details(release_id: str) -> dict:
    return get_release_record(release_id)


@app.get("/api/releases/{release_id}/audit-events")
def release_audit_events(release_id: str) -> list[dict]:
    record = get_release_record(release_id)
    return record.get("audit_events", [])


@app.get("/api/releases/{release_id}/audit")
def release_audit(release_id: str) -> dict:
    return get_release_record(release_id)


@app.post("/api/demo/verify")
def demo_verify(data: DemoRequest) -> dict:
    candidate = BAD_ARTIFACT_SHA256 if data.scenario == "tampered" else GOOD_ARTIFACT_SHA256
    created = create_release(
        ReleaseCreate(
            repository_url="https://github.com/rakyll/hey",
            source_commit=DEMO_SOURCE_COMMIT,
            recipe_sha256=DEMO_RECIPE_SHA256,
            candidate_sha256=candidate,
            threshold=2,
            reject_on_conflict=True,
        )
    )
    release_id = created["id"]
    builders = [
        ("northstar-ci", "GitHub Actions · Ubuntu 24.04"),
        ("parallax-labs", "Podman · Debian 13"),
        ("local-witness", "Self-hosted · Fedora 43"),
    ]
    for index, (builder_id, platform) in enumerate(builders):
        artifact_hash = BAD_ARTIFACT_SHA256 if data.scenario == "conflict" and index == 2 else GOOD_ARTIFACT_SHA256
        submit_attestation(release_id, sign_demo_attestation(release_id, builder_id, artifact_hash, platform))
    return get_release_record(release_id)


app.mount("/", StaticFiles(directory=ROOT / "dist", html=True), name="frontend")

