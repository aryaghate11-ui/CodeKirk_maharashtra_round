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

    def test_read_endpoints(self):
        self.run_scenario("valid")
        releases = main.list_releases()
        self.assertGreaterEqual(len(releases), 1)
        self.assertEqual(releases[0]["status"], "verified")

        builders = main.list_builders()
        self.assertEqual(len(builders), 3)
        self.assertTrue(all(b["trusted"] == 1 for b in builders))

        stats = main.system_stats()
        self.assertGreaterEqual(stats["releasesVerified"], 1)
        self.assertEqual(stats["activeBuilders"], 3)

        rel_id = releases[0]["release_id"]
        audit_events = main.release_audit_events(rel_id)
        self.assertGreaterEqual(len(audit_events), 5)


if __name__ == "__main__":
    unittest.main()

