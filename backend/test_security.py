import base64
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from backend import main
from backend.passport import sign_report, verify_passport
from backend.policy import QuorumPolicy, decide


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


if __name__ == '__main__':
    unittest.main()
