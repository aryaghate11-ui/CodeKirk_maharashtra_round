from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import platform
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


CONFIG_SCHEMA = "quorum.builder-config.v1"
RESULT_SCHEMA = "quorum.builder-result.v1"
ATTESTATION_SCHEMA = "quorum.attestation.v2"


def canonical_json(value: dict) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def load_config(path: Path) -> dict:
    config = json.loads(path.read_text(encoding="utf-8"))
    if config.get("schema_version") != CONFIG_SCHEMA:
        raise ValueError(f"Expected {CONFIG_SCHEMA}")
    for section in ("builder", "source", "build"):
        if not isinstance(config.get(section), dict):
            raise ValueError(f"Missing config section: {section}")
    commit = config["source"].get("commit", "")
    if len(commit) != 40 or any(character not in "0123456789abcdef" for character in commit):
        raise ValueError("source.commit must be a full lowercase 40-character Git commit")
    return config


def recipe_document(config: dict) -> dict:
    build = config["build"]
    source = config["source"]
    return {
        "schema_version": "quorum.build-recipe.v1",
        "repository_url": source["repository_url"],
        "source_commit": source["commit"],
        "artifact_name": build["artifact_name"],
        "toolchain": build["toolchain"],
        "command": build["command"],
        "environment": {
            "CGO_ENABLED": str(build.get("cgo_enabled", "0")),
            "GOARCH": build.get("goarch", "amd64"),
            "GOOS": build.get("goos", "linux"),
            "GOFLAGS": "-mod=readonly",
            "GOTOOLCHAIN": "local",
            "SOURCE_DATE_EPOCH": "0",
        },
    }


def recipe_sha256(config: dict) -> str:
    return hashlib.sha256(canonical_json(recipe_document(config)).encode()).hexdigest()


def generate_private_key(path: Path, *, overwrite: bool = False) -> Ed25519PrivateKey:
    if path.exists() and not overwrite:
        raise FileExistsError(f"Refusing to replace existing key: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    key = Ed25519PrivateKey.generate()
    path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return key


def load_private_key(path: Path) -> Ed25519PrivateKey:
    key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("Builder key must be Ed25519")
    return key


def encode_public_key(key: Ed25519PrivateKey) -> str:
    raw = key.public_key().public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    return base64.b64encode(raw).decode()


def run_command(command: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> str:
    try:
        completed = subprocess.run(
            command,
            cwd=cwd,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as error:
        details = (error.stderr or error.stdout or "no command output").strip()
        raise RuntimeError(
            f"Command failed in {cwd}: {' '.join(command)}\n{details}"
        ) from error
    return completed.stdout.strip()


def observed_environment(config: dict, go_version: str) -> str:
    runtime = config["builder"].get("runtime", "native")
    return " | ".join(
        (
            f"{platform.system()} {platform.release()} {platform.machine()}",
            go_version,
            runtime,
        )
    )[:200]


def signed_payload(config: dict, artifact_sha256: str, environment: str) -> dict:
    return {
        "schema_version": ATTESTATION_SCHEMA,
        "repository_url": config["source"]["repository_url"],
        "artifact_sha256": artifact_sha256,
        "artifact_name": config["build"]["artifact_name"],
        "builder_id": config["builder"]["id"],
        "environment_sha256": hashlib.sha256(environment.encode()).hexdigest(),
        "recipe_sha256": recipe_sha256(config),
        "source_commit": config["source"]["commit"],
    }


def build_release(
    config: dict,
    private_key: Ed25519PrivateKey,
    *,
    work_root: Path | None = None,
    keep_workdir: bool = False,
    tamper: bool = False,
) -> dict:
    git_binary = shutil.which("git")
    go_binary = os.getenv("QUORUM_GO_BINARY") or shutil.which("go")
    if not git_binary:
        raise RuntimeError("Git is required to run a builder")
    if not go_binary:
        raise RuntimeError("Go is required. Install the pinned toolchain or set QUORUM_GO_BINARY")

    go_version = run_command([go_binary, "version"], cwd=Path.cwd())
    expected_toolchain = config["build"]["toolchain"]
    if f"{expected_toolchain} " not in f"{go_version} ":
        raise RuntimeError(
            f"Pinned toolchain mismatch: expected {expected_toolchain}, observed {go_version}"
        )

    workspace = Path(
        tempfile.mkdtemp(prefix=f"quorum-{config['builder']['id']}-", dir=work_root)
    )
    source_dir = workspace / "source"
    artifact_dir = workspace / "artifact"
    artifact_dir.mkdir()
    artifact_path = artifact_dir / config["build"]["artifact_name"]

    try:
        run_command(
            [git_binary, "clone", "--filter=blob:none", "--no-checkout", config["source"]["repository_url"], str(source_dir)],
            cwd=workspace,
        )
        run_command(
            [git_binary, "checkout", "--detach", config["source"]["commit"]],
            cwd=source_dir,
        )
        checked_out = run_command([git_binary, "rev-parse", "HEAD"], cwd=source_dir)
        if checked_out != config["source"]["commit"]:
            raise RuntimeError(f"Pinned commit mismatch: got {checked_out}")

        build_env = os.environ.copy()
        build_env.update(recipe_document(config)["environment"])
        build_env["GOCACHE"] = str(workspace / "go-build-cache")
        build_env["GOMODCACHE"] = str(workspace / "go-module-cache")
        command = [
            go_binary if token == "go" else token.replace("{artifact}", str(artifact_path))
            for token in config["build"]["command"]
        ]
        run_command(command, cwd=source_dir, env=build_env)
        if not artifact_path.is_file():
            raise RuntimeError(f"Build did not produce {artifact_path}")
        if tamper:
            with artifact_path.open("ab") as artifact:
                artifact.write(b"\nQUORUM-INTENTIONAL-CONFLICT\n")

        artifact_hash = hashlib.sha256(artifact_path.read_bytes()).hexdigest()
        environment = observed_environment(config, go_version)
        payload = signed_payload(config, artifact_hash, environment)
        signature = base64.b64encode(
            private_key.sign(canonical_json(payload).encode())
        ).decode()
        public_key = encode_public_key(private_key)
        built_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        result = {
            "schema_version": RESULT_SCHEMA,
            "builder": {
                "id": config["builder"]["id"],
                "name": config["builder"]["name"],
                "operator": config["builder"]["operator"],
                "platform": environment,
                "public_key": public_key,
                "signing_key_fingerprint": hashlib.sha256(base64.b64decode(public_key)).hexdigest(),
            },
            "source": {
                "repository_url": config["source"]["repository_url"],
                "commit": checked_out,
            },
            "build": {
                "artifact_name": config["build"]["artifact_name"],
                "artifact_sha256": artifact_hash,
                "artifact_size": artifact_path.stat().st_size,
                "recipe": recipe_document(config),
                "recipe_sha256": recipe_sha256(config),
                "toolchain_observed": go_version,
                "environment": environment,
                "workspace_isolated": True,
                "intentionally_tampered": tamper,
            },
            "attestation": {
                "schema_version": ATTESTATION_SCHEMA,
                "builder_id": config["builder"]["id"],
                "artifact_sha256": artifact_hash,
                "environment": environment,
                "built_at": built_at,
                "signature": signature,
            },
            "signed_payload": payload,
        }
        if keep_workdir:
            result["workspace"] = str(workspace)
        return result
    finally:
        if not keep_workdir:
            shutil.rmtree(workspace, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Quorum reproducible builder agent")
    subparsers = parser.add_subparsers(dest="command", required=True)

    keygen_parser = subparsers.add_parser("keygen", help="Generate a builder signing key")
    keygen_parser.add_argument("--key", type=Path, required=True)

    run_parser = subparsers.add_parser("run", help="Build, hash and sign one pinned release")
    run_parser.add_argument("--config", type=Path, required=True)
    run_parser.add_argument("--key", type=Path, required=True)
    run_parser.add_argument("--output", type=Path, required=True)
    run_parser.add_argument("--work-root", type=Path)
    run_parser.add_argument("--generate-key", action="store_true")
    run_parser.add_argument("--keep-workdir", action="store_true")
    run_parser.add_argument("--tamper", action="store_true")
    args = parser.parse_args()

    if args.command == "keygen":
        key = generate_private_key(args.key)
        print(json.dumps({"key": str(args.key), "public_key": encode_public_key(key)}, indent=2))
        return

    config = load_config(args.config)
    if args.generate_key and not args.key.exists():
        generate_private_key(args.key)
    key = load_private_key(args.key)
    result = build_release(
        config,
        key,
        work_root=args.work_root,
        keep_workdir=args.keep_workdir,
        tamper=args.tamper,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "builder": result["builder"]["id"],
        "artifact_sha256": result["build"]["artifact_sha256"],
        "output": str(args.output),
    }, indent=2))


if __name__ == "__main__":
    main()

