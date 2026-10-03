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
- Static fallback mode for the hosted dashboard

The demo builder keys are deterministic and exist only to demonstrate the end-to-end signature flow. Real builders must use separately generated private keys stored outside the repository.

## API v1

- `GET /api/v1/health`
- `GET /api/v1/stats`
- `POST /api/v1/demo/verify`
- `GET /api/v1/releases`
- `GET /api/v1/releases/{release_id}`
- `POST /api/v1/releases/{release_id}/consumer-verifications`
- Interactive API documentation: `/docs`

The older unversioned `/api/*` routes remain available for compatibility. The
v1 request and response contract is documented in `docs/API_CONTRACT_V1.md`.

## Test

```powershell
.venv\Scripts\python.exe -m unittest backend.test_main -v
```

