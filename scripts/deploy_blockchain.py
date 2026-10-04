from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.blockchain import BlockchainConfig, broadcast_transaction, rpc_call, wait_for_receipt  # noqa: E402


def run(command: list[str], cwd: Path) -> None:
    completed = subprocess.run(
        command,
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode:
        raise RuntimeError((completed.stderr or completed.stdout).strip())


def main() -> None:
    parser = argparse.ArgumentParser(description="Compile and deploy QuorumEvidence to Anvil")
    parser.add_argument("--rpc-url", default="http://127.0.0.1:8545")
    parser.add_argument("--chain-id", type=int,
                        help="Expected chain ID; required protection for public deployment")
    parser.add_argument("--forge", default=os.getenv("QUORUM_FORGE_BINARY") or shutil.which("forge"))
    parser.add_argument("--config", type=Path, default=ROOT / ".quorum" / "blockchain.json")
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="Deploy the existing Forge artifact after an explicit forge build/test",
    )
    args = parser.parse_args()
    if not args.forge and not args.skip_build:
        raise RuntimeError("Forge is required. Install Foundry or set QUORUM_FORGE_BINARY")

    contracts_dir = ROOT / "contracts"
    artifact_path = contracts_dir / "out" / "QuorumEvidence.sol" / "QuorumEvidence.json"
    if not args.skip_build:
        run([str(args.forge), "build", "--root", str(contracts_dir)], cwd=ROOT)
    if not artifact_path.is_file():
        raise RuntimeError("Compiled contract artifact is missing; run forge test --root contracts")
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    bytecode = artifact["bytecode"]["object"]
    method_ids = artifact["methodIdentifiers"]

    chain_id = int(rpc_call(args.rpc_url, "eth_chainId", []), 16)
    if args.chain_id is not None and args.chain_id != chain_id:
        raise RuntimeError(f"Expected chain {args.chain_id}, RPC reported {chain_id}")
    temporary_config = BlockchainConfig(
        rpc_url=args.rpc_url, chain_id=chain_id, contract_address="0x" + "0" * 40,
        from_address=os.getenv("QUORUM_FROM_ADDRESS"), anchor_selector="",
        get_anchor_selector="", private_key=os.getenv("QUORUM_EVM_PRIVATE_KEY"),
    )
    transaction_hash, sender = broadcast_transaction(
        temporary_config, data=bytecode, gas=3_000_000,
    )
    receipt = wait_for_receipt(
        args.rpc_url, transaction_hash,
        timeout_seconds=temporary_config.receipt_timeout_seconds,
    )
    contract_address = receipt.get("contractAddress")
    if not contract_address:
        raise RuntimeError("Deployment receipt did not contain a contract address")

    config = {
        "schema_version": "quorum.blockchain-config.v1",
        "rpc_url": args.rpc_url,
        "chain_id": chain_id,
        "contract_address": contract_address,
        "from_address": sender,
        "anchor_selector": method_ids["anchorEvidence(bytes32,bytes32,uint8,bool)"],
        "get_anchor_selector": method_ids["getAnchor(bytes32)"],
        "deployment_transaction": transaction_hash,
        "deployment_block": int(receipt["blockNumber"], 16),
        "receipt_timeout_seconds": temporary_config.receipt_timeout_seconds,
    }
    args.config.parent.mkdir(parents=True, exist_ok=True)
    args.config.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(config, indent=2))


if __name__ == "__main__":
    main()

