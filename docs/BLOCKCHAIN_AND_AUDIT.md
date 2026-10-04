# Blockchain anchoring and audit passports

Quorum uses a local Anvil blockchain to prove that a specific release decision
and evidence digest existed and was not silently replaced later. It does not
store binaries or full attestations on-chain.

## What is stored on-chain

- SHA-256 of the release ID
- SHA-256 of the frozen evidence snapshot
- Final decision: verified, rejected or disagreement
- Whether a builder conflict occurred
- Block timestamp and submitting account

The Solidity contract rejects attempts to replace an existing release anchor.
Detailed evidence remains in SQLite and in the downloadable audit report.

## Start Anvil

Install the free Foundry toolkit, then run:

```powershell
.\scripts\start_anvil.ps1
```

Keep that PowerShell window open. Anvil runs locally on
`http://127.0.0.1:8545` with chain ID `31337`.

## Test and deploy the contract

In another PowerShell window:

```powershell
forge test --root contracts -vv
.venv\Scripts\python.exe scripts\deploy_blockchain.py
```

On Windows, if Forge has already produced the tested artifact but cannot find
its home directory when launched by Python, use:

```powershell
forge build --root contracts
.venv\Scripts\python.exe scripts\deploy_blockchain.py --skip-build
```

Deployment creates `.quorum/blockchain.json`. It contains only local RPC and
contract metadata, is excluded from Git and is loaded by FastAPI. The same
values can instead be supplied with `QUORUM_RPC_URL`,
`QUORUM_CONTRACT_ADDRESS`, `QUORUM_CHAIN_ID`, `QUORUM_ANCHOR_SELECTOR` and
`QUORUM_GET_ANCHOR_SELECTOR`.

## Anchor a release

Start Quorum, create a final verified, rejected or disagreement release, then
use the **Anchor evidence on Anvil** action in Audit History. The API endpoint is:

```text
POST /api/v1/releases/{release_id}/anchor
```

Quorum freezes the evidence first, hashes its canonical JSON, sends that hash
to the contract, saves the transaction receipt and appends a hash-linked audit
event. Repeating the request returns the existing report instead of creating a
second anchor.

## Download and verify the audit report

Audit History downloads the backend's actual `quorum.audit-report.v1` file.
Verify it without trusting the web interface:

```powershell
.venv\Scripts\python.exe scripts\verify_audit_report.py audit-report.json --trusted-report-key PUBLIC_KEY_FROM_TRUSTED_CHANNEL
```

That offline command checks:

- Evidence SHA-256
- Every Ed25519 builder signature
- Every link in the audit hash chain
- Policy SHA-256
- The quorum decision reconstructed from the evidence

The verifier also checks the report's Ed25519 signature and that displayed
artifact hashes match signed payloads. Without an independently obtained key,
it reports integrity only and the CLI exits nonzero. Never obtain your trust
pin solely from the report you are verifying. Protect the backend's
`*.report-key` file; it is excluded from Git.

By default the verifier is offline. For independent on-chain verification,
pass `--anchor-config trusted-chain.json`; this configuration must come from a
trusted channel separate from the report. Add `--require-public-anchor` to fail
closed unless the evidence matches a recognized public network. Explicit trusted
config files ignore `QUORUM_*` environment overrides.

The report endpoint also checks the anchor against the server's configured RPC
network and contract when available, but that remains a server observation.
The contract restricts writes to its deployer to prevent another account from
claiming a release ID first. Redeploy after upgrading the contract.

Anvil is a local development chain, not a public immutable network. The same
small contract can later be deployed to Sepolia without changing the evidence
format.

## Sepolia deployment with local signing

Quorum can sign EIP-1559 transactions locally and submit only the raw signed
transaction to an RPC provider. The private key is read from the process-only
`QUORUM_EVM_PRIVATE_KEY` environment variable and is never saved in the generated
configuration, report, SQLite database, or logs.

Use a separate test-only wallet funded with free Sepolia test ETH. Set the secret
through your shell or secret manager, then deploy with an explicit chain-ID check:

```powershell
$env:QUORUM_RPC_URL = "https://YOUR_SEPOLIA_RPC"
$env:QUORUM_EVM_PRIVATE_KEY = "YOUR_TEST_WALLET_PRIVATE_KEY"
.venv\Scripts\python.exe scripts\deploy_blockchain.py `
  --rpc-url $env:QUORUM_RPC_URL `
  --chain-id 11155111
```

The command refuses an RPC reporting a different chain ID and writes the public
contract address, selectors, sender and deployment receipt to
`.quorum/blockchain.json`. Keep the same two environment variables set while the
backend anchors evidence. Remove the private-key variable when finished:

```powershell
Remove-Item Env:QUORUM_EVM_PRIVATE_KEY
```

Never use a wallet containing real funds. An actual public deployment cannot be
completed without a user-controlled RPC endpoint, test wallet and faucet funds.
