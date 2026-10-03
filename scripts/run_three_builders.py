from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from builder.agent import build_release, generate_private_key, load_config, load_private_key  # noqa: E402


CONFIGS = (
    ROOT / "configs" / "builders" / "github-actions.json",
    ROOT / "configs" / "builders" / "laptop-one.json",
    ROOT / "configs" / "builders" / "laptop-two.json",
)


def api_request(api_url: str, method: str, path: str, body: dict | None = None) -> dict | list:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        f"{api_url.rstrip('/')}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise RuntimeError(f"API {method} {path} failed ({error.code}): {detail}") from error


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run three separately keyed Quorum builders and submit one release quorum"
    )
    parser.add_argument("--api-url", default="http://127.0.0.1:8000/api/v1")
    parser.add_argument(
        "--tamper-builder",
        choices=("github-actions", "laptop-one", "laptop-two"),
        help="Append a visible marker after this builder completes, producing a signed conflict",
    )
    parser.add_argument("--results-dir", type=Path, default=ROOT / "builder-results")
    args = parser.parse_args()

    health = api_request(args.api_url, "GET", "/health")
    if health.get("status") != "ok":
        raise RuntimeError("Quorum API is not healthy")

    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_dir = args.results_dir / run_id
    output_dir.mkdir(parents=True, exist_ok=True)
    key_dir = ROOT / ".quorum" / "keys"
    results: list[dict] = []

    for config_path in CONFIGS:
        config = load_config(config_path)
        builder_id = config["builder"]["id"]
        key_path = key_dir / f"{builder_id}.pem"
        if not key_path.exists():
            generate_private_key(key_path)
        result = build_release(
            config,
            load_private_key(key_path),
            tamper=builder_id == args.tamper_builder,
        )
        result_path = output_dir / f"{builder_id}.json"
        result_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        results.append(result)
        print(f"built {builder_id}: {result['build']['artifact_sha256']}")

    first = results[0]
    expected = {
        (
            result["source"]["repository_url"],
            result["source"]["commit"],
            result["build"]["artifact_name"],
            result["build"]["recipe_sha256"],
        )
        for result in results
    }
    if len(expected) != 1:
        raise RuntimeError("Builder results do not describe the same source and recipe")

    for result in results:
        api_request(args.api_url, "POST", "/builders", result["builder"])

    created = api_request(
        args.api_url,
        "POST",
        "/releases",
        {
            "repository_url": first["source"]["repository_url"],
            "source_commit": first["source"]["commit"],
            "artifact_name": first["build"]["artifact_name"],
            "recipe_sha256": first["build"]["recipe_sha256"],
            "candidate_sha256": first["build"]["artifact_sha256"],
            "threshold": 2,
            "expected_builders": 3,
            "reject_on_conflict": True,
        },
    )
    release_id = created["id"]
    verification = None
    for result in results:
        verification = api_request(
            args.api_url,
            "POST",
            f"/releases/{release_id}/attestations",
            result["attestation"],
        )

    summary = {
        "execution_scope": "three-isolated-workspaces-on-one-host",
        "release_id": release_id,
        "status": verification["status"],
        "candidate_sha256": verification["candidate_sha256"],
        "consensus_sha256": verification["consensus_sha256"],
        "attestation_count": verification["attestation_count"],
        "rules": verification["rules"],
        "builders": [
            {
                "id": item["id"],
                "operator": item["operator"],
                "artifact_sha256": item["artifact_sha256"],
                "signature_valid": item["signature_valid"],
            }
            for item in verification["builders"]
        ],
        "audit_chain_head": verification["audit_chain_head"],
        "result_directory": str(output_dir),
    }
    summary_path = output_dir / "quorum-summary.json"
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
