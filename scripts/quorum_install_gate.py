"""Fail-closed installation gate for Quorum-verified release artifacts."""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend import blockchain  # noqa: E402
from backend.passport import verify_passport  # noqa: E402


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_json(url: str) -> dict:
    try:
        with urllib.request.urlopen(url, timeout=15) as response:
            return json.loads(response.read())
    except (urllib.error.URLError, json.JSONDecodeError) as error:
        raise RuntimeError(f'Cannot retrieve trusted evidence from {url}') from error


def evaluate_installation(
    report: dict,
    *,
    artifact_sha256: str,
    artifact_name: str,
    trusted_report_key: str,
    anchor_config: blockchain.BlockchainConfig | None = None,
    require_public_anchor: bool = False,
) -> dict:
    passport = verify_passport(report, trusted_report_key)
    reasons: list[str] = []
    if not passport['valid'] or not passport['trusted']:
        reasons.append('Evidence Passport signature or contents are not trusted')
    evidence = report.get('evidence', {})
    release = evidence.get('release', {})
    decision = evidence.get('decision', {})
    if artifact_name != release.get('artifact_name'):
        reasons.append('Artifact filename does not match the release')
    if decision.get('status') != 'verified':
        reasons.append(f"Release decision is {decision.get('status', 'missing')}, not verified")
    if artifact_sha256 != decision.get('consensus_sha256'):
        reasons.append('Local artifact SHA-256 does not match builder consensus')
    if artifact_sha256 != release.get('candidate_sha256'):
        reasons.append('Local artifact SHA-256 does not match the published candidate')

    anchor: dict | None = None
    if anchor_config:
        try:
            anchor = blockchain.read_anchor(anchor_config, report['release_id'])
            if anchor['evidence_sha256'] != report.get('evidence_sha256'):
                reasons.append('External anchor does not match the Evidence Passport')
            if not anchor['anchored_at']:
                reasons.append('External anchor is missing')
            if require_public_anchor and not blockchain.is_public_chain(anchor_config.chain_id):
                reasons.append('The configured chain is not a recognized independent public network')
        except (blockchain.BlockchainError, KeyError) as error:
            reasons.append(f'External anchor verification failed: {error}')
    elif require_public_anchor:
        reasons.append('A trusted external anchor configuration is required')

    return {
        'accepted': not reasons,
        'artifact_sha256': artifact_sha256,
        'release_id': report.get('release_id'),
        'passport': passport,
        'external_anchor': anchor,
        'reasons': reasons,
    }


def post_consumer_check(api_url: str, release_id: str, artifact_name: str, digest: str) -> None:
    request = urllib.request.Request(
        f"{api_url.rstrip('/')}/releases/{release_id}/consumer-verifications",
        data=json.dumps({'artifact_name': artifact_name, 'artifact_sha256': digest}).encode(),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        result = json.loads(response.read())
    if result.get('decision') != 'accepted':
        raise RuntimeError(f"Backend refused installation: {result.get('reason', 'unknown reason')}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api-url', default='http://127.0.0.1:8000/api/v1')
    parser.add_argument('--release-id', required=True)
    parser.add_argument('--artifact', required=True, type=Path)
    parser.add_argument('--trusted-report-key', required=True)
    parser.add_argument('--anchor-config', type=Path, help='Trusted blockchain config, supplied independently of the report')
    parser.add_argument('--require-public-anchor', action='store_true')
    parser.add_argument('installer', nargs=argparse.REMAINDER,
                        help='Optional command after --; use {artifact} where its path belongs')
    args = parser.parse_args()

    if not args.artifact.is_file():
        raise SystemExit(f'BLOCKED: artifact does not exist: {args.artifact}')
    report = fetch_json(f"{args.api_url.rstrip('/')}/releases/{args.release_id}/audit-report")
    anchor_config = blockchain.load_config(args.anchor_config, allow_env=False) if args.anchor_config else None
    if args.anchor_config and not anchor_config:
        raise SystemExit('BLOCKED: trusted anchor configuration is incomplete')
    digest = sha256_file(args.artifact)
    result = evaluate_installation(report, artifact_sha256=digest,
        artifact_name=args.artifact.name, trusted_report_key=args.trusted_report_key,
        anchor_config=anchor_config, require_public_anchor=args.require_public_anchor)
    print(json.dumps(result, indent=2))
    if not result['accepted']:
        raise SystemExit(1)

    post_consumer_check(args.api_url, args.release_id, args.artifact.name, digest)
    command = args.installer[1:] if args.installer[:1] == ['--'] else args.installer
    if command:
        rendered = [part.replace('{artifact}', str(args.artifact.resolve())) for part in command]
        completed = subprocess.run(rendered, check=False)
        raise SystemExit(completed.returncode)
    print('ACCEPTED: installation gate passed. No installer command was supplied.')


if __name__ == '__main__':
    main()
