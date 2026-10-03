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

The offline verifier does not query a blockchain. The report endpoint checks
the anchor against the server's configured RPC network and contract when
available. This is a server observation, not independent consumer verification.
The contract restricts writes to its deployer to prevent another account from
claiming a release ID first. Redeploy after upgrading the contract.

Anvil is a local development chain, not a public immutable network. The same
small contract can later be deployed to Sepolia without changing the evidence
format.
