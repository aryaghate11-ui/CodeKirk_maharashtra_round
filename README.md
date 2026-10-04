# Quorum

Quorum verifies whether a published software artifact matches independently reproduced builds from a pinned source commit.

## Run locally

On Windows, open PowerShell in this folder and run:

```powershell
.\start.ps1
```

Then open <http://127.0.0.1:8000>. The first run creates a local virtual environment and installs the free, open-source dependencies from the pinned lock file.

The SQLite database is created at `backend/data/quorum.db` and is intentionally excluded from Git.

## What the MVP includes

- FastAPI verification API
- SQLite release, builder, attestation and audit records
- Ed25519 builder-signature verification
- Expandable signed evidence with key, recipe and evidence fingerprints
- Configurable two-of-three quorum policy
- Hash-chained audit events
- Valid, tampered and builder-conflict demonstrations
- Versioned API contract shared by the FastAPI backend and React frontend
- Consumer-side SHA-256 hashing (the selected file never leaves the browser)
- Fail-closed frontend verification with no runtime mock-data fallback
- Real pinned-commit Go builder agent with isolated workspaces
- Three separately keyed builders: local, GitHub Actions, and GitLab CI
- Release-specific builder challenges that prevent cross-release attestation replay
- Fingerprint-approved builder trust with hash-chained approval/revocation history
- Pinned reproducibility recipes for `hey`, `fzf`, and `micro`
- Solidity evidence-anchor contract with local Anvil deployment
- Locally signed EIP-1559 transactions for Sepolia/public-chain anchoring
- Downloadable audit passport with offline signature, policy and hash-chain verification
- Fail-closed installation gate that runs an installer only after signed quorum verification
- Whole-database integrity scan with separate local/private and public-anchor status
- Fail-closed installation recommendations that separate reproducibility, source review, distribution monitoring and current builder trust
- Administrator-token protection for security-sensitive mutation endpoints

Synthetic Attack Lab keys are isolated from normal runtime builder/release APIs. Real builders use separately generated private keys stored outside the repository.

Builder cards distinguish seeded demo identities, local isolated workspaces,
hosted runners and explicitly declared physically independent builders. Quorum
does not infer physical or operator independence from a key or attestation.

## Run the real three-builder proof

Install the pinned Go `1.27.1` toolchain and follow
`docs/BUILDER_AGENT.md`. The coordinator creates one challenge; `local-builder`,
`github-actions`, and `gitlab-ci` independently produce signed JSON evidence; the
coordinator imports all three artifacts into the existing FastAPI verifier.

To run two fresh builds of every package recipe and compare their SHA-256 values:

```powershell
$env:QUORUM_GO_BINARY = ".quorum\toolchains\go\bin\go.exe"
.venv\Scripts\python.exe scripts\test_package_matrix.py
```

## Blockchain and audit passport

Quorum keeps full evidence in SQLite and stores only the frozen evidence SHA-256,
release ID hash, decision and conflict flag in the `QuorumEvidence` Solidity
contract. The free local demonstration uses Anvil chain `31337`.

Setup, deployment and offline verification commands are documented in
`docs/BLOCKCHAIN_AND_AUDIT.md`.

## API v1

- `GET /api/v1/health`
- `GET /api/v1/stats`
- `GET /api/v1/builders`
- `GET /api/v1/blockchain/status`
- `POST /api/v1/builders`
- `POST /api/v1/releases`
- `POST /api/v1/releases/{release_id}/attestations`
- `POST /api/v1/releases/{release_id}/anchor`
- `GET /api/v1/releases/{release_id}/audit-report`
- `GET /api/v1/releases/{release_id}/audit-events`
- `POST /api/v1/demo/verify`
- `GET /api/v1/releases`
- `GET /api/v1/releases/{release_id}`
- `GET /api/v1/releases/{release_id}/trust-summary`
- `POST /api/v1/releases/{release_id}/consumer-verifications`
- `GET /api/v1/releases/{release_id}/integrity`
- `GET /api/v1/integrity`
- Interactive API documentation: `/docs`

The older unversioned `/api/*` routes remain available for compatibility. The
v1 request and response contract is documented in `docs/API_CONTRACT_V1.md`.

The automatic installation gate and independent public-anchor checks are
documented in `docs/RELEASE_GATE.md`.

## Frontend data safety

The frontend always fails closed: if FastAPI is unavailable, it displays an error
and never substitutes mock verification evidence. Attack Lab fixtures are clearly
labelled synthetic backend exercises and never appear in normal release or builder lists.

`start.ps1` prints a generated local administrator token. Use **Admin locked**
in the header to unlock protected actions for the current browser tab. The
token is held in session storage and sent only in `X-Quorum-Admin-Token`.

## Test

```powershell
.venv\Scripts\python.exe -m unittest backend.test_main -v
```

