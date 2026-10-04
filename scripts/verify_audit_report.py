"""Offline Evidence Passport verifier. A public key pin is required for trust."""
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import blockchain
from backend.passport import verify_passport


def verify_report(
    report,
    rpc_url=None,
    trusted_report_key=None,
    anchor_config=None,
    require_public_anchor=False,
):
    result = verify_passport(report, trusted_report_key)
    if anchor_config:
        try:
            anchor = blockchain.read_anchor(anchor_config, report['release_id'])
            anchor_matches = bool(
                anchor['anchored_at']
                and anchor['evidence_sha256'] == report['evidence_sha256']
            )
            result['checks']['external_anchor'] = anchor_matches
            result['anchor'] = {
                **anchor,
                'chain_id': anchor_config.chain_id,
                'network': blockchain.network_name(anchor_config.chain_id),
                'public_network': blockchain.is_public_chain(anchor_config.chain_id),
            }
            if not anchor_matches:
                result['errors'].append('External anchor does not match this report')
            if require_public_anchor:
                result['checks']['public_network'] = blockchain.is_public_chain(anchor_config.chain_id)
                if not result['checks']['public_network']:
                    result['errors'].append('Configured chain is not a recognized public network')
        except (blockchain.BlockchainError, KeyError) as error:
            result['checks']['external_anchor'] = False
            result['errors'].append(str(error))
    elif require_public_anchor:
        result['checks']['external_anchor'] = False
        result['errors'].append('A trusted external anchor configuration is required')
    elif rpc_url:
        result['warning'] = 'This verifier is offline; no blockchain RPC check was performed.'
    result['valid'] = bool(result['checks']) and all(
        value for value in result['checks'].values() if value is not None
    )
    result['trusted'] = result['valid'] and result['checks'].get('trusted_signer') is True
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report', type=Path)
    parser.add_argument('--trusted-report-key', help='Base64 public key obtained through a trusted channel')
    parser.add_argument('--anchor-config', type=Path,
                        help='Trusted blockchain config obtained independently of the report')
    parser.add_argument('--require-public-anchor', action='store_true')
    args = parser.parse_args()
    try:
        anchor_config = blockchain.load_config(args.anchor_config, allow_env=False) if args.anchor_config else None
        if args.anchor_config and not anchor_config:
            raise ValueError('Trusted anchor configuration is incomplete')
        result = verify_report(json.loads(args.report.read_text(encoding='utf-8-sig')),
                               trusted_report_key=args.trusted_report_key,
                               anchor_config=anchor_config,
                               require_public_anchor=args.require_public_anchor)
    except (ValueError, OSError) as error:
        result = dict(valid=False, trusted=False, errors=[str(error)])
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['valid'] and result['trusted'] else 1)


if __name__ == '__main__':
    main()
