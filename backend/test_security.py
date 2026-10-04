import base64
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from backend import main
from backend import blockchain
from backend.passport import sign_report, verify_passport
from backend.policy import QuorumPolicy, decide
from scripts.quorum_install_gate import evaluate_installation


class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous = main.DB_PATH
        main.DB_PATH = Path(self.temp.name) / 'test.db'
        main.init_db()
        self.client = TestClient(main.app)

    def tearDown(self):
        self.client.close()
        main.DB_PATH = self.previous
        self.temp.cleanup()

    def report(self):
        result = main.run_demo_verification('valid')
        return main.generate_audit_report(result['release_id'])

    def resign(self, report):
        report.pop('report_signature', None)
        report['evidence_sha256'] = hashlib.sha256(main.canonical_json(report['evidence']).encode()).hexdigest()
        return sign_report(report, main.DB_PATH.with_suffix('.report-key'))

    def test_all_eight_attack_endpoints(self):
        for scenario in main.AttackRequest.model_fields['scenario'].annotation.__args__:
            with self.subTest(scenario=scenario):
                response = self.client.post('/api/v1/attack-lab/run', json={'scenario': scenario})
                self.assertEqual(response.status_code, 200, response.text)
                result = response.json()
                self.assertTrue(result['passed'], result)
                self.assertIn('Synthetic', result['evidence_mode'])

    def test_policy_modes(self):
        self.assertEqual(QuorumPolicy(mode='majority', expected_builders=5).threshold, 3)
        self.assertEqual(QuorumPolicy(mode='all', expected_builders=5).threshold, 5)
        for invalid in ({'threshold': 4}, {'minimum_operators': 4}, {'expected_builders': 0}):
            with self.assertRaises(ValueError):
                QuorumPolicy(**invalid)

    def test_policy_operator_count_and_conflict(self):
        rows = [dict(id=str(i), operator='same', artifact_sha256='a') for i in range(3)]
        self.assertEqual(decide(rows, 'a', QuorumPolicy())['status'], 'rejected')
        self.assertEqual(decide(rows, 'a', QuorumPolicy(minimum_operators=1))['status'], 'verified')
        rows[2]['artifact_sha256'] = 'b'
        self.assertEqual(decide(rows, 'a', QuorumPolicy(minimum_operators=1))['status'], 'disagreement')
        self.assertEqual(decide(rows, 'a', QuorumPolicy(minimum_operators=1, reject_on_conflict=False))['status'], 'verified')

    def test_duplicate_identity_and_key(self):
        for rows in ([dict(id='a', operator='a', artifact_sha256='x')] * 2,
                     [dict(id=str(i), public_key='same', operator=str(i), artifact_sha256='x') for i in range(2)]):
            with self.assertRaises(ValueError):
                decide(rows, 'x', QuorumPolicy())

    def test_policy_api_does_not_change_release_policy(self):
        report = self.report()
        release_id = report['release_id']
        response = self.client.post(f'/api/v1/releases/{release_id}/evaluate', json={'mode': 'all'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['policy']['threshold'], 3)
        self.assertEqual(main.get_release_record(release_id)['threshold'], 2)

    def test_new_builder_requires_fingerprint_checked_approval(self):
        private_key = Ed25519PrivateKey.generate()
        public_key = main.encode_public_key(private_key.public_key())
        builder_id = 'pending-builder'
        registered = main.register_builder(main.BuilderRegistrationRequest(
            id=builder_id, name='Pending Builder', operator='Independent Operator',
            platform='separate machine', public_key=public_key))
        self.assertFalse(registered['trusted'])

        created = main.create_release(main.ReleaseCreate(
            repository_url='https://github.com/rakyll/hey', source_commit=main.DEMO_SOURCE_COMMIT,
            artifact_name='hey-linux-amd64', recipe_sha256=main.DEMO_RECIPE_SHA256,
            candidate_sha256=main.GOOD_ARTIFACT_SHA256))
        unsigned = main.AttestationCreate(
            builder_id=builder_id, artifact_sha256=main.GOOD_ARTIFACT_SHA256,
            environment='separate machine', built_at=main.utc_now(), signature='pending')
        with main.connect() as db:
            release = db.execute('SELECT * FROM releases WHERE id = ?', (created['id'],)).fetchone()
        signature = base64.b64encode(private_key.sign(
            main.canonical_json(main.attestation_payload(release, unsigned)).encode())).decode()
        signed = unsigned.model_copy(update={'signature': signature})
        with self.assertRaises(main.HTTPException) as refused:
            main.submit_attestation(created['id'], signed)
        self.assertEqual(refused.exception.status_code, 403)

        with self.assertRaises(ValueError):
            main.set_builder_trust(builder_id, trusted=True, expected_fingerprint='0' * 64,
                                   reason='Incorrect review')
        fingerprint = hashlib.sha256(base64.b64decode(public_key)).hexdigest()
        approved = main.set_builder_trust(builder_id, trusted=True,
            expected_fingerprint=fingerprint, reason='Verified through a second channel')
        self.assertTrue(approved['trusted'])
        self.assertEqual(main.submit_attestation(created['id'], signed)['attestation_count'], 1)
        self.assertTrue(main.verify_builder_trust_chain()['valid'])

        main.set_builder_trust(builder_id, trusted=False,
            expected_fingerprint=fingerprint, reason='Operator access revoked')
        self.assertFalse(next(item for item in main.list_builders() if item['id'] == builder_id)['trusted'])

    def test_builder_trust_audit_chain_detects_tampering(self):
        self.assertTrue(main.verify_builder_trust_chain()['valid'])
        with main.connect() as db:
            db.execute("UPDATE builder_trust_events SET reason = 'changed' WHERE id = 1")
        self.assertFalse(main.verify_builder_trust_chain()['valid'])

    def test_passport_binds_builder_trust_approvals(self):
        report = self.report()
        self.assertTrue(verify_passport(report)['checks']['builder_trust_approvals'])
        report['evidence']['builder_trust_events'][0]['reason'] = 'forged approval reason'
        self.assertFalse(verify_passport(self.resign(report))['valid'])

    def test_public_chain_transaction_is_locally_signed(self):
        from eth_account import Account
        account = Account.create()
        calls = []

        def fake_rpc(_url, method, params):
            calls.append((method, params))
            return {
                'eth_getTransactionCount': '0x0',
                'eth_getBlockByNumber': {'baseFeePerGas': '0x3b9aca00'},
                'eth_maxPriorityFeePerGas': '0x59682f00',
                'eth_sendRawTransaction': '0x' + '12' * 32,
            }[method]

        config = blockchain.BlockchainConfig(
            rpc_url='https://rpc.example.invalid', chain_id=11155111,
            contract_address='0x' + '11' * 20, from_address=account.address,
            anchor_selector='12345678', get_anchor_selector='87654321',
            private_key=account.key.hex())
        with patch('backend.blockchain.rpc_call', side_effect=fake_rpc):
            transaction_hash, sender = blockchain.broadcast_transaction(
                config, to=config.contract_address, data='0x1234', gas=100_000)
        self.assertEqual(sender, account.address)
        self.assertEqual(transaction_hash, '0x' + '12' * 32)
        raw_calls = [params for method, params in calls if method == 'eth_sendRawTransaction']
        self.assertEqual(len(raw_calls), 1)
        self.assertTrue(raw_calls[0][0].startswith('0x'))

    def test_consumer_release_decision_is_fail_closed(self):
        valid = main.run_demo_verification('valid')
        accepted = main.verify_consumer_artifact(valid['release_id'], main.ConsumerArtifactRequest(
            artifact_name='hey-linux-amd64', artifact_sha256=main.GOOD_ARTIFACT_SHA256))
        self.assertEqual(accepted['decision'], 'accepted')

        compromised = main.run_demo_verification('tampered')
        rejected = main.verify_consumer_artifact(compromised['release_id'], main.ConsumerArtifactRequest(
            artifact_name='hey-linux-amd64', artifact_sha256=main.GOOD_ARTIFACT_SHA256))
        self.assertEqual(rejected['quorum_status'], 'rejected')
        self.assertEqual(rejected['decision'], 'rejected')

        conflict = main.run_demo_verification('conflict')
        refused = main.verify_consumer_artifact(conflict['release_id'], main.ConsumerArtifactRequest(
            artifact_name='hey-linux-amd64', artifact_sha256=main.GOOD_ARTIFACT_SHA256))
        self.assertEqual(refused['decision'], 'conflict')

    def test_install_gate_requires_signed_verified_candidate(self):
        report = self.report()
        key = report['report_signature']['public_key']
        accepted = evaluate_installation(report,
            artifact_sha256=main.GOOD_ARTIFACT_SHA256,
            artifact_name='hey-linux-amd64', trusted_report_key=key)
        self.assertTrue(accepted['accepted'])

        for changes in (
            {'artifact_sha256': '0' * 64},
            {'artifact_name': 'different-file'},
            {'trusted_report_key': main.encode_public_key(Ed25519PrivateKey.generate().public_key())},
            {'require_public_anchor': True},
        ):
            arguments = dict(artifact_sha256=main.GOOD_ARTIFACT_SHA256,
                             artifact_name='hey-linux-amd64', trusted_report_key=key)
            arguments.update(changes)
            with self.subTest(changes=changes):
                self.assertFalse(evaluate_installation(report, **arguments)['accepted'])

    def test_system_integrity_scans_all_releases_and_surfaces_tampering(self):
        first = main.run_demo_verification('valid')['release_id']
        second = main.run_demo_verification('valid')['release_id']
        clean = self.client.get('/api/v1/integrity')
        self.assertEqual(clean.status_code, 200)
        self.assertTrue(clean.json()['valid'])
        self.assertEqual(clean.json()['release_count'], 2)

        with main.connect() as db:
            db.execute("UPDATE audit_events SET event_json = '{}' WHERE release_id = ?", (second,))
        damaged = self.client.get('/api/v1/integrity').json()
        self.assertFalse(damaged['valid'])
        self.assertEqual(damaged['valid_release_count'], 1)
        by_id = {item['release_id']: item for item in damaged['releases']}
        self.assertTrue(by_id[first]['valid'])
        self.assertFalse(by_id[second]['valid'])

    def test_report_key_pin_required_for_trust(self):
        report = self.report()
        self.assertTrue(verify_passport(report)['valid'])
        self.assertFalse(verify_passport(report)['trusted'])
        self.assertTrue(verify_passport(report, report['report_signature']['public_key'])['trusted'])
        self.assertFalse(verify_passport(report, main.encode_public_key(Ed25519PrivateKey.generate().public_key()))['valid'])

    def test_rehashing_modified_report_does_not_bypass_signature(self):
        report = self.report()
        report['evidence']['builders'][0]['operator'] = 'attacker'
        report['evidence_sha256'] = hashlib.sha256(main.canonical_json(report['evidence']).encode()).hexdigest()
        self.assertFalse(verify_passport(report)['valid'])

    def test_builder_payload_binding_even_when_report_is_signed(self):
        for field in ('artifact_sha256', 'id', 'environment'):
            with self.subTest(field=field):
                report = self.report()
                report['evidence']['builders'][0][field] = 'changed'
                self.assertFalse(verify_passport(self.resign(report))['valid'])

    def test_missing_or_reordered_events(self):
        for mode in ('missing', 'reordered'):
            report = self.report()
            events = report['evidence']['audit_events']
            if mode == 'missing':
                events.pop(1)
            else:
                events[1], events[2] = events[2], events[1]
            self.assertFalse(verify_passport(self.resign(report))['valid'])

    def test_malformed_reports_fail_closed(self):
        for report in ({}, None, [], {'report_signature': None}):
            self.assertFalse(verify_passport(report)['valid'])

    def test_stored_attestation_tampering_fails_closed(self):
        report = self.report()
        with main.connect() as db:
            db.execute('UPDATE attestations SET artifact_sha256 = ?', ('0' * 64,))
        with self.assertRaises(main.HTTPException):
            main.generate_audit_report(report['release_id'])

    def test_policy_validation_http(self):
        response = self.client.post('/api/v1/attack-lab/run', json={'scenario': 'valid', 'policy': {'threshold': 4}})
        self.assertEqual(response.status_code, 422)

    def test_recipe_binding(self):
        recipe = dict(repository_url='https://github.com/rakyll/hey', source_commit=main.DEMO_SOURCE_COMMIT,
                      artifact_name='hey-linux-amd64', command=['go', 'build'])
        digest = hashlib.sha256(main.canonical_json(recipe).encode()).hexdigest()
        created = main.create_release(main.ReleaseCreate(repository_url=recipe['repository_url'],
            source_commit=recipe['source_commit'], artifact_name=recipe['artifact_name'],
            recipe_sha256=digest, recipe=recipe, candidate_sha256=main.GOOD_ARTIFACT_SHA256))
        report = main.generate_audit_report(created['id'])
        self.assertEqual(report['evidence']['recipe'], recipe)
        self.assertTrue(verify_passport(report)['checks']['recipe_binding'])
        with self.assertRaises(ValueError):
            main.ReleaseCreate(repository_url=recipe['repository_url'], source_commit=recipe['source_commit'],
                recipe_sha256='0' * 64, recipe=recipe, candidate_sha256=main.GOOD_ARTIFACT_SHA256)

    def test_invalid_stored_audit_refuses_passport(self):
        report = self.report()
        with main.connect() as db:
            db.execute("UPDATE audit_events SET event_json = '{}' WHERE release_id = ?", (report['release_id'],))
        with self.assertRaises(main.HTTPException):
            main.generate_audit_report(report['release_id'])

    def test_legacy_attestations_remain_readable_and_verifiable(self):
        verification = main.run_demo_verification('valid')
        release_id = verification['release_id']
        builder_id = 'northstar-ci'
        with main.connect() as db:
            row = db.execute('SELECT * FROM attestations WHERE release_id = ? AND builder_id = ?',
                             (release_id, builder_id)).fetchone()
            release = db.execute('SELECT * FROM releases WHERE id = ?', (release_id,)).fetchone()
            legacy = {
                'artifact_sha256': row['artifact_sha256'], 'builder_id': builder_id,
                'built_at': row['built_at'], 'environment': row['environment'],
                'recipe_sha256': release['recipe_sha256'], 'release_id': release_id,
                'source_commit': release['source_commit'],
            }
            signature = base64.b64encode(main.demo_private_key(builder_id).sign(
                main.canonical_json(legacy).encode())).decode()
            db.execute('UPDATE attestations SET payload_json = ?, signature = ? WHERE id = ?',
                       (main.canonical_json(legacy), signature, row['id']))
        record = main.get_release_record(release_id)
        self.assertEqual(record['builders'][0]['attestation_schema'], 'quorum.attestation.legacy-v0')
        report = main.generate_audit_report(release_id)
        self.assertTrue(verify_passport(report)['valid'])

    def test_corrupted_legacy_attestation_still_fails_closed(self):
        verification = main.run_demo_verification('valid')
        release_id = verification['release_id']
        with main.connect() as db:
            row = db.execute('SELECT * FROM attestations WHERE release_id = ? LIMIT 1', (release_id,)).fetchone()
            payload = json.loads(row['payload_json'])
            payload.pop('schema_version')
            payload['artifact_sha256'] = '0' * 64
            db.execute('UPDATE attestations SET payload_json = ? WHERE id = ?',
                       (main.canonical_json(payload), row['id']))
        with self.assertRaises(main.HTTPException):
            main.get_release_record(release_id)


if __name__ == '__main__':
    unittest.main()
