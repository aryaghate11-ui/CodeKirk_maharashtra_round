import tempfile
import unittest
import uuid
from pathlib import Path

from backend import living, main


class LivingVerificationTests(unittest.TestCase):
    def setUp(self):
        main.DB_PATH = Path(tempfile.gettempdir()) / f"quorum-living-{uuid.uuid4()}.db"
        main.init_db()
        main.seed_demo_builders()

    def tearDown(self):
        try:
            main.DB_PATH.unlink(missing_ok=True)
        except PermissionError:
            pass

    def verified_three_of_three(self) -> dict:
        result = main.run_demo_verification("valid", threshold=3, reject_on_conflict=False)
        self.assertEqual(result["status"], "verified")
        return result

    def test_compromise_degrades_historical_quorum_without_deleting_evidence(self):
        release = self.verified_three_of_three()
        result = living.record_incident(living.IncidentCreate(
            builder_id="parallax-labs",
            action="COMPROMISED",
            reason="Signing key was stolen before this release was built.",
            effective_from="2000-01-01T00:00:00+00:00",
        ))
        assessment = living.get_assessment(release["release_id"])
        self.assertEqual(assessment["historical_status"], "verified")
        self.assertEqual(assessment["current_status"], "TRUST_DEGRADED")
        self.assertEqual(assessment["eligible_attestation_count"], 2)
        self.assertIn("parallax-labs", assessment["excluded_builders"])
        self.assertGreaterEqual(result["degraded_releases"], 1)

        with main.connect() as db:
            count = db.execute(
                "SELECT COUNT(*) FROM attestations WHERE release_id = ?", (release["release_id"],)
            ).fetchone()[0]
        self.assertEqual(count, 3)
        self.assertTrue(living.verify_incident_chain()["valid"])

    def test_reinstatement_restores_current_trust(self):
        release = self.verified_three_of_three()
        living.record_incident(living.IncidentCreate(
            builder_id="parallax-labs",
            action="COMPROMISED",
            reason="Key compromise under investigation.",
        ))
        living.record_incident(living.IncidentCreate(
            builder_id="parallax-labs",
            action="REINSTATED",
            reason="Independent review cleared the incident and rotated credentials.",
        ))
        assessment = living.get_assessment(release["release_id"])
        self.assertEqual(assessment["historical_status"], "verified")
        self.assertEqual(assessment["current_status"], "VERIFIED")
        self.assertEqual(assessment["eligible_attestation_count"], 3)

    def test_future_compromise_date_does_not_invalidate_older_attestation(self):
        release = self.verified_three_of_three()
        living.record_incident(living.IncidentCreate(
            builder_id="local-witness",
            action="COMPROMISED",
            reason="Compromise began after the historical release.",
            effective_from="2999-01-01T00:00:00+00:00",
        ))
        assessment = living.get_assessment(release["release_id"])
        self.assertEqual(assessment["current_status"], "VERIFIED")
        self.assertNotIn("local-witness", assessment["excluded_builders"])

    def test_actively_compromised_builder_cannot_submit_new_attestation(self):
        living.record_incident(living.IncidentCreate(
            builder_id="northstar-ci",
            action="COMPROMISED",
            reason="Private key disclosure confirmed.",
        ))
        created = main.create_release(main.ReleaseCreate(
            repository_url="https://github.com/rakyll/hey",
            source_commit=main.DEMO_SOURCE_COMMIT,
            artifact_name="blocked-builder-demo",
            recipe_sha256=main.DEMO_RECIPE_SHA256,
            candidate_sha256=main.GOOD_ARTIFACT_SHA256,
        ))
        signed = main.sign_demo_attestation(
            created["id"], "northstar-ci", main.GOOD_ARTIFACT_SHA256, "Compromised environment"
        )
        with self.assertRaises(main.HTTPException) as error:
            main.submit_attestation(created["id"], signed)
        self.assertEqual(error.exception.status_code, 403)
        self.assertIn("Living Verification", error.exception.detail)


if __name__ == "__main__":
    unittest.main()
