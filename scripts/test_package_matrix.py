"""Build each real package twice in fresh workspaces and compare SHA-256 outputs."""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from builder.agent import (apply_recipe, build_release, generate_private_key,
                           load_config, load_recipe)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('recipes', nargs='*', type=Path)
    parser.add_argument('--output', type=Path,
                        default=ROOT / 'builder-results' / 'package-matrix.json')
    args = parser.parse_args()
    recipes = args.recipes or sorted((ROOT / 'configs' / 'recipes').glob('*.json'))
    identity = load_config(ROOT / 'configs' / 'builders' / 'github-actions.json')

    with tempfile.TemporaryDirectory(prefix='quorum-package-matrix-') as temp:
        key = generate_private_key(Path(temp) / 'matrix-key.pem')
        results = []
        for recipe_path in recipes:
            config = apply_recipe(identity, load_recipe(recipe_path))
            entry = {
                'recipe': str(recipe_path),
                'repository_url': config['source']['repository_url'],
                'source_commit': config['source']['commit'],
                'artifact_name': config['build']['artifact_name'],
                'hashes': [],
                'reproducible': False,
            }
            try:
                attempts = [build_release(config, key) for _ in range(2)]
                entry['hashes'] = [item['build']['artifact_sha256'] for item in attempts]
                entry['reproducible'] = len(set(entry['hashes'])) == 1
            except Exception as error:
                entry['error'] = str(error)
            results.append(entry)
            state = 'MATCH' if entry['reproducible'] else 'FAILED'
            print(f"{recipe_path.stem}: {state} {entry['hashes']}")

    report = {
        'schema_version': 'quorum.package-matrix.v1',
        'valid': all(item['reproducible'] for item in results),
        'fresh_builds_per_package': 2,
        'packages': results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report['valid'] else 1)


if __name__ == '__main__':
    main()
