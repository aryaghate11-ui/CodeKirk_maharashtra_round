"""Collect the three independently produced evidence files into Quorum.

This command deliberately does not execute all builders on the coordinator. The local
builder, GitHub Actions, and GitLab CI must each produce their own signed JSON artifact.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local", type=Path, required=True)
    parser.add_argument("--github", type=Path, required=True)
    parser.add_argument("--gitlab", type=Path, required=True)
    parser.add_argument("--api-url", default="http://127.0.0.1:8000/api/v1")
    parser.add_argument("--release-id")
    parser.add_argument("--register-only", action="store_true")
    parser.add_argument("--admin-token", default=os.getenv("QUORUM_ADMIN_TOKEN", ""))
    args = parser.parse_args()

    command = [
        sys.executable,
        str(ROOT / "scripts" / "submit_builder_results.py"),
        str(args.local),
        str(args.github),
        str(args.gitlab),
        "--api-url",
        args.api_url,
    ]
    if args.release_id:
        command.extend(["--release-id", args.release_id])
    if args.register_only:
        command.append("--register-only")
    if args.admin_token:
        command.extend(["--admin-token", args.admin_token])
    raise SystemExit(subprocess.run(command, cwd=ROOT, check=False).returncode)


if __name__ == "__main__":
    main()
