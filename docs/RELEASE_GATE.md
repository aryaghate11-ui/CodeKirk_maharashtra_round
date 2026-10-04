# Release decision and tamper resistance

## Automatic installation gate

`scripts/quorum_install_gate.py` hashes the local artifact, downloads its signed
Evidence Passport, verifies the pinned report key, replays all builder signatures,
the audit chain and quorum policy, and checks both the consensus hash and published
candidate hash. It executes the installer command only when every required check
passes. Errors, pending quorum, conflict, rejection, or missing evidence block it.

```powershell
.venv\Scripts\python.exe scripts\quorum_install_gate.py `
  --release-id RELEASE_UUID `
  --artifact .\hey-linux-amd64 `
  --trusted-report-key BASE64_PUBLIC_KEY `
  -- .\hey-linux-amd64
```

Replace the final command with the real installer command. Use `{artifact}` as an
argument placeholder when needed. Omitting the installer command performs a safe
decision-only check.

For a release that must also have a public checkpoint:

```powershell
.venv\Scripts\python.exe scripts\quorum_install_gate.py `
  --release-id RELEASE_UUID `
  --artifact .\hey-linux-amd64 `
  --trusted-report-key BASE64_PUBLIC_KEY `
  --anchor-config .\trusted-sepolia.json `
  --require-public-anchor
```

The trusted report key and chain configuration must be distributed separately
from the report and website. Otherwise a compromised server could replace both.

## Tamper checks

`GET /api/v1/integrity` scans every release and reports signed-report, builder
signature, policy replay, and audit-chain results per release. It separately
reports `externally_anchored_count` and `external_anchoring_complete`; a local
Anvil checkpoint is never presented as an independent public anchor.

An independent report check can query the trusted chain directly:

```powershell
.venv\Scripts\python.exe scripts\verify_audit_report.py audit-report.json `
  --trusted-report-key BASE64_PUBLIC_KEY `
  --anchor-config .\trusted-sepolia.json `
  --require-public-anchor
```

Deploying and funding the contract on Sepolia is an operator action. Until that
transaction exists, the system truthfully reports public anchoring as incomplete.
