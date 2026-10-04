"""Create a release challenge before independent builders run."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from builder.agent import apply_recipe, load_config, load_recipe, recipe_document, recipe_sha256


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recipe', required=True, type=Path)
    parser.add_argument('--candidate', required=True, type=Path,
                        help='Publisher artifact independently obtained by the coordinator')
    parser.add_argument('--api-url', default='http://127.0.0.1:8000/api/v1')
    parser.add_argument('--threshold', type=int, default=2)
    parser.add_argument('--expected-builders', type=int, default=3)
    args = parser.parse_args()
    if not args.candidate.is_file():
        raise SystemExit(f'Candidate artifact not found: {args.candidate}')

    identity = load_config(ROOT / 'configs' / 'builders' / 'github-actions.json')
    config = apply_recipe(identity, load_recipe(args.recipe))
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
    request = urllib.request.Request(f"{args.api_url.rstrip('/')}/releases",
        data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            created = json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise SystemExit(error.read().decode(errors='replace')) from error
    print(json.dumps({
        **created,
        'candidate_sha256': digest,
        'recipe': str(args.recipe),
        'builder_command': (
            f'python -m builder.agent run --config configs/builders/BUILDER.json '
            f'--recipe {args.recipe} --release-id {created["id"]} '
            f'--key PRIVATE_KEY.pem --output result.json'
        ),
    }, indent=2))


if __name__ == '__main__':
    main()
