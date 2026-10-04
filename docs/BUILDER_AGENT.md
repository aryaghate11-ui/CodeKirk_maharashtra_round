# Three independent Quorum builders

Quorum uses exactly these runtime identities:

- `local-builder` — the coordinator operator's machine
- `github-actions` — a GitHub-hosted Actions runner
- `gitlab-ci` — a GitLab-hosted CI runner

Each identity owns a different Ed25519 private key. GitHub and GitLab never call
the private LAN API. They download source, check out the pinned commit, build,
hash, sign, and publish portable evidence JSON as a CI artifact. Only the
coordinator imports those files into FastAPI.

## 1. One-time keys

Create the local key outside Git:

```powershell
.venv\Scripts\python.exe -m builder.agent keygen --key .quorum\keys\local-builder.pem
```

Create the GitHub and GitLab keys on trusted machines, never in CI logs and never
in the repository:

```powershell
.venv\Scripts\python.exe -m builder.agent keygen --key github-actions.pem
.venv\Scripts\python.exe -m builder.agent keygen --key gitlab-ci.pem
```

Base64-encode each CI PEM without adding line breaks. Store the GitHub key as the
GitHub Actions secret `QUORUM_BUILDER_PRIVATE_KEY_B64`. Store the different
GitLab key as the protected, masked GitLab CI/CD variable with the same name.

## 2. Create one release challenge

Start FastAPI, set the admin token printed by `start.ps1`, and use the publisher
artifact obtained independently by the coordinator:

```powershell
$env:QUORUM_ADMIN_TOKEN = "TOKEN_PRINTED_BY_START_PS1"
.venv\Scripts\python.exe scripts\create_release_challenge.py `
  --recipe configs\recipes\hey.json `
  --candidate C:\path\to\publisher\hey-linux-amd64 `
  --output builder-challenge.json
```

The challenge contains no private key. It binds all builders to the same random
release ID, candidate SHA-256, exact source commit, and deterministic recipe.

Base64-encode `builder-challenge.json`. Store it as the GitHub Actions secret and
GitLab CI/CD variable `QUORUM_RELEASE_CHALLENGE_B64`. Replace this value for every
new release challenge.

## 3. Run the builders

Local:

```powershell
.venv\Scripts\python.exe -m builder.agent run `
  --config configs\builders\local-builder.json `
  --challenge builder-challenge.json `
  --key .quorum\keys\local-builder.pem `
  --output builder-results\local-builder.json
```

GitHub: open **Actions → Quorum reproducible builder → Run workflow**. Download
the `quorum-github-actions-evidence` artifact and extract
`github-actions.json` into `builder-results`.

GitLab: mirror/push the same commit to a GitLab project, open **Build → Pipelines
→ Run pipeline**, and download the `quorum-build-and-attest` job artifact.
Extract `gitlab-ci.json` into `builder-results`.

## 4. Register and approve keys

Registration is pending by default. Import public identities with the local admin
token:

```powershell
.venv\Scripts\python.exe scripts\run_three_builders.py `
  --local builder-results\local-builder.json `
  --github builder-results\github-actions.json `
  --gitlab builder-results\gitlab-ci.json `
  --register-only
```

Review each fingerprint with its operator through a separate channel, then approve:

```powershell
.venv\Scripts\python.exe scripts\manage_builder_trust.py list
.venv\Scripts\python.exe scripts\manage_builder_trust.py approve --builder local-builder --fingerprint REVIEWED_SHA256 --reason "Key verified out of band"
.venv\Scripts\python.exe scripts\manage_builder_trust.py approve --builder github-actions --fingerprint REVIEWED_SHA256 --reason "GitHub key verified out of band"
.venv\Scripts\python.exe scripts\manage_builder_trust.py approve --builder gitlab-ci --fingerprint REVIEWED_SHA256 --reason "GitLab key verified out of band"
```

## 5. Import signed evidence

```powershell
.venv\Scripts\python.exe scripts\run_three_builders.py `
  --local builder-results\local-builder.json `
  --github builder-results\github-actions.json `
  --gitlab builder-results\gitlab-ci.json
```

The importer refuses missing/extra identities, duplicate operators, different
challenges, source commits, recipes, release IDs, or registry-key fingerprints.
FastAPI then reconstructs the signed payload, verifies Ed25519, applies the saved
quorum policy, records the audit chain, and exposes the decision to the website.

## Honest scope

A configuration or local test cannot prove that hosted CI actually ran. Downloaded
GitHub and GitLab artifacts from successful hosted jobs are the operational proof.
The website shows only registered runtime identities and backend decisions; absent
evidence remains `PENDING`.
