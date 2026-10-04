"""Review, approve, or revoke builder signing keys from the local verifier host."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend import main


def main_cli() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest='command', required=True)
    subparsers.add_parser('list', help='List trusted and pending builders')
    for command in ('approve', 'revoke'):
        action = subparsers.add_parser(command)
        action.add_argument('--builder', required=True)
        action.add_argument('--fingerprint', required=True,
                            help='64-character SHA-256 fingerprint checked out-of-band')
        action.add_argument('--reason', required=True)
    args = parser.parse_args()

    main.init_db()
    if args.command == 'list':
        print(json.dumps({
            'builders': main.list_builders(),
            'trust_chain': main.verify_builder_trust_chain(),
        }, indent=2))
        return

    try:
        result = main.set_builder_trust(
            args.builder,
            trusted=args.command == 'approve',
            expected_fingerprint=args.fingerprint,
            reason=args.reason,
        )
    except ValueError as error:
        raise SystemExit(f'REFUSED: {error}') from error
    print(json.dumps({
        'builder': result,
        'trust_chain': main.verify_builder_trust_chain(),
    }, indent=2))


if __name__ == '__main__':
    main_cli()
