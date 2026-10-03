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

### `GET /api/v1/stats`

Returns live release totals and trusted-builder counts from SQLite. The frontend
maps these wire-format `snake_case` fields into its display model.

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

Wire-format interfaces live in `src/types/api.ts`. Mapping into the existing UI
model is kept in `src/services/api.ts`, which prevents backend naming details
from leaking throughout the components.
