"""Unit tests for Source Sentinel (USP 1) diffing, rules, acquisition, and persistence."""
from __future__ import annotations

import unittest
from backend.sentinel import (
    FIXTURES_DATA,
    SECURITY_RULES,
    analyze_source_diff,
    compute_snapshot_hash,
    connect,
    execute_source_comparison,
    get_comparison,
    init_sentinel_db,
    list_comparisons,
    list_fixtures,
    update_review_status,
    validate_public_url,
    ReviewRequest,
)


class SourceSentinelTests(unittest.TestCase):
    def setUp(self):
        from backend.main import init_db
        init_db()

    def test_fixtures_listing(self):
        fixtures = list_fixtures()
        self.assertGreaterEqual(len(fixtures), 3)
        ids = [f["id"] for f in fixtures]
        self.assertIn("clean-refactor", ids)
        self.assertIn("suspicious-dependency", ids)
        self.assertIn("crypto-signature-bypass", ids)

    def test_snapshot_hash_is_deterministic(self):
        files_a = {"src/a.ts": "const x = 1;\n", "src/b.ts": "const y = 2;\n"}
        files_b = {"src/b.ts": "const y = 2;\n", "src/a.ts": "const x = 1;\n"}
        hash_a = compute_snapshot_hash(files_a)
        hash_b = compute_snapshot_hash(files_b)
        self.assertEqual(hash_a, hash_b)
        self.assertEqual(len(hash_a), 64)

        # Content change changes hash
        files_c = {"src/a.ts": "const x = 99;\n", "src/b.ts": "const y = 2;\n"}
        self.assertNotEqual(hash_a, compute_snapshot_hash(files_c))

    def test_clean_refactor_produces_info_risk(self):
        res = execute_source_comparison(mode="fixture", fixture_id="clean-refactor")
        self.assertTrue(res.is_fixture)
        self.assertEqual(res.risk_level, "INFO")
        self.assertEqual(len(res.findings), 0)
        self.assertGreater(res.summary.files_changed_count, 0)
        self.assertGreater(res.summary.additions_count, 0)

    def test_suspicious_dependency_and_workflow_detection(self):
        res = execute_source_comparison(mode="fixture", fixture_id="suspicious-dependency")
        self.assertIn(res.risk_level, ("HIGH", "CRITICAL"))
        categories = {f.category for f in res.findings}
        self.assertIn("DEPENDENCY_CHANGES", categories)
        self.assertIn("NETWORK_EXFILTRATION", categories)
        self.assertIn("BUILD_WORKFLOWS", categories)

        # Check line reference and file path
        dep_finding = next(f for f in res.findings if f.category == "DEPENDENCY_CHANGES")
        self.assertEqual(dep_finding.file_path, "package.json")
        self.assertIsNotNone(dep_finding.line_number)
        self.assertIn("postinstall", dep_finding.snippet)

    def test_crypto_signature_bypass_detection(self):
        res = execute_source_comparison(mode="fixture", fixture_id="crypto-signature-bypass")
        self.assertEqual(res.risk_level, "CRITICAL")
        categories = {f.category for f in res.findings}
        self.assertIn("CRYPTO_SIGNATURES", categories)
        self.assertIn("AUTH_PERMISSIONS", categories)

        crypto_finding = next(f for f in res.findings if f.category == "CRYPTO_SIGNATURES")
        self.assertEqual(crypto_finding.file_path, "backend/passport.py")
        self.assertEqual(crypto_finding.severity, "CRITICAL")
        self.assertIn("debug_allow_unverified", crypto_finding.snippet)

    def test_added_and_deleted_files_tracking(self):
        base = {"keep.txt": "hello\n", "remove.txt": "delete me\n"}
        target = {"keep.txt": "hello\n", "added.txt": "new file\n"}
        diff_files, findings, summary, risk = analyze_source_diff(base, target)
        self.assertEqual(summary.files_changed_count, 2)
        types = {d.change_type for d in diff_files}
        self.assertIn("DELETED", types)
        self.assertIn("ADDED", types)

    def test_ssrf_protection_blocks_internal_and_private_hosts(self):
        internal_urls = [
            "http://localhost:8000/repo",
            "https://127.0.0.1:8000/repo",
            "https://10.0.0.5/repo",
            "https://192.168.1.100/repo",
            "https://169.254.169.254/latest/meta-data",
            "ftp://github.com/owner/repo",
        ]
        for url in internal_urls:
            with self.assertRaises(ValueError):
                validate_public_url(url)

    def test_persistence_and_review_workflow(self):
        res = execute_source_comparison(mode="fixture", fixture_id="clean-refactor")
        comp_id = res.id

        # Verify listed in comparisons
        comparisons = list_comparisons(limit=10)
        matching = [c for c in comparisons if c["id"] == comp_id]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]["review_status"], "PENDING")

        # Verify retrieval
        loaded = get_comparison(comp_id)
        self.assertEqual(loaded.id, comp_id)
        self.assertEqual(loaded.base_snapshot_hash, res.base_snapshot_hash)

        # Update review status to APPROVED
        updated = update_review_status(
            comp_id,
            ReviewRequest(review_status="APPROVED", notes="Code refactor verified clean by security team."),
        )
        self.assertEqual(updated.review_status, "APPROVED")
        self.assertIn("security team", updated.reviewer_notes or "")
        self.assertIsNotNone(updated.reviewed_at)

        # Verify persisted in database
        with connect() as db:
            row = db.execute("SELECT review_status, reviewer_notes FROM source_comparisons WHERE id = ?", (comp_id,)).fetchone()
            self.assertEqual(row["review_status"], "APPROVED")
            self.assertEqual(row["reviewer_notes"], "Code refactor verified clean by security team.")

    def test_ipv4_mapped_ipv6_sentinel_ssrf_blocked(self):
        blocked_urls = [
            "http://[::ffff:127.0.0.1]/repo",
            "http://[::ffff:10.0.0.1]/repo",
            "http://[::ffff:169.254.169.254]/repo",
            "http://[::1]/repo",
        ]
        for url in blocked_urls:
            with self.assertRaises(ValueError):
                validate_public_url(url)

    def test_cross_repo_comparison_execution(self):
        from unittest.mock import patch
        def fake_fetch(repo_url, ref):
            if "repo1" in repo_url:
                return {
                    "index.html": "<!DOCTYPE html><html><body><h1>Lab 1</h1></body></html>\n",
                    "style.css": "body { color: blue; }\n"
                }
            else:
                return {
                    "index.html": "<!DOCTYPE html><html><body><h1>Lab 2</h1></body></html>\n",
                    "style.css": "body { color: blue; }\n",
                    "clinic.html": "<div>Clinic 2</div>\n"
                }

        with patch("backend.sentinel.fetch_github_commit_snapshot", side_effect=fake_fetch):
            res = execute_source_comparison(
                mode="cross-repo",
                base_repository_url="https://github.com/test-org/repo1",
                base_commit="main",
                target_repository_url="https://github.com/test-org/repo2",
                target_commit="main"
            )
            self.assertEqual(res.repository_url, "https://github.com/test-org/repo1 -> https://github.com/test-org/repo2")
            self.assertEqual(res.summary.files_changed_count, 2)  # index.html modified, clinic.html added
            self.assertEqual(res.risk_level, "INFO")
            types = {d.change_type for d in res.diff_files}
            self.assertIn("MODIFIED", types)
            self.assertIn("ADDED", types)


if __name__ == "__main__":
    unittest.main()
