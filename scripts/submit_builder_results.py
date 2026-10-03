from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from pathlib import Path


RESULT_SCHEMA = "quorum.builder-result.v1"


def api_request(api_url: str, method: str, path: str, body: dict | None = None) -> dict:
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


def load_result(path: Path) -> dict:
    result = json.loads(path.read_text(encoding="utf-8"))
    if result.get("schema_version") != RESULT_SCHEMA:
        raise ValueError(f"{path} is not a {RESULT_SCHEMA} file")
    if result.get("attestation", {}).get("signed_payload"):
        raise ValueError(f"{path} has an unexpected nested signed payload")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Combine signed results made by builders on separate machines"
    )
    parser.add_argument("results", type=Path, nargs="+", help="Builder result JSON files")
    parser.add_argument("--api-url", default="http://127.0.0.1:8000/api/v1")
    parser.add_argument("--candidate-sha256", help="Published artifact hash; defaults to the first result")
    parser.add_argument("--threshold", type=int, default=2)
    parser.add_argument(
        "--allow-conflict",
        action="store_true",
        help="Do not immediately reject a release merely because signed hashes differ",
    )
    args = parser.parse_args()

    results = [load_result(path) for path in args.results]
    if args.threshold < 1 or args.threshold > len(results):
        raise ValueError("threshold must be between 1 and the number of result files")

    builder_ids = [result["builder"]["id"] for result in results]
    operators = [result["builder"]["operator"] for result in results]
    if len(set(builder_ids)) != len(builder_ids):
        raise ValueError("Each result must come from a different builder ID")
    if len(set(operators)) < args.threshold:
        raise ValueError("The selected quorum requires more distinct operators")

    release_descriptions = {
        (
            result["source"]["repository_url"],
            result["source"]["commit"],
            result["build"]["artifact_name"],
            result["build"]["recipe_sha256"],
        )
        for result in results
    }
    if len(release_descriptions) != 1:
        raise ValueError("All results must refer to the same source commit and build recipe")

    first = results[0]
    for result in results:
        api_request(args.api_url, "POST", "/builders", result["builder"])
    release = api_request(
        args.api_url,
        "POST",
        "/releases",
        {
            "repository_url": first["source"]["repository_url"],
            "source_commit": first["source"]["commit"],
            "artifact_name": first["build"]["artifact_name"],
            "recipe_sha256": first["build"]["recipe_sha256"],
            "candidate_sha256": args.candidate_sha256
            or first["build"]["artifact_sha256"],
            "threshold": args.threshold,
            "expected_builders": len(results),
            "reject_on_conflict": not args.allow_conflict,
        },
    )
    verification = None
    for result in results:
        verification = api_request(
            args.api_url,
            "POST",
            f"/releases/{release['id']}/attestations",
            result["attestation"],
        )
    print(json.dumps(verification, indent=2))


if __name__ == "__main__":
    main()
