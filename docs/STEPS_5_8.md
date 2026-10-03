# Steps 5–8: local implementation

## Run

```powershell
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
npm run build
.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
.venv\Scripts\python.exe -m unittest backend.test_main backend.test_security -v
```

Open http://127.0.0.1:8000. This is a local implementation, not an update to the
hosted static website or a deployed public backend.

## 5. Configurable consumer policies

`POST /api/v1/releases` accepts an optional `policy`:

```json
{"mode":"k-of-n","threshold":2,"expected_builders":3,"minimum_operators":2,"reject_on_conflict":true}
```

Modes: `k-of-n` (including 2-of-3 and 3-of-3), `majority`, `all`. Majority/all
derive the required matches from expected_builders, not the number of replies.
`POST /api/v1/releases/{id}/evaluate` accepts the same policy to replay existing
evidence without changing the original release policy. The evaluation is logged.
Attack Lab exposes these controls for its three-builder exercises.

## 6. Evidence Passport

`GET /api/v1/releases/{id}/audit-report` downloads the signed JSON report:
source commit, repository, artifact/candidate hashes, recipe digest, builder
public keys and signed payloads, policy, replayable decision, audit events/head,
and optional anchor receipt. The builder-results importer embeds the full recipe,
validated against its digest and source binding. Legacy and demo releases without
a recipe explicitly report `recipe_available: false`.

Use `scripts/verify_audit_report.py` with `--trusted-report-key` obtained through
a trusted channel. It verifies report and builder signatures, payload bindings,
duplicate identities/keys, policy replay and the entire included audit chain.
Integrity validity and signer trust are separate results.

## 7. Tamper resistance

Reports are Ed25519-signed using a persistent local key. Edited reports remain
invalid even if an attacker recomputes their SHA-256. Missing/reordered events
break chain verification; modification of a downloaded report breaks its
signature. Stored builder signatures are checked again when evidence is read.
`GET /api/v1/releases/{id}/integrity` checks the current report.

Optional Solidity/Anvil anchoring stores an immutable evidence snapshot digest.
See BLOCKCHAIN_AND_AUDIT.md. An anchored report describes that frozen snapshot,
not attestations or events added later. Anvil can be reset; it is not public
decentralized permanence. No Sepolia deployment is claimed.

An administrator controlling both the database and report private key can
rewrite and re-sign history. Retain independent signed reports/checkpoints or
use an independently operated public anchor to detect this. Local integrity
checks alone cannot detect a fully rewritten and re-signed history.

## 8. Backend-driven Attack Lab

`POST /api/v1/attack-lab/run` takes `scenario` and optional `policy`. Scenarios:
`valid`, `modified-candidate`, `conflicting-output`, `invalid-signature`,
`unknown-builder`, `wrong-commit`, `replay`, `modified-report`.

The fixture bytes and demo keys are synthetic, but hashing, signing, submission
rejections and policy checks are real. No new source build occurs in an exercise.
An invalid third submission can be rejected while two valid builders still meet
a 2-of-3 policy. The UI displays both outcomes and never substitutes mock data.
Attack exercises create labelled fixture releases in the local audit database.

V1 attestations bind to a release ID. V2 attestations are deliberately reusable
for the same source/recipe/artifact across releases; duplicate submissions to
one release are rejected. This is not a claim of universal replay prevention.

## Before public deployment

Builder enrollment is a local trusted-admin workflow, not permissionless trust.
Operator names are assertions, not proof of separate organizations. Add API
authentication/authorization, approved trust-root enrollment, rate limits,
protected key storage, and independent operators before exposing this backend
to the internet. Demo signing keys are public and must not become production
trust roots. Multi-host independence and public-chain permanence remain separate
deployment work.
