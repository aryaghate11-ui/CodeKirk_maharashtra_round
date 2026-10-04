"""Living Verification: re-evaluate historical releases as builder trust changes."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from backend.policy import QuorumPolicy, decide


living_router = APIRouter(prefix="/api/v1/living", tags=["living-verification"])


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def canonical_json(value: dict[str, Any]) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def connect() -> sqlite3.Connection:
    from backend import main

    return main.connect()


def init_living_db(db: sqlite3.Connection | None = None) -> None:
    owns_connection = db is None
    connection = db or connect()
    try:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS living_incidents (
                id TEXT PRIMARY KEY,
                builder_id TEXT NOT NULL REFERENCES builders(id),
                action TEXT NOT NULL CHECK(action IN ('COMPROMISED', 'REINSTATED')),
                reason TEXT NOT NULL,
                effective_from TEXT,
                created_at TEXT NOT NULL,
                previous_hash TEXT NOT NULL,
                event_hash TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS living_release_assessments (
                release_id TEXT PRIMARY KEY REFERENCES releases(id) ON DELETE CASCADE,
                historical_status TEXT NOT NULL,
                current_status TEXT NOT NULL,
                recalculated_status TEXT NOT NULL,
                latest_incident_id TEXT REFERENCES living_incidents(id),
                excluded_builders_json TEXT NOT NULL,
                original_attestation_count INTEGER NOT NULL,
                eligible_attestation_count INTEGER NOT NULL,
                threshold INTEGER NOT NULL,
                reason TEXT NOT NULL,
                reevaluated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_living_incidents_builder
            ON living_incidents(builder_id, created_at);

            CREATE INDEX IF NOT EXISTS idx_living_assessments_status
            ON living_release_assessments(current_status);
            """
        )
    finally:
        if owns_connection:
            connection.close()


class IncidentCreate(BaseModel):
    builder_id: str = Field(min_length=3, max_length=64)
    action: Literal["COMPROMISED", "REINSTATED"]
    reason: str = Field(min_length=5, max_length=500)
    effective_from: str | None = None

    @field_validator("effective_from")
    @classmethod
    def validate_effective_from(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("effective_from must be an ISO-8601 timestamp") from error
        return value


def _incident_payload(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "builder_id": row["builder_id"],
        "action": row["action"],
        "reason": row["reason"],
        "effective_from": row["effective_from"],
    }


def verify_incident_chain() -> dict[str, Any]:
    init_living_db()
    with connect() as db:
        rows = db.execute("SELECT * FROM living_incidents ORDER BY rowid").fetchall()
    previous_hash = "0" * 64
    errors: list[str] = []
    for row in rows:
        expected = hashlib.sha256(
            f"{previous_hash}|{canonical_json(_incident_payload(row))}|{row['created_at']}".encode()
        ).hexdigest()
        if row["previous_hash"] != previous_hash or row["event_hash"] != expected:
            errors.append(f"Invalid Living Verification incident {row['id']}")
            break
        previous_hash = expected
    return {
        "valid": not errors,
        "event_count": len(rows),
        "chain_head": previous_hash if rows else None,
        "errors": errors,
    }


def _latest_incidents(db: sqlite3.Connection) -> dict[str, sqlite3.Row]:
    rows = db.execute(
        """
        SELECT i.* FROM living_incidents i
        JOIN (
            SELECT builder_id, MAX(rowid) AS latest_rowid
            FROM living_incidents GROUP BY builder_id
        ) latest ON latest.latest_rowid = i.rowid
        """
    ).fetchall()
    return {row["builder_id"]: row for row in rows}


def is_builder_compromised(builder_id: str) -> bool:
    init_living_db()
    with connect() as db:
        row = db.execute(
            "SELECT action FROM living_incidents WHERE builder_id = ? ORDER BY rowid DESC LIMIT 1",
            (builder_id,),
        ).fetchone()
    return bool(row and row["action"] == "COMPROMISED")


def _at_or_after(timestamp: str, effective_from: str | None) -> bool:
    if not effective_from:
        return True
    try:
        observed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        effective = datetime.fromisoformat(effective_from.replace("Z", "+00:00"))
        if observed.tzinfo is None:
            observed = observed.replace(tzinfo=timezone.utc)
        if effective.tzinfo is None:
            effective = effective.replace(tzinfo=timezone.utc)
        return observed >= effective
    except ValueError:
        return True


def _policy_for_release(db: sqlite3.Connection, release: sqlite3.Row) -> QuorumPolicy:
    saved = db.execute(
        "SELECT policy_json FROM release_policies WHERE release_id = ?", (release["id"],)
    ).fetchone()
    if saved:
        return QuorumPolicy.model_validate_json(saved["policy_json"])
    return QuorumPolicy(
        threshold=release["threshold"],
        expected_builders=release["expected_builders"],
        minimum_operators=release["threshold"],
        reject_on_conflict=bool(release["reject_on_conflict"]),
    )


def reassess_release(release_id: str, latest_incident_id: str | None = None) -> dict[str, Any]:
    """Recalculate current trust while preserving the release's historical decision."""
    from backend import main

    init_living_db()
    with connect() as db:
        release = db.execute("SELECT * FROM releases WHERE id = ?", (release_id,)).fetchone()
        if not release:
            raise HTTPException(status_code=404, detail="Release not found")
        attestations = db.execute(
            """
            SELECT a.*, b.name, b.operator, b.platform, b.public_key
            FROM attestations a JOIN builders b ON b.id = a.builder_id
            WHERE a.release_id = ? AND a.signature_valid = 1
            ORDER BY a.id
            """,
            (release_id,),
        ).fetchall()
        incidents = _latest_incidents(db)
        previous = db.execute(
            "SELECT * FROM living_release_assessments WHERE release_id = ?", (release_id,)
        ).fetchone()
        historical_status = previous["historical_status"] if previous else release["status"]
        excluded: list[str] = []
        eligible: list[dict[str, Any]] = []
        relevant_incidents: list[str] = []
        for attestation in attestations:
            incident = incidents.get(attestation["builder_id"])
            compromised = bool(
                incident
                and incident["action"] == "COMPROMISED"
                and _at_or_after(attestation["built_at"], incident["effective_from"])
            )
            if compromised:
                excluded.append(attestation["builder_id"])
                relevant_incidents.append(incident["id"])
            else:
                eligible.append(dict(attestation, id=attestation["builder_id"]))

        policy = _policy_for_release(db, release)
        outcome = decide(eligible, release["candidate_sha256"], policy)
        if historical_status == "verified" and outcome["status"] != "verified":
            current_status = "TRUST_DEGRADED"
        else:
            current_status = outcome["status"].upper()
        excluded = sorted(set(excluded))
        relevant_incidents = sorted(set(relevant_incidents))
        if current_status == "TRUST_DEGRADED":
            reason = (
                f"Historical quorum is no longer sufficient after excluding compromised builder evidence: "
                f"{', '.join(excluded)}."
            )
        elif excluded:
            reason = (
                f"Quorum remains sufficient after excluding compromised builder evidence: "
                f"{', '.join(excluded)}."
            )
        else:
            reason = "No active compromise invalidates the attestations used by this release."
        reevaluated_at = utc_now()
        incident_id = latest_incident_id or (relevant_incidents[-1] if relevant_incidents else None)

        db.execute(
            """
            INSERT INTO living_release_assessments
                (release_id, historical_status, current_status, recalculated_status,
                 latest_incident_id, excluded_builders_json, original_attestation_count,
                 eligible_attestation_count, threshold, reason, reevaluated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(release_id) DO UPDATE SET
                current_status = excluded.current_status,
                recalculated_status = excluded.recalculated_status,
                latest_incident_id = excluded.latest_incident_id,
                excluded_builders_json = excluded.excluded_builders_json,
                original_attestation_count = excluded.original_attestation_count,
                eligible_attestation_count = excluded.eligible_attestation_count,
                threshold = excluded.threshold,
                reason = excluded.reason,
                reevaluated_at = excluded.reevaluated_at
            """,
            (
                release_id,
                historical_status,
                current_status,
                outcome["status"],
                incident_id,
                canonical_json({"builder_ids": excluded}),
                len(attestations),
                len(eligible),
                policy.threshold,
                reason,
                reevaluated_at,
            ),
        )
        previous_status = previous["current_status"] if previous else None
        if previous_status != current_status and (current_status == "TRUST_DEGRADED" or previous_status == "TRUST_DEGRADED"):
            main.append_audit_event(
                db,
                release_id,
                "living.trust_reassessed",
                {
                    "historical_status": historical_status,
                    "previous_current_status": previous_status,
                    "current_status": current_status,
                    "recalculated_status": outcome["status"],
                    "excluded_builders": excluded,
                    "eligible_attestations": len(eligible),
                    "threshold": policy.threshold,
                    "incident_id": incident_id,
                },
            )

    return get_assessment(release_id)


def reassess_all(latest_incident_id: str | None = None) -> list[dict[str, Any]]:
    init_living_db()
    with connect() as db:
        release_ids = [row["id"] for row in db.execute("SELECT id FROM releases ORDER BY created_at DESC").fetchall()]
    return [reassess_release(release_id, latest_incident_id) for release_id in release_ids]


def get_assessment(release_id: str) -> dict[str, Any]:
    with connect() as db:
        row = db.execute(
            """
            SELECT a.*, r.artifact_name, r.repository_url, r.source_commit,
                   r.candidate_sha256, r.consensus_sha256
            FROM living_release_assessments a
            JOIN releases r ON r.id = a.release_id
            WHERE a.release_id = ?
            """,
            (release_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Living assessment not found")
    result = dict(row)
    result["excluded_builders"] = json.loads(result.pop("excluded_builders_json"))["builder_ids"]
    return result


def list_assessments() -> list[dict[str, Any]]:
    init_living_db()
    with connect() as db:
        ids = [row["release_id"] for row in db.execute(
            "SELECT release_id FROM living_release_assessments ORDER BY reevaluated_at DESC, rowid DESC"
        ).fetchall()]
    return [get_assessment(release_id) for release_id in ids]


def list_incidents() -> list[dict[str, Any]]:
    init_living_db()
    with connect() as db:
        rows = db.execute(
            """
            SELECT i.*, b.name AS builder_name, b.operator
            FROM living_incidents i JOIN builders b ON b.id = i.builder_id
            ORDER BY i.rowid DESC
            """
        ).fetchall()
    return [dict(row) for row in rows]


def list_builder_states() -> list[dict[str, Any]]:
    init_living_db()
    with connect() as db:
        incidents = _latest_incidents(db)
        builders = db.execute("SELECT id, name, operator, platform, trusted FROM builders ORDER BY name").fetchall()
        results = []
        for builder in builders:
            incident = incidents.get(builder["id"])
            affected = db.execute(
                """
                SELECT COUNT(DISTINCT release_id) FROM attestations
                WHERE builder_id = ?
                """,
                (builder["id"],),
            ).fetchone()[0]
            results.append({
                **dict(builder),
                "trusted": bool(builder["trusted"]),
                "living_status": "COMPROMISED" if incident and incident["action"] == "COMPROMISED" else "ACTIVE",
                "latest_incident_id": incident["id"] if incident else None,
                "affected_release_count": affected,
            })
    return results


def record_incident(data: IncidentCreate) -> dict[str, Any]:
    init_living_db()
    with connect() as db:
        builder = db.execute("SELECT id FROM builders WHERE id = ?", (data.builder_id,)).fetchone()
        if not builder:
            raise HTTPException(status_code=404, detail="Builder not found")
        latest = db.execute(
            "SELECT action FROM living_incidents WHERE builder_id = ? ORDER BY rowid DESC LIMIT 1",
            (data.builder_id,),
        ).fetchone()
        if latest and latest["action"] == data.action:
            raise HTTPException(status_code=409, detail=f"Builder is already {data.action.lower()}")
        previous = db.execute("SELECT event_hash FROM living_incidents ORDER BY rowid DESC LIMIT 1").fetchone()
        previous_hash = previous["event_hash"] if previous else "0" * 64
        incident_id = str(uuid.uuid4())
        created_at = utc_now()
        payload = {
            "id": incident_id,
            "builder_id": data.builder_id,
            "action": data.action,
            "reason": data.reason,
            "effective_from": data.effective_from,
        }
        event_hash = hashlib.sha256(
            f"{previous_hash}|{canonical_json(payload)}|{created_at}".encode()
        ).hexdigest()
        db.execute(
            """
            INSERT INTO living_incidents
                (id, builder_id, action, reason, effective_from, created_at, previous_hash, event_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                incident_id, data.builder_id, data.action, data.reason,
                data.effective_from, created_at, previous_hash, event_hash,
            ),
        )
    assessments = reassess_all(incident_id)
    incident = next(item for item in list_incidents() if item["id"] == incident_id)
    return {
        "incident": incident,
        "affected_releases": sum(1 for item in assessments if data.builder_id in item["excluded_builders"]),
        "degraded_releases": sum(1 for item in assessments if item["current_status"] == "TRUST_DEGRADED"),
        "incident_chain": verify_incident_chain(),
    }


@living_router.get("/stats")
def living_stats() -> dict[str, Any]:
    assessments = list_assessments()
    builders = list_builder_states()
    chain = verify_incident_chain()
    return {
        "total_releases": len(assessments),
        "currently_verified": sum(1 for item in assessments if item["current_status"] == "VERIFIED"),
        "trust_degraded": sum(1 for item in assessments if item["current_status"] == "TRUST_DEGRADED"),
        "active_compromises": sum(1 for item in builders if item["living_status"] == "COMPROMISED"),
        "last_reevaluated_at": max((item["reevaluated_at"] for item in assessments), default=None),
        "incident_chain": chain,
    }


@living_router.get("/builders")
def living_builders() -> list[dict[str, Any]]:
    return list_builder_states()


@living_router.get("/incidents")
def living_incidents() -> list[dict[str, Any]]:
    return list_incidents()


@living_router.post("/incidents", status_code=201)
def create_living_incident(data: IncidentCreate) -> dict[str, Any]:
    return record_incident(data)


@living_router.get("/releases")
def living_releases() -> list[dict[str, Any]]:
    return list_assessments()


@living_router.post("/re-evaluate")
def trigger_living_reevaluation() -> dict[str, Any]:
    assessments = reassess_all()
    return {
        "reevaluated": len(assessments),
        "trust_degraded": sum(1 for item in assessments if item["current_status"] == "TRUST_DEGRADED"),
        "assessments": assessments,
    }
