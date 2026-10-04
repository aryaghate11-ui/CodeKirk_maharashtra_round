from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from eth_account import Account


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = ROOT / ".quorum" / "blockchain.json"
DECISIONS = {"pending": 0, "verified": 1, "rejected": 2, "disagreement": 3}


class BlockchainError(RuntimeError):
    pass


@dataclass(frozen=True)
class BlockchainConfig:
    rpc_url: str
    chain_id: int
    contract_address: str
    from_address: str | None
    anchor_selector: str
    get_anchor_selector: str
    deployment_transaction: str | None = None
    private_key: str | None = None
    receipt_timeout_seconds: int = 120


PUBLIC_CHAIN_IDS = {
    1, 10, 137, 8453, 42161,
    11155111, 11155420, 80002, 84532, 421614,
}


def is_public_chain(chain_id: int) -> bool:
    """Return true only for public networks explicitly recognized by Quorum."""
    return chain_id in PUBLIC_CHAIN_IDS


def network_name(chain_id: int) -> str:
    names = {
        1: "Ethereum Mainnet", 10: "Optimism", 137: "Polygon",
        8453: "Base", 42161: "Arbitrum One", 11155111: "Sepolia",
        11155420: "Optimism Sepolia", 80002: "Polygon Amoy",
        84532: "Base Sepolia", 421614: "Arbitrum Sepolia",
        31337: "Anvil", 1337: "Local EVM",
    }
    return names.get(chain_id, f"EVM chain {chain_id}")


def load_config(path: Path | None = None, *, allow_env: bool = True) -> BlockchainConfig | None:
    config_path = path or Path(os.getenv("QUORUM_BLOCKCHAIN_CONFIG", DEFAULT_CONFIG_PATH))
    file_config: dict = {}
    if config_path.is_file():
        file_config = json.loads(config_path.read_text(encoding="utf-8"))

    env = os.environ if allow_env else {}
    rpc_url = env.get("QUORUM_RPC_URL") or file_config.get("rpc_url")
    contract_address = env.get("QUORUM_CONTRACT_ADDRESS") or file_config.get(
        "contract_address"
    )
    chain_id_value = env.get("QUORUM_CHAIN_ID") or file_config.get("chain_id")
    anchor_selector = env.get("QUORUM_ANCHOR_SELECTOR") or file_config.get(
        "anchor_selector"
    )
    get_anchor_selector = env.get("QUORUM_GET_ANCHOR_SELECTOR") or file_config.get(
        "get_anchor_selector"
    )
    if not all((rpc_url, contract_address, chain_id_value, anchor_selector, get_anchor_selector)):
        return None
    return BlockchainConfig(
        rpc_url=str(rpc_url),
        chain_id=int(chain_id_value),
        contract_address=str(contract_address),
        from_address=env.get("QUORUM_FROM_ADDRESS") or file_config.get("from_address"),
        anchor_selector=str(anchor_selector).removeprefix("0x"),
        get_anchor_selector=str(get_anchor_selector).removeprefix("0x"),
        deployment_transaction=file_config.get("deployment_transaction"),
        private_key=env.get("QUORUM_EVM_PRIVATE_KEY"),
        receipt_timeout_seconds=int(env.get("QUORUM_RECEIPT_TIMEOUT_SECONDS") or file_config.get("receipt_timeout_seconds", 120)),
    )


def rpc_call(rpc_url: str, method: str, params: list) -> object:
    request = urllib.request.Request(
        rpc_url,
        data=json.dumps(
            {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        ).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            payload = json.loads(response.read())
    except (urllib.error.URLError, TimeoutError) as error:
        raise BlockchainError(f"Blockchain RPC is unavailable at {rpc_url}") from error
    if payload.get("error"):
        raise BlockchainError(f"Blockchain RPC error: {payload['error']}")
    return payload.get("result")


def wait_for_receipt(rpc_url: str, transaction_hash: str, timeout_seconds: int = 20) -> dict:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        receipt = rpc_call(rpc_url, "eth_getTransactionReceipt", [transaction_hash])
        if receipt:
            if int(receipt["status"], 16) != 1:
                raise BlockchainError(f"Transaction reverted: {transaction_hash}")
            return receipt
        time.sleep(0.25)
    raise BlockchainError(f"Timed out waiting for transaction {transaction_hash}")


def release_id_hash(release_id: str) -> str:
    return hashlib.sha256(release_id.encode()).hexdigest()


def _word(value: int) -> str:
    return f"{value:064x}"


def _validate_hash(value: str, name: str) -> str:
    normalized = value.removeprefix("0x").lower()
    if len(normalized) != 64 or any(character not in "0123456789abcdef" for character in normalized):
        raise BlockchainError(f"{name} must be a 32-byte hexadecimal value")
    return normalized


def broadcast_transaction(
    config: BlockchainConfig,
    *,
    data: str,
    gas: int,
    to: str | None = None,
) -> tuple[str, str]:
    """Broadcast through an unlocked local account or sign locally for a public RPC."""
    if config.private_key:
        try:
            account = Account.from_key(config.private_key)
        except Exception as error:
            raise BlockchainError("QUORUM_EVM_PRIVATE_KEY is not a valid Ethereum private key") from error
        sender = account.address
        if config.from_address and config.from_address.lower() != sender.lower():
            raise BlockchainError("Configured from_address does not match QUORUM_EVM_PRIVATE_KEY")
        nonce = int(rpc_call(config.rpc_url, "eth_getTransactionCount", [sender, "pending"]), 16)
        latest = rpc_call(config.rpc_url, "eth_getBlockByNumber", ["latest", False])
        transaction = {
            "chainId": config.chain_id,
            "nonce": nonce,
            "data": data,
            "gas": gas,
            "value": 0,
        }
        if to:
            transaction["to"] = to
        base_fee = int(latest.get("baseFeePerGas", "0x0"), 16) if isinstance(latest, dict) else 0
        if base_fee:
            try:
                priority_fee = int(rpc_call(config.rpc_url, "eth_maxPriorityFeePerGas", []), 16)
            except BlockchainError:
                priority_fee = 1_500_000_000
            transaction.update({
                "type": 2,
                "maxPriorityFeePerGas": priority_fee,
                "maxFeePerGas": base_fee * 2 + priority_fee,
            })
        else:
            transaction["gasPrice"] = int(rpc_call(config.rpc_url, "eth_gasPrice", []), 16)
        signed = Account.sign_transaction(transaction, config.private_key)
        raw = getattr(signed, "raw_transaction", None) or getattr(signed, "rawTransaction")
        transaction_hash = rpc_call(config.rpc_url, "eth_sendRawTransaction", ["0x" + bytes(raw).hex()])
        return str(transaction_hash), sender

    accounts = rpc_call(config.rpc_url, "eth_accounts", [])
    sender = config.from_address or (accounts[0] if accounts else None)
    if not sender:
        raise BlockchainError(
            "No unlocked RPC account is available; set QUORUM_EVM_PRIVATE_KEY for local signing"
        )
    transaction = {"from": sender, "data": data, "gas": hex(gas)}
    if to:
        transaction["to"] = to
    return str(rpc_call(config.rpc_url, "eth_sendTransaction", [transaction])), sender


def anchor_evidence(
    config: BlockchainConfig,
    *,
    release_id: str,
    evidence_sha256: str,
    decision: str,
    conflict: bool,
) -> dict:
    if decision not in DECISIONS or decision == "pending":
        raise BlockchainError("Only final release decisions can be anchored")
    observed_chain_id = int(rpc_call(config.rpc_url, "eth_chainId", []), 16)
    if observed_chain_id != config.chain_id:
        raise BlockchainError(
            f"Configured chain {config.chain_id} does not match RPC chain {observed_chain_id}"
        )
    release_hash = release_id_hash(release_id)
    evidence_hash = _validate_hash(evidence_sha256, "evidence_sha256")
    data = "0x" + "".join(
        (
            config.anchor_selector,
            release_hash,
            evidence_hash,
            _word(DECISIONS[decision]),
            _word(int(conflict)),
        )
    )
    transaction_hash, sender = broadcast_transaction(
        config, to=config.contract_address, data=data, gas=500_000,
    )
    receipt = wait_for_receipt(
        config.rpc_url, transaction_hash, timeout_seconds=config.receipt_timeout_seconds
    )
    return {
        "chain_id": config.chain_id,
        "contract_address": config.contract_address,
        "transaction_hash": transaction_hash,
        "block_number": int(receipt["blockNumber"], 16),
        "gas_used": int(receipt["gasUsed"], 16),
        "release_id_hash": release_hash,
        "evidence_sha256": evidence_hash,
        "decision": decision,
        "conflict": conflict,
        "submitter": sender,
    }


def read_anchor(config: BlockchainConfig, release_id: str) -> dict:
    if int(rpc_call(config.rpc_url, 'eth_chainId', []), 16) != config.chain_id:
        raise BlockchainError('Configured and observed chain IDs differ')
    release_hash = release_id_hash(release_id)
    result = rpc_call(
        config.rpc_url,
        "eth_call",
        [
            {
                "to": config.contract_address,
                "data": f"0x{config.get_anchor_selector}{release_hash}",
            },
            "latest",
        ],
    )
    raw = str(result).removeprefix("0x")
    if len(raw) < 64 * 5:
        raise BlockchainError("Contract returned an invalid anchor record")
    words = [raw[index : index + 64] for index in range(0, 64 * 5, 64)]
    return {
        "release_id_hash": release_hash,
        "evidence_sha256": words[0],
        "decision_code": int(words[1], 16),
        "conflict": bool(int(words[2], 16)),
        "anchored_at": int(words[3], 16),
        "submitter": "0x" + words[4][-40:],
    }


def status(config: BlockchainConfig | None = None) -> dict:
    selected = config or load_config()
    if not selected:
        return {"configured": False, "connected": False, "network": "Not configured"}
    try:
        observed_chain_id = int(rpc_call(selected.rpc_url, "eth_chainId", []), 16)
        connected = observed_chain_id == selected.chain_id
    except BlockchainError:
        observed_chain_id = None
        connected = False
    return {
        "configured": True,
        "connected": connected,
        "network": network_name(selected.chain_id),
        "public_network": is_public_chain(selected.chain_id),
        "chain_id": selected.chain_id,
        "observed_chain_id": observed_chain_id,
        "contract_address": selected.contract_address,
        "deployment_transaction": selected.deployment_transaction,
        "signing_mode": "local-private-key" if selected.private_key else "unlocked-rpc-account",
    }
