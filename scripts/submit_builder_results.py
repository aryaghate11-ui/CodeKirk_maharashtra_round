from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import urllib.error
import urllib.request
from pathlib import Path


RESULT_SCHEMA = "quorum.builder-result.v1"
REQUIRED_BUILDERS = frozenset({"local-builder", "github-actions", "gitlab-ci"})


def api_request(
    api_url: str,
    method: str,
    path: str,
    body: dict | None = None,
    *,
    admin_token: str = "",
) -> dict | list:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if admin_token:
        headers["X-Quorum-Admin-Token"] = admin_token
    request = urllib.request.Request(
        f"{api_url.rstrip('/')}{path}", data=data, method=method, headers=headers
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise RuntimeError(f"API {method} {path} failed ({error.code}): {detail}") from error


def load_result(path: Path) -> dict:
    result = json.loads(path.read_text(encoding="utf-8"))
    if result.get("schema_version") != RESULT_SCHEMA:
        raise ValueError(f"{path} is not a {RESULT_SCHEMA} file")
    for section in ("builder", "source", "build", "attestation", "signed_payload"):
        if not isinstance(result.get(section), dict):
            raise ValueError(f"{path} is missing {section}")
    builder_id = result["builder"].get("id")
    if builder_id not in REQUIRED_BUILDERS:
        raise ValueError(f"{path} uses unsupported builder identity {builder_id!r}")
    release_id = result.get("release_id")
    challenge_hash = result.get("challenge_sha256")
    if not release_id or not challenge_hash:
        raise ValueError(f"{path} is not bound to a coordinator challenge")
    signed = result["signed_payload"]
    attestation = result["attestation"]
    expected = {
        "release_id": release_id,
        "builder_id": builder_id,
        "artifact_sha256": result["build"].get("artifact_sha256"),
        "source_commit": result["source"].get("commit"),
        "recipe_sha256": result["build"].get("recipe_sha256"),
    }
    if any(signed.get(field) != value for field, value in expected.items()):
        raise ValueError(f"{path} signed payload does not match its evidence envelope")
    for field in ("builder_id", "artifact_sha256", "built_at", "environment"):
        if attestation.get(field) != signed.get(field):
            raise ValueError(f"{path} attestation {field} does not match its signed payload")
    return result


def fingerprint(result: dict) -> str:
    return hashlib.sha256(base64.b64decode(result["builder"]["public_key"], validate=True)).hexdigest()


def validate_result_set(results: list[dict], release_id: str | None = None) -> str:
    builder_ids = {result["builder"]["id"] for result in results}
    if builder_ids != REQUIRED_BUILDERS:
        missing = sorted(REQUIRED_BUILDERS - builder_ids)
        extra = sorted(builder_ids - REQUIRED_BUILDERS)
        raise ValueError(f"Expected exactly {sorted(REQUIRED_BUILDERS)}; missing={missing}, extra={extra}")
    if len(results) != len(REQUIRED_BUILDERS):
        raise ValueError("Exactly one evidence file per required builder is required")
    operators = {result["builder"]["operator"] for result in results}
    if len(operators) != 3:
        raise ValueError("The three builders must declare three distinct operators")
    descriptions = {
        (
            result["source"]["repository_url"],
            result["source"]["commit"],
            result["build"]["artifact_name"],
            result["build"]["recipe_sha256"],
            result["challenge_sha256"],
            result["release_id"],
        )
        for result in results
    }
    if len(descriptions) != 1:
        raise ValueError("All evidence must come from the same challenge, source commit, and recipe")
    inferred = results[0]["release_id"]
    if release_id and release_id != inferred:
        raise ValueError("--release-id does not match the release signed by every builder")
    return inferred


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import Local/GitHub/GitLab signed CI artifacts into the existing Quorum release"
    )
    parser.add_argument("results", type=Path, nargs=3, help="Exactly three builder result JSON files")
    parser.add_argument("--api-url", default="http://127.0.0.1:8000/api/v1")
    parser.add_argument("--release-id", help="Optional cross-check; normally inferred from evidence")
    parser.add_argument(
        "--admin-token", default=os.getenv("QUORUM_ADMIN_TOKEN", ""),
        help="Admin token used only to register keys (defaults to QUORUM_ADMIN_TOKEN)",
    )
    parser.add_argument(
        "--register-only", action="store_true",
        help="Register the three public keys for out-of-band fingerprint approval",
    )
    args = parser.parse_args()

    results = [load_result(path) for path in args.results]
    release_id = validate_result_set(results, args.release_id)

    if args.register_only:
        if not args.admin_token:
            raise ValueError("--register-only requires --admin-token or QUORUM_ADMIN_TOKEN")
        registrations = [
            api_request(
                args.api_url, "POST", "/builders", result["builder"],
                admin_token=args.admin_token,
            )
            for result in results
        ]
        print(json.dumps({
            "registered": registrations,
            "next": "Review and approve all three exact fingerprints with manage_builder_trust.py, then rerun without --register-only.",
        }, indent=2))
        return

    registered = {
        item["id"]: item for item in api_request(args.api_url, "GET", "/builders")
    }
    for result in results:
        builder_id = result["builder"]["id"]
        record = registered.get(builder_id)
        if not record:
            raise ValueError(f"{builder_id} is not registered; run --register-only first")
        if record["signing_key_fingerprint"] != fingerprint(result):
            raise ValueError(f"{builder_id} evidence key does not match the approved registry key")
        if not record["trusted"]:
            raise ValueError(f"{builder_id} is pending approval")

    release_record = api_request(args.api_url, "GET", f"/releases/{release_id}")
    release = release_record["release"]
    first = results[0]
    for field, observed in (
        ("repository_url", first["source"]["repository_url"]),
        ("source_commit", first["source"]["commit"]),
        ("artifact_name", first["build"]["artifact_name"]),
        ("recipe_sha256", first["build"]["recipe_sha256"]),
    ):
        if release[field] != observed:
            raise ValueError(f"Existing release does not match evidence {field}")

    verification = None
    for result in sorted(results, key=lambda item: item["builder"]["id"]):
        verification = api_request(
            args.api_url,
            "POST",
            f"/releases/{release_id}/attestations",
            result["attestation"],
        )
    print(json.dumps(verification, indent=2))


if __name__ == "__main__":
    main()
