import os
import tempfile
import unittest
import uuid
from pathlib import Path

os.environ["QUORUM_DB_PATH"] = str(Path(tempfile.gettempdir()) / "quorum-test.db")

from backend import main  # noqa: E402


class QuorumDecisionTests(unittest.TestCase):
    def setUp(self):
        main.DB_PATH = Path(tempfile.gettempdir()) / f"quorum-test-{uuid.uuid4()}.db"
        main.init_db()

    def tearDown(self):
        try:
            main.DB_PATH.unlink(missing_ok=True)
        except PermissionError:
            pass

    def run_scenario(self, scenario: str) -> dict:
        return main.demo_verify(main.DemoRequest(scenario=scenario))

    def test_valid_release_is_verified(self):
        result = self.run_scenario("valid")
        self.assertEqual(result["status"], "verified")
        self.assertTrue(all(result["rules"].values()))

    def test_tampered_release_is_rejected(self):
        result = self.run_scenario("tampered")
        self.assertEqual(result["status"], "rejected")
        self.assertFalse(result["rules"]["candidate"])

    def test_builder_conflict_is_surfaced(self):
        result = self.run_scenario("conflict")
        self.assertEqual(result["status"], "disagreement")
        self.assertFalse(result["rules"]["conflicts"])

    def test_audit_chain_links_every_event(self):
        result = self.run_scenario("valid")
        events = result["audit_events"]
        self.assertGreaterEqual(len(events), 5)
        self.assertEqual(events[0]["previous_hash"], "0" * 64)
        for previous, current in zip(events, events[1:]):
            self.assertEqual(current["previous_hash"], previous["event_hash"])

    def test_signed_evidence_is_exposed_for_independent_replay(self):
        result = self.run_scenario("valid")
        evidence = result["builders"][0]
        self.assertEqual(evidence["attestation_schema"], "quorum.attestation.v1")
        self.assertEqual(evidence["signed_payload"]["artifact_name"], "hey-linux-amd64")
        self.assertEqual(len(evidence["signing_key_fingerprint"]), 64)
        self.assertEqual(len(evidence["evidence_digest"]), 64)

    def test_tampering_with_a_signed_attestation_is_rejected(self):
        created = main.create_release(
            main.ReleaseCreate(
                repository_url="https://github.com/rakyll/hey",
                source_commit=main.DEMO_SOURCE_COMMIT,
                artifact_name="hey-linux-amd64",
                recipe_sha256=main.DEMO_RECIPE_SHA256,
                candidate_sha256=main.GOOD_ARTIFACT_SHA256,
            )
        )
        signed = main.sign_demo_attestation(
            created["id"],
            "northstar-ci",
            main.GOOD_ARTIFACT_SHA256,
            "GitHub Actions · Ubuntu 24.04",
        )
        tampered = signed.model_copy(update={"artifact_sha256": main.BAD_ARTIFACT_SHA256})
        with self.assertRaises(main.HTTPException) as error:
            main.submit_attestation(created["id"], tampered)
        self.assertEqual(error.exception.status_code, 400)

    def test_v1_contract_validates_demo_response(self):
        result = main.run_demo_verification(
            "valid", threshold=2, reject_on_conflict=False
        )
        contract = main.VerificationResponse.model_validate(result)
        self.assertEqual(contract.schema_version, "quorum.api.v1")
        self.assertEqual(contract.status, "verified")
        self.assertEqual(len(contract.builders), 3)

    def test_v1_stats_report_real_database_counts(self):
        main.run_demo_verification("valid", threshold=2, reject_on_conflict=False)
        stats = main.SystemStatsResponse.model_validate(main.get_system_stats())
        self.assertEqual(stats.releases_verified, 1)
        self.assertEqual(stats.active_builders, 3)

    def test_three_of_three_policy_rejects_a_conflicting_build(self):
        result = main.run_demo_verification(
            "conflict", threshold=3, reject_on_conflict=False
        )
        self.assertEqual(result["status"], "rejected")
        self.assertFalse(result["rules"]["matches"])

    def test_consumer_artifact_matching_consensus_is_accepted(self):
        verification = main.run_demo_verification(
            "valid", threshold=2, reject_on_conflict=False
        )
        result = main.verify_consumer_artifact(
            verification["release_id"],
            main.ConsumerArtifactRequest(
                artifact_name="downloaded-hey",
                artifact_sha256=verification["consensus_sha256"],
            ),
        )
        self.assertEqual(result["decision"], "accepted")
        self.assertTrue(result["hash_matches"])

    def test_consumer_artifact_mismatch_is_rejected_and_audited(self):
        verification = main.run_demo_verification(
            "valid", threshold=2, reject_on_conflict=False
        )
        result = main.verify_consumer_artifact(
            verification["release_id"],
            main.ConsumerArtifactRequest(
                artifact_name="tampered-hey",
                artifact_sha256=main.BAD_ARTIFACT_SHA256,
            ),
        )
        self.assertEqual(result["decision"], "rejected")
        self.assertFalse(result["hash_matches"])
        record = main.get_release_record(verification["release_id"])
        self.assertEqual(record["audit_events"][-1]["event_type"], "consumer.artifact.verified")


if __name__ == "__main__":
    unittest.main()

