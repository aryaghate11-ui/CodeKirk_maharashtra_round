"""Create a release challenge before independent builders run."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from builder.agent import (
    CHALLENGE_SCHEMA,
    apply_recipe,
    canonical_json,
    load_config,
    load_recipe,
    recipe_document,
    recipe_sha256,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recipe', required=True, type=Path)
    parser.add_argument('--candidate', required=True, type=Path,
                        help='Publisher artifact independently obtained by the coordinator')
    parser.add_argument('--api-url', default='http://127.0.0.1:8000/api/v1')
    parser.add_argument('--threshold', type=int, default=3)
    parser.add_argument('--expected-builders', type=int, default=3)
    parser.add_argument('--output', type=Path, default=Path('builder-challenge.json'))
    parser.add_argument(
        '--admin-token', default=os.getenv('QUORUM_ADMIN_TOKEN', ''),
        help='Quorum admin token (defaults to QUORUM_ADMIN_TOKEN)',
    )
    args = parser.parse_args()
    if not args.candidate.is_file():
        raise SystemExit(f'Candidate artifact not found: {args.candidate}')

    identity = load_config(ROOT / 'configs' / 'builders' / 'local-builder.json')
    build_target = load_recipe(args.recipe)
    config = apply_recipe(identity, build_target)
    digest = hashlib.sha256(args.candidate.read_bytes()).hexdigest()
    recipe = recipe_document(config)
    body = {
        'repository_url': config['source']['repository_url'],
        'source_commit': config['source']['commit'],
        'artifact_name': config['build']['artifact_name'],
        'recipe_sha256': recipe_sha256(config),
        'recipe': recipe,
        'candidate_sha256': digest,
        'threshold': args.threshold,
        'expected_builders': args.expected_builders,
        'reject_on_conflict': True,
    }
    headers = {'Content-Type': 'application/json'}
    if args.admin_token:
        headers['X-Quorum-Admin-Token'] = args.admin_token
    request = urllib.request.Request(f"{args.api_url.rstrip('/')}/releases",
        data=json.dumps(body).encode(), headers=headers, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            created = json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise SystemExit(error.read().decode(errors='replace')) from error
    challenge = {
        'schema_version': CHALLENGE_SCHEMA,
        'release_id': created['id'],
        'candidate_sha256': digest,
        'recipe_sha256': recipe_sha256(config),
        'build_target': build_target,
        'created_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(challenge, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({
        **created,
        'candidate_sha256': digest,
        'challenge_file': str(args.output),
        'challenge_sha256': hashlib.sha256(canonical_json(challenge).encode()).hexdigest(),
        'builder_command': (
            'python -m builder.agent run --config configs/builders/BUILDER.json '
            f'--challenge {args.output} --key PRIVATE_KEY.pem --output result.json'
        ),
    }, indent=2))


if __name__ == '__main__':
    main()
