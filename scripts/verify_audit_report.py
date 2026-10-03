"""Offline Evidence Passport verifier. A public key pin is required for trust."""
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.passport import verify_passport


def verify_report(report, rpc_url=None, trusted_report_key=None):
    result = verify_passport(report, trusted_report_key)
    if rpc_url:
        result['warning'] = 'This verifier is offline; no blockchain RPC check was performed.'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report', type=Path)
    parser.add_argument('--trusted-report-key', help='Base64 public key obtained through a trusted channel')
    args = parser.parse_args()
    try:
        result = verify_report(json.loads(args.report.read_text(encoding='utf-8-sig')),
                               trusted_report_key=args.trusted_report_key)
    except (ValueError, OSError) as error:
        result = dict(valid=False, trusted=False, errors=[str(error)])
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['valid'] and result['trusted'] else 1)


if __name__ == '__main__':
    main()
