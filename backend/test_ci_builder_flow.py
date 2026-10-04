import base64
import tempfile
import unittest
import uuid
from pathlib import Path

from backend import living, main
from builder import agent


class IndependentCiBuilderFlowTests(unittest.TestCase):
    def setUp(self):
        main.DB_PATH = Path(tempfile.gettempdir()) / f"quorum-ci-flow-{uuid.uuid4()}.db"
        main.init_db()
        root = Path(__file__).resolve().parents[1]
        self.configs = [
            agent.load_config(root / "configs" / "builders" / name)
            for name in ("local-builder.json", "github-actions.json", "gitlab-ci.json")
        ]
        self.keys = {config["builder"]["id"]: main.Ed25519PrivateKey.generate() for config in self.configs}
        for config in self.configs:
            identity = config["builder"]
            key = self.keys[identity["id"]]
            public_key = main.encode_public_key(key.public_key())
            main.register_builder(main.BuilderRegistrationRequest(
                id=identity["id"],
                name=identity["name"],
                operator=identity["operator"],
                platform=identity["runtime"],
                public_key=public_key,
            ))
            main.set_builder_trust(
                identity["id"],
                trusted=True,
                expected_fingerprint=main.hashlib.sha256(main.base64.b64decode(public_key)).hexdigest(),
                reason="Test fingerprint approved",
            )

    def tearDown(self):
        main.DB_PATH.unlink(missing_ok=True)

    def create_release(self) -> str:
        config = self.configs[0]
        return main.create_release(main.ReleaseCreate(
            repository_url=config["source"]["repository_url"],
            source_commit=config["source"]["commit"],
            artifact_name=config["build"]["artifact_name"],
            recipe_sha256=agent.recipe_sha256(config),
            candidate_sha256=main.GOOD_ARTIFACT_SHA256,
            threshold=3,
            expected_builders=3,
            reject_on_conflict=True,
        ))["id"]

    def attestation(self, release_id: str, config: dict, artifact_hash: str, *, corrupt=False):
        builder_id = config["builder"]["id"]
        environment = config["builder"]["runtime"]
        built_at = main.utc_now()
        payload = agent.signed_payload(
            config, artifact_hash, environment, release_id=release_id, built_at=built_at
        )
        signature = self.keys[builder_id].sign(agent.canonical_json(payload).encode())
        if corrupt:
            signature = bytes(64)
        return main.AttestationCreate(
            schema_version=agent.CHALLENGE_ATTESTATION_SCHEMA,
            builder_id=builder_id,
            artifact_sha256=artifact_hash,
            environment=environment,
            built_at=built_at,
            signature=base64.b64encode(signature).decode(),
        )

    def test_three_matching_builder_signatures_reach_verified(self):
        release_id = self.create_release()
        result = None
        for config in self.configs:
            result = main.submit_attestation(
                release_id, self.attestation(release_id, config, main.GOOD_ARTIFACT_SHA256)
            )
        self.assertEqual(result["status"], "verified")
        self.assertEqual({builder["id"] for builder in result["builders"]}, set(main.RUNTIME_BUILDER_IDS))
        self.assertEqual({builder["operator"] for builder in result["builders"]}, {
            "Local Quorum Operator", "GitHub Actions", "GitLab CI"
        })
        self.assertTrue(main.verify_system_integrity(runtime_only=True)["valid"])

    def test_one_different_hash_is_a_real_disagreement(self):
        release_id = self.create_release()
        result = None
        for index, config in enumerate(self.configs):
            digest = main.BAD_ARTIFACT_SHA256 if index == 2 else main.GOOD_ARTIFACT_SHA256
            result = main.submit_attestation(release_id, self.attestation(release_id, config, digest))
        self.assertEqual(result["status"], "disagreement")
        self.assertFalse(result["rules"]["conflicts"])

    def test_invalid_signature_is_rejected(self):
        release_id = self.create_release()
        with self.assertRaises(main.HTTPException) as error:
            main.submit_attestation(
                release_id,
                self.attestation(release_id, self.configs[0], main.GOOD_ARTIFACT_SHA256, corrupt=True),
            )
        self.assertEqual(error.exception.status_code, 400)

    def test_compromise_degrades_three_of_three_release(self):
        release_id = self.create_release()
        for config in self.configs:
            main.submit_attestation(
                release_id, self.attestation(release_id, config, main.GOOD_ARTIFACT_SHA256)
            )
        result = living.record_incident(living.IncidentCreate(
            builder_id="gitlab-ci",
            action="COMPROMISED",
            reason="Test key compromise",
            effective_from="2000-01-01T00:00:00+00:00",
        ))
        assessment = living.get_assessment(release_id)
        self.assertEqual(assessment["current_status"], "TRUST_DEGRADED")
        self.assertIn("gitlab-ci", assessment["excluded_builders"])
        self.assertEqual(result["degraded_releases"], 1)

    def test_runtime_registry_exposes_only_deployable_identities(self):
        main.seed_demo_builders()
        builders = main.list_builders(runtime_only=True)
        self.assertEqual({builder["id"] for builder in builders}, set(main.RUNTIME_BUILDER_IDS))

    def test_builder_build_history_exposes_real_attested_output(self):
        release_id = self.create_release()
        main.submit_attestation(
            release_id,
            self.attestation(release_id, self.configs[0], main.GOOD_ARTIFACT_SHA256),
        )
        builds = main.list_builder_builds("local-builder")
        self.assertEqual(len(builds), 1)
        self.assertEqual(builds[0]["artifact_name"], "hey-linux-amd64")
        self.assertEqual(builds[0]["artifact_sha256"], main.GOOD_ARTIFACT_SHA256)
        self.assertTrue(builds[0]["signature_valid"])
        self.assertTrue(builds[0]["matches_candidate"])
        self.assertEqual(len(builds[0]["evidence_digest"]), 64)

    def test_all_profiles_accept_the_same_release_challenge(self):
        release_id = str(uuid.uuid4())
        root = Path(__file__).resolve().parents[1]
        build_target = agent.load_recipe(root / "configs" / "recipes" / "hey.json")
        challenge = {
            "schema_version": agent.CHALLENGE_SCHEMA,
            "release_id": release_id,
            "candidate_sha256": main.GOOD_ARTIFACT_SHA256,
            "recipe_sha256": agent.recipe_sha256(agent.apply_recipe(self.configs[0], build_target)),
            "build_target": build_target,
            "created_at": main.utc_now(),
        }
        bound = [agent.apply_challenge(config, challenge) for config in self.configs]
        self.assertEqual({agent.recipe_sha256(config) for config in bound}, {challenge["recipe_sha256"]})
        payloads = [
            agent.signed_payload(config, main.GOOD_ARTIFACT_SHA256, config["builder"]["runtime"],
                                 release_id=release_id, built_at=main.utc_now())
            for config in bound
        ]
        self.assertEqual({payload["release_id"] for payload in payloads}, {release_id})
        self.assertEqual({payload["source_commit"] for payload in payloads}, {main.DEMO_SOURCE_COMMIT})


if __name__ == "__main__":
    unittest.main()
