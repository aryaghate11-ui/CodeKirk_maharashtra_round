# Quorum real builder agent

The builder agent turns a pinned source commit into signed evidence. It does not trust a maintainer-provided binary.

## What one builder does

1. Reads a versioned build recipe.
2. Checks that the installed compiler is exactly Go 1.27.1.
3. Clones `rakyll/hey` and checks out commit `e64ec7a3ad1ef8bc828fe61e1fb324cc2e74c604` in a fresh directory.
4. Builds `hey-linux-amd64` with a fixed target, disabled CGO, trimmed paths, disabled VCS stamping and an empty Go build ID.
5. Computes the artifact SHA-256.
6. Signs the source, recipe, environment and artifact hash with its own Ed25519 private key.
7. Writes a portable JSON evidence file. The private key never appears in that file.

## One-time setup on each laptop

Use one of the laptop profiles on each independently controlled machine:

```powershell
.venv\Scripts\python.exe -m builder.agent keygen --key .quorum\keys\laptop-one.pem
.venv\Scripts\python.exe -m builder.agent run --config configs\builders\laptop-one.json --key .quorum\keys\laptop-one.pem --output builder-results\laptop-one.json
```

On the second laptop, replace `laptop-one` with `laptop-two`. The `.quorum` and `builder-results` directories are excluded from Git.

Copy only the three result JSON files to the coordinator. Register their public
keys as pending without submitting attestations:

```powershell
.venv\Scripts\python.exe scripts\submit_builder_results.py --register-only `
  builder-results\github-actions.json `
  builder-results\laptop-one.json `
  builder-results\laptop-two.json
```

Registering a builder does not trust it. On the verifier host, inspect pending
fingerprints and approve each expected key through the local administrator CLI:

```powershell
.venv\Scripts\python.exe scripts\manage_builder_trust.py list
.venv\Scripts\python.exe scripts\manage_builder_trust.py approve `
  --builder laptop-one `
  --fingerprint REVIEWED_64_CHARACTER_SHA256 `
  --reason "Verified with operator through a second channel"
```

The approval fails if the reviewed fingerprint differs from the registered key.
Every registration, approval and revocation is added to a hash-chained trust log.
After approving all expected builders, import their already-signed evidence
without rebuilding it at the coordinator:

```powershell
.venv\Scripts\python.exe scripts\submit_builder_results.py builder-results\github-actions.json builder-results\laptop-one.json builder-results\laptop-two.json
```

For a real published release, also pass the consumer or publisher's independently
calculated hash with `--candidate-sha256`. The API verifies every signature again
before making its decision.

## Stronger release-specific challenge

For fresh participation proof, the coordinator first registers the publisher's
candidate artifact and obtains a random release ID:

```powershell
.venv\Scripts\python.exe scripts\create_release_challenge.py `
  --recipe configs\recipes\hey.json `
  --candidate .\hey-linux-amd64
```

Send the recipe path and returned release ID to each operator. Each operator runs:

```powershell
.venv\Scripts\python.exe -m builder.agent run `
  --config configs\builders\laptop-one.json `
  --recipe configs\recipes\hey.json `
  --release-id RELEASE_UUID `
  --key .quorum\keys\laptop-one.pem `
  --output builder-results\laptop-one.json
```

The release ID, build time and observed environment are covered by the Ed25519
signature, preventing evidence from another verification round being replayed.
Import the results into the existing release:

```powershell
.venv\Scripts\python.exe scripts\submit_builder_results.py `
  --release-id RELEASE_UUID `
  builder-results\github-actions.json `
  builder-results\laptop-one.json `
  builder-results\laptop-two.json
```

## Multi-package artifact integrity

Versioned recipes cover three real open-source applications: `rakyll/hey`,
`junegunn/fzf`, and `zyedidia/micro`. Each pins the full commit, Go toolchain,
target, environment and deterministic build flags.

```powershell
$env:QUORUM_GO_BINARY = ".quorum\toolchains\go\bin\go.exe"
.venv\Scripts\python.exe scripts\test_package_matrix.py
```

This runs two clean builds per package and writes
`builder-results/package-matrix.json`. Network/build errors are recorded as
errors, never as hash disagreements.

## GitHub Actions witness

The workflow in `.github/workflows/quorum-builder.yml` is manually triggered and uses only free, open-source tooling. Its inputs select a pinned recipe and optional release-specific challenge. Generate a GitHub witness key once, base64-encode the PEM file, and store it as the repository secret `QUORUM_BUILDER_PRIVATE_KEY_B64`. The workflow publishes `github-actions.json` as its run artifact.

Do not reuse a laptop key for GitHub Actions. A separate key is what makes the witness independently attributable.

## Local end-to-end proof

With the API running at `http://127.0.0.1:8000`, run:

```powershell
.venv\Scripts\python.exe scripts\run_three_builders.py --approve-local-builders
```

The command creates three local keys on first use, executes three isolated builds, registers the public keys, creates a release, submits all three signed attestations and saves `quorum-summary.json`.

Run the attack case with:

```powershell
.venv\Scripts\python.exe scripts\run_three_builders.py --approve-local-builders --tamper-builder laptop-two
```

The selected builder signs its changed hash honestly. Quorum detects that the hashes disagree and returns `disagreement` because the policy rejects any conflict.

## Honest decentralization claim

Three isolated runs on one laptop are useful protocol evidence, but they are not three independent operators. The deployable topology is one GitHub Actions witness plus two different laptops, each with a different private key. Quorum also requires distinct operator names among the matching builders before it accepts a release.

Operator names are self-declared in this MVP. A production deployment should
approve builder public keys through an organization policy or transparency registry.
