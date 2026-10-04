# Quorum API contract v1

The React app and FastAPI backend communicate through JSON under `/api/v1`.
JSON field names use `snake_case`. Every verification response includes
`schema_version: "quorum.api.v1"`, so incompatible future changes can use a new
version without silently breaking the frontend.

FastAPI also publishes the machine-readable OpenAPI contract at
`/openapi.json` and interactive documentation at `/docs` while the local server
is running.

## Endpoints

### `GET /api/v1/health`

Checks that the real verifier is reachable. A valid response is JSON containing
`status: "ok"` and `api_version: "v1"`. The frontend checks both values so a
static HTML fallback cannot be mistaken for the backend.

### Administrator authorization

Security-sensitive mutations require `X-Quorum-Admin-Token`. With no
`QUORUM_ADMIN_TOKEN` environment variable, Quorum generates a random token in
the ignored `.quorum/admin-token` file and `start.ps1` prints it locally.
`POST /api/v1/auth/verify` validates the token without exposing it.

### `GET /api/v1/stats`

Returns live release totals and trusted-builder counts from SQLite. The frontend
maps these wire-format `snake_case` fields into its display model.

### `GET /api/v1/builders`

Returns the builder registry, including approval/evidence state, public-key
fingerprints, latest signed artifact hash, signature result, build count and
measured agreement rate. `liveness_status` is `UNKNOWN` until a real heartbeat
protocol exists; registration or approval is never presented as proof that a
machine is online. Private keys are never stored by the API.

### `POST /api/v1/builders`

Enrolls a builder's Ed25519 public key and display metadata. A builder ID is
permanently bound to its first key; attempting to replace that key returns
`409 Conflict`.

### `POST /api/v1/releases`

Registers the pinned repository URL, full source commit, artifact name, build
recipe SHA-256, candidate artifact SHA-256 and quorum policy. `expected_builders`
belongs to this release, so unrelated builders in the registry do not keep a
decision pending.

### `POST /api/v1/releases/{release_id}/attestations`

Accepts a `quorum.attestation.v2` statement from one registered builder. The
API recreates the canonical signed payload, verifies the Ed25519 signature and
then reevaluates quorum and conflict rules. The v2 signed payload excludes API
timestamps and release IDs so separately produced evidence can be transported
to the verifier without first trusting that verifier.

### `GET /api/v1/blockchain/status`

Reports whether the configured Anvil RPC is reachable, its chain ID, the
deployed `QuorumEvidence` address and its deployment transaction.

### `POST /api/v1/releases/{release_id}/anchor`

Freezes the current final evidence, hashes its canonical JSON and submits that
SHA-256 to the configured contract. Pending releases cannot be anchored. The
operation is idempotent for a release that already has a stored anchor.

### `GET /api/v1/releases/{release_id}/audit-report`

Downloads `quorum.audit-report.v1`. It includes the frozen evidence, public
builder keys, signed payloads, signatures, policy, decision, hash-linked audit
events, evidence SHA-256 and blockchain receipt. Private keys and artifact
bytes are never included.

### `GET /api/v1/releases/{release_id}/audit-events`

Returns the release's ordered hash-linked event records, including its
blockchain anchoring event when present.

### `POST /api/v1/demo/verify`

Creates and evaluates a signed demonstration release.

```json
{
  "scenario": "valid",
  "policy": "2-of-3"
}
```

`scenario` is `valid`, `tampered`, or `conflict`. `policy` is `2-of-3` or
`3-of-3`. The response contains the release, builder evidence, signature and
quorum rule results, the consensus hash, decision, and hash-chained audit
events.

### `GET /api/v1/releases`

Returns up to the 50 most recent release verification records.

### `GET /api/v1/releases/{release_id}`

Returns one complete release verification record using the same response shape
as the demo endpoint.

### `GET /api/v1/releases/{release_id}/trust-summary`

Returns the canonical `quorum.trust-summary.v1` view used by every frontend
page. It combines the historical quorum decision with current Living
Verification, Source Sentinel, Quorum Relay and blockchain-anchor state, then
returns one current status, one installation decision and one explanation. An
invalid Living Verification incident chain or a confirmed blockchain anchor
mismatch fails closed and blocks installation.

The response separates `artifact_reproducibility`, `source_sentinel`, `relay`,
`living_verification`, and `blockchain`. `overall_recommendation` is
`INSTALL_RECOMMENDED`, `REVIEW_REQUIRED`, or `DO_NOT_INSTALL`. A reproducible
artifact with no approved source review or no matching distribution monitor is
`REVIEW_REQUIRED`, never “safe to install.”

### `POST /api/v1/releases/{release_id}/consumer-verifications`

Compares a SHA-256 calculated in the consumer's browser with the independent
builder consensus.

```json
{
  "artifact_name": "hey-linux-amd64",
  "artifact_sha256": "73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f"
}
```

Only the filename and SHA-256 fingerprint are sent. File bytes remain on the
consumer's device. The response returns `hash_matches`, the current quorum
status, a final consumer decision, a reason, and the new audit-chain head.

Consumer decisions are:

- `accepted`: the local file hash matches sufficient independent evidence.
- `rejected`: the local file hash does not match builder consensus.
- `conflict`: the file matches a result, but the active policy rejects builder disagreement.
- `pending`: the hash may match, but there is not yet enough evidence.

## Frontend types

## Configurable policies and security exercises

`POST /api/v1/releases` also accepts `policy` and an optional full `recipe`.
Recipe JSON must hash to `recipe_sha256` and match the release source/artifact.
Policy fields: `mode` (`k-of-n`, `majority`, `all`), `threshold`,
`expected_builders`, `minimum_operators`, `reject_on_conflict`.

`POST /api/v1/releases/{release_id}/evaluate` accepts a policy and returns
`release_id`, `policy`, `status`, `consensus_sha256`, `candidate_sha256`,
`attestation_count`, `rules`, and `scope`. It logs the evaluation without
overwriting the release's original policy.

`GET /api/v1/releases/{release_id}/integrity` returns `valid`, `trusted`,
`checks`, `errors`, `warning`, `scope`, and `report_public_key`. Trust here is
relative to this backend's local key, not an independent external checkpoint.

`POST /api/v1/attack-lab/run` takes `scenario` and optional `policy`. The response
contains `scenario`, `passed`, `observed_rejections`, `report_check`,
`verification`, and `evidence_mode`. See `STEPS_5_8.md` for all eight scenarios.

Audit reports additionally contain `report_signature` (`algorithm`, `public_key`,
`signature`). It signs canonical JSON of every top-level field except
`report_signature`. Offline consumers must pin a report public key obtained
independently to treat a report as trusted.

## Frontend mapping

Wire-format interfaces live in `src/types/api.ts`. Mapping into the existing UI
model is kept in `src/services/api.ts`, which prevents backend naming details
from leaking throughout the components.
