import base64
import os
import tempfile
import unittest
import uuid
from pathlib import Path

os.environ["QUORUM_DB_PATH"] = str(Path(tempfile.gettempdir()) / "quorum-test.db")

from backend import living, main  # noqa: E402
from builder import agent  # noqa: E402
from scripts.verify_audit_report import verify_report  # noqa: E402


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

    def test_release_trust_summary_is_the_canonical_fail_closed_view(self):
        verification = main.run_demo_verification(
            "valid", threshold=2, reject_on_conflict=False
        )
        summary = main.ReleaseTrustSummaryResponse.model_validate(
            main.build_release_trust_summary(verification["release_id"])
        )
        self.assertEqual(summary.schema_version, "quorum.trust-summary.v1")
        self.assertEqual(summary.historical_status, "VERIFIED")
        self.assertEqual(summary.current_status, "VERIFIED")
        self.assertFalse(summary.installation_allowed)
        self.assertEqual(summary.overall_recommendation, "REVIEW_REQUIRED")
        self.assertEqual(summary.artifact_reproducibility.status, "VERIFIED")
        self.assertEqual(summary.living_verification.status, "VERIFIED")
        self.assertEqual(summary.blockchain.status, "NOT_ANCHORED")

    def test_builder_registry_never_infers_network_liveness_from_trust(self):
        main.run_demo_verification("valid", threshold=2, reject_on_conflict=False)
        builders = [main.BuilderRegistryResponse.model_validate(item) for item in main.list_builders()]
        self.assertTrue(builders)
        self.assertTrue(all(builder.liveness_status == "UNKNOWN" for builder in builders))
        self.assertTrue(all(builder.evidence_status == "ATTESTED" for builder in builders))
        self.assertTrue(all(builder.latest_signature_valid is True for builder in builders))
        self.assertTrue(all(not builder.independence_verified for builder in builders))

    def test_trust_summary_blocks_installation_when_incident_chain_is_tampered(self):
        verification = main.run_demo_verification(
            "valid", threshold=2, reject_on_conflict=False
        )
        living.record_incident(living.IncidentCreate(
            builder_id="northstar-ci",
            action="COMPROMISED",
            reason="Future-dated incident used to exercise chain integrity.",
            effective_from="2999-01-01T00:00:00+00:00",
        ))
        with main.connect() as db:
            db.execute(
                "UPDATE living_incidents SET reason = ? WHERE builder_id = ?",
                ("Tampered incident record", "northstar-ci"),
            )
        summary = main.build_release_trust_summary(verification["release_id"])
        self.assertEqual(summary["current_status"], "INTEGRITY_FAILURE")
        self.assertEqual(summary["living_verification"]["label"], "Incident chain invalid")
        self.assertFalse(summary["installation_allowed"])
        repaired = living.repair_incident_chain()
        self.assertTrue(repaired["repaired"])
        self.assertTrue(repaired["incident_chain"]["valid"])
        with main.connect() as db:
            repair_count = db.execute("SELECT COUNT(*) FROM living_chain_repairs").fetchone()[0]
        self.assertEqual(repair_count, 1)

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

    def test_real_builder_v2_attestation_reaches_verified_quorum(self):
        private_keys = [main.Ed25519PrivateKey.generate() for _ in range(2)]
        builder_ids = ("test-witness-one", "test-witness-two")
        for builder_id, private_key in zip(builder_ids, private_keys):
            main.register_builder(
                main.BuilderRegistrationRequest(
                    id=builder_id,
                    name=builder_id.replace("-", " ").title(),
                    operator=builder_id,
                    platform="isolated test workspace",
                    public_key=main.encode_public_key(private_key.public_key()),
                )
            )
            main.set_builder_trust(
                builder_id, trusted=True,
                expected_fingerprint=main.hashlib.sha256(main.base64.b64decode(
                    main.encode_public_key(private_key.public_key()))).hexdigest(),
                reason="Test fixture approval",
            )

        created = main.create_release(
            main.ReleaseCreate(
                repository_url="https://github.com/rakyll/hey",
                source_commit=main.DEMO_SOURCE_COMMIT,
                artifact_name="hey-linux-amd64",
                recipe_sha256=main.DEMO_RECIPE_SHA256,
                candidate_sha256=main.GOOD_ARTIFACT_SHA256,
                threshold=2,
                expected_builders=2,
            )
        )
        result = None
        for builder_id, private_key in zip(builder_ids, private_keys):
            unsigned = main.AttestationCreate(
                schema_version=main.REAL_ATTESTATION_SCHEMA,
                builder_id=builder_id,
                artifact_sha256=main.GOOD_ARTIFACT_SHA256,
                environment="isolated test workspace",
                built_at=main.utc_now(),
                signature="pending",
            )
            with main.connect() as db:
                release = db.execute(
                    "SELECT * FROM releases WHERE id = ?", (created["id"],)
                ).fetchone()
            signature = private_key.sign(
                main.canonical_json(main.attestation_payload(release, unsigned)).encode()
            )
            signed = unsigned.model_copy(
                update={"signature": base64.b64encode(signature).decode()}
            )
            result = main.submit_attestation(created["id"], signed)

        self.assertEqual(result["status"], "verified")
        self.assertEqual(
            {evidence["attestation_schema"] for evidence in result["builders"]},
            {main.REAL_ATTESTATION_SCHEMA},
        )

    def test_builder_identity_cannot_silently_replace_its_key(self):
        first_key = main.Ed25519PrivateKey.generate()
        second_key = main.Ed25519PrivateKey.generate()
        request = main.BuilderRegistrationRequest(
            id="stable-witness",
            name="Stable Witness",
            operator="Independent Operator",
            platform="test environment",
            public_key=main.encode_public_key(first_key.public_key()),
        )
        main.register_builder(request)
        with self.assertRaises(main.HTTPException) as error:
            main.register_builder(
                request.model_copy(
                    update={
                        "public_key": main.encode_public_key(second_key.public_key())
                    }
                )
            )
        self.assertEqual(error.exception.status_code, 409)

    def test_all_builder_configs_share_one_reproducible_recipe(self):
        root = Path(__file__).resolve().parents[1]
        configs = [
            agent.load_config(root / "configs" / "builders" / filename)
            for filename in (
                "local-builder.json",
                "github-actions.json",
                "gitlab-ci.json",
            )
        ]
        self.assertEqual(len({agent.recipe_sha256(config) for config in configs}), 1)
        payload = agent.signed_payload(
            configs[0], main.GOOD_ARTIFACT_SHA256, "test environment"
        )
        self.assertNotIn("release_id", payload)
        self.assertNotIn("built_at", payload)

    def test_real_package_recipe_catalog_is_pinned_and_distinct(self):
        root = Path(__file__).resolve().parents[1]
        identity = agent.load_config(root / "configs" / "builders" / "github-actions.json")
        configs = [
            agent.apply_recipe(identity, agent.load_recipe(path))
            for path in sorted((root / "configs" / "recipes").glob("*.json"))
        ]
        self.assertGreaterEqual(len(configs), 3)
        self.assertEqual(len({config["source"]["repository_url"] for config in configs}), len(configs))
        self.assertEqual(len({agent.recipe_sha256(config) for config in configs}), len(configs))
        for config in configs:
            self.assertEqual(len(config["source"]["commit"]), 40)
            self.assertIn("-trimpath", config["build"]["command"])

    def test_builder_can_sign_a_release_specific_challenge(self):
        config = agent.load_config(
            Path(__file__).resolve().parents[1] / "configs" / "builders" / "local-builder.json"
        )
        private_key = main.Ed25519PrivateKey.generate()
        main.register_builder(main.BuilderRegistrationRequest(
            id=config["builder"]["id"], name=config["builder"]["name"],
            operator=config["builder"]["operator"], platform="independent machine",
            public_key=main.encode_public_key(private_key.public_key())))
        main.set_builder_trust(
            config["builder"]["id"], trusted=True,
            expected_fingerprint=main.hashlib.sha256(main.base64.b64decode(
                main.encode_public_key(private_key.public_key()))).hexdigest(),
            reason="Test fixture approval",
        )
        created = main.create_release(main.ReleaseCreate(
            repository_url=config["source"]["repository_url"],
            source_commit=config["source"]["commit"],
            artifact_name=config["build"]["artifact_name"],
            recipe_sha256=agent.recipe_sha256(config),
            candidate_sha256=main.GOOD_ARTIFACT_SHA256))
        built_at = main.utc_now()
        payload = agent.signed_payload(config, main.GOOD_ARTIFACT_SHA256,
            "independent machine", release_id=created["id"], built_at=built_at)
        signature = base64.b64encode(private_key.sign(agent.canonical_json(payload).encode())).decode()
        result = main.submit_attestation(created["id"], main.AttestationCreate(
            schema_version="quorum.attestation.v1", builder_id=config["builder"]["id"],
            artifact_sha256=main.GOOD_ARTIFACT_SHA256, environment="independent machine",
            built_at=built_at, signature=signature))
        self.assertEqual(result["builders"][0]["signed_payload"]["release_id"], created["id"])

    def test_audit_report_verifies_offline(self):
        verification = main.run_demo_verification(
            "valid", threshold=2, reject_on_conflict=True
        )
        report = main.generate_audit_report(verification["release_id"])
        result = verify_report(report)
        self.assertTrue(result["valid"])
        self.assertTrue(result["checks"]["evidence_sha256"])
        self.assertTrue(result["checks"]["builder_signatures"])
        self.assertTrue(result["checks"]["audit_hash_chain"])
        self.assertTrue(result["checks"]["quorum_decision"])
        self.assertFalse(report["blockchain"]["anchored"])

    def test_offline_verifier_detects_report_tampering(self):
        verification = main.run_demo_verification(
            "valid", threshold=2, reject_on_conflict=True
        )
        report = main.generate_audit_report(verification["release_id"])
        report["evidence"]["builders"][0]["artifact_sha256"] = main.BAD_ARTIFACT_SHA256
        result = verify_report(report)
        self.assertFalse(result["valid"])
        self.assertFalse(result["checks"]["integrity"])


if __name__ == "__main__":
    unittest.main()

