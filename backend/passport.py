"""Signed evidence envelopes. Distribute the signing public key out-of-band."""
import base64
import hashlib
import json
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from backend.policy import QuorumPolicy, decide


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def sign_report(report: dict, key_path: Path) -> dict:
    key_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with key_path.open('xb') as stream:
            stream.write(Ed25519PrivateKey.generate().private_bytes(
                serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption()))
    except FileExistsError:
        pass
    key = Ed25519PrivateKey.from_private_bytes(key_path.read_bytes())
    return {**report, 'report_signature': {
        'algorithm': 'Ed25519',
        'public_key': base64.b64encode(key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode(),
        'signature': base64.b64encode(key.sign(canonical(report))).decode()}}


def verify_passport(report: dict, trusted_report_key: str | None = None) -> dict:
    checks = {}
    errors = []
    try:
        signature = report['report_signature']
        unsigned = {k: v for k, v in report.items() if k != 'report_signature'}
        Ed25519PublicKey.from_public_bytes(base64.b64decode(signature['public_key'], validate=True)).verify(
            base64.b64decode(signature['signature'], validate=True), canonical(unsigned))
        checks['report_signature'] = signature['algorithm'] == 'Ed25519'
        checks['trusted_signer'] = signature['public_key'] == trusted_report_key if trusted_report_key else None
        evidence = report['evidence']
        release = evidence['release']
        checks['schema'] = report['schema_version'] == 'quorum.audit-report.v1' and evidence['schema_version'] == 'quorum.evidence.v1'
        checks['release_binding'] = report['release_id'] == release['id']
        checks['evidence_sha256'] = hashlib.sha256(canonical(evidence)).hexdigest() == report['evidence_sha256']
        checks['policy_sha256'] = hashlib.sha256(canonical(evidence['policy'])).hexdigest() == evidence['policy_sha256']
        if evidence.get('recipe') is not None:
            checks['recipe_binding'] = hashlib.sha256(canonical(evidence['recipe'])).hexdigest() == release['recipe_sha256'] and all(
                evidence['recipe'].get(k) == release[k] for k in ('source_commit', 'repository_url', 'artifact_name'))
        previous = '0' * 64
        for event in evidence['audit_events']:
            digest = hashlib.sha256(f"{previous}|{event['event_type']}|{event['event_json']}|{event['created_at']}".encode()).hexdigest()
            if event['previous_hash'] != previous or event['event_hash'] != digest:
                raise ValueError('Modified, missing, or reordered audit event')
            previous = digest
        checks['audit_hash_chain'] = bool(evidence['audit_events']) and previous == evidence['audit_chain_head']
        for builder in evidence['builders']:
            payload = builder['signed_payload']
            if payload['schema_version'] not in ('quorum.attestation.v1', 'quorum.attestation.v2'):
                raise ValueError('Unsupported attestation schema')
            for field in ('repository_url', 'source_commit', 'recipe_sha256', 'artifact_name'):
                if payload[field] != release[field]:
                    raise ValueError(f'Attestation does not bind to release {field}')
            if payload['builder_id'] != builder['id'] or payload['artifact_sha256'] != builder['artifact_sha256']:
                raise ValueError('Displayed builder or artifact differs from signed payload')
            if payload['environment_sha256'] != hashlib.sha256(builder['environment'].encode()).hexdigest():
                raise ValueError('Environment differs from signed payload')
            if payload['schema_version'] == 'quorum.attestation.v1' and (
                payload['release_id'] != release['id'] or payload['built_at'] != builder['built_at'] or payload['environment'] != builder['environment']):
                raise ValueError('Replayed v1 attestation')
            Ed25519PublicKey.from_public_bytes(base64.b64decode(builder['public_key'], validate=True)).verify(
                base64.b64decode(builder['signature'], validate=True), canonical(payload))
        checks['builder_signatures'] = True
        result = decide(evidence['builders'], release['candidate_sha256'], QuorumPolicy.model_validate(evidence['policy']))
        checks['quorum_decision'] = all(result[k] == evidence['decision'][k] for k in result)
    except Exception as error:
        checks['integrity'] = False
        errors.append(str(error) or type(error).__name__)
    valid = bool(checks) and all(v for v in checks.values() if v is not None)
    return dict(valid=valid, trusted=valid and checks.get('trusted_signer') is True,
                checks=checks, errors=errors,
                warning=None if trusted_report_key else 'Integrity only: no out-of-band report signing key was supplied.')
