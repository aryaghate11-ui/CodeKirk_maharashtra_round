"""Unit tests for Quorum Relay (USP 2): SSRF defenses, streaming artifact hashing, witness checks, and persistence."""
from __future__ import annotations

import io
import os
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend import main
from backend.relay import (
    BLOCKED_IP_NETWORKS,
    MAX_ARTIFACT_SIZE,
    ArtifactMonitorCreate,
    ArtifactMonitorUpdate,
    EstablishBaselineRequest,
    connect,
    download_and_hash_artifact,
    init_relay_db,
    perform_monitor_check,
    establish_monitor_baseline,
    get_monitor,
    get_monitor_baseline_history,
    validate_ip_address_not_blocked,
    validate_public_https_url,
    SSRFSafeHTTPSConnection,
)


class QuorumRelayTests(unittest.TestCase):
    def setUp(self):
        self.test_db_path = Path(tempfile.gettempdir()) / f"quorum-relay-test-{uuid.uuid4()}.db"
        main.DB_PATH = self.test_db_path
        main.init_db()

    def tearDown(self):
        try:
            self.test_db_path.unlink(missing_ok=True)
        except PermissionError:
            pass

    # -------------------------------------------------------------------------
    # 1. SSRF Validation Tests
    # -------------------------------------------------------------------------
    def test_ssrf_rejects_non_https(self):
        with self.assertRaises(ValueError) as ctx:
            validate_public_https_url("http://example.com/binary.tar.gz")
        self.assertIn("Only HTTPS", str(ctx.exception))

    def test_ssrf_rejects_localhost_and_internal_names(self):
        for bad_url in [
            "https://localhost/artifact",
            "https://127.0.0.1/artifact",
            "https://metadata.google.internal/computeMetadata/v1/",
        ]:
            with self.assertRaises(ValueError) as ctx:
                validate_public_https_url(bad_url)
            self.assertIn("SSRF Protection", str(ctx.exception))

    @patch("socket.getaddrinfo")
    def test_ssrf_rejects_private_ips(self, mock_addrinfo):
        private_ips = [
            "10.0.0.5",
            "172.16.5.1",
            "192.168.1.100",
            "169.254.169.254",
            "127.0.0.2",
            "::1",
            "fc00::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "::ffff:169.254.169.254",
            "::ffff:192.168.1.1",
            "::",
            "fe80::1",
        ]
        for ip in private_ips:
            mock_addrinfo.return_value = [(2, 1, 6, "", (ip, 443))]
            with self.assertRaises(ValueError) as ctx:
                validate_public_https_url(f"https://some-host.com/pkg-{ip}.zip")
            self.assertIn("SSRF Protection", str(ctx.exception))

    def test_validator_rejects_prohibited_ipv4_mapped_addresses(self):
        prohibited_mapped = [
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "::ffff:169.254.169.254",
            "::ffff:192.168.1.1",
            "::ffff:7f00:1",
            "::ffff:0.0.0.0",
        ]
        for ip in prohibited_mapped:
            with self.assertRaises(ValueError) as ctx:
                validate_ip_address_not_blocked(ip)
            self.assertIn("SSRF Protection", str(ctx.exception))

    def test_validator_rejects_ipv6_special_use_addresses(self):
        special_ipv6 = [
            "::",                   # Unspecified
            "::1",                  # Loopback
            "fe80::1",              # Link-local
            "fc00::1",              # Unique-local ULA
            "fd12:3456:789a::1",    # Unique-local ULA
            "ff02::1",              # Multicast
            "2001:db8::1",          # Documentation
        ]
        for ip in special_ipv6:
            with self.assertRaises(ValueError) as ctx:
                validate_ip_address_not_blocked(ip)
            self.assertIn("SSRF Protection", str(ctx.exception))

    def test_validator_allows_legitimate_public_ips(self):
        allowed_ips = [
            "::ffff:8.8.8.8",            # IPv4-mapped public IPv4
            "::ffff:1.1.1.1",            # IPv4-mapped public IPv4
            "93.184.216.34",             # Ordinary public IPv4
            "140.82.121.3",              # Ordinary public IPv4
            "2606:4700:4700::1111",      # Ordinary public IPv6
            "2001:4860:4860::8888",      # Ordinary public IPv6
        ]
        for ip in allowed_ips:
            try:
                validate_ip_address_not_blocked(ip)
            except ValueError as e:
                self.fail(f"validate_ip_address_not_blocked incorrectly blocked public IP {ip}: {e}")

    def test_validator_rejects_malformed_and_unsupported_ips(self):
        malformed = [
            "999.999.999.999",
            "not-an-ip",
            "::ffff:999.1.1.1",
            "127.0.0.1.1",
        ]
        for bad_ip in malformed:
            with self.assertRaises(ValueError) as ctx:
                validate_ip_address_not_blocked(bad_ip)
            self.assertIn("Invalid IP address format", str(ctx.exception))

    @patch("socket.getaddrinfo")
    def test_ssrf_allows_public_ip(self, mock_addrinfo):
        mock_addrinfo.return_value = [(2, 1, 6, "", ("93.184.216.34", 443))]
        validated = validate_public_https_url("https://example.com/release-1.0.0.tar.gz")
        self.assertEqual(validated, "https://example.com/release-1.0.0.tar.gz")

    def test_ssrf_rejects_embedded_credentials(self):
        credential_urls = [
            "https://user:password@example.com/artifact.tar.gz",
            "https://user@example.com/artifact.tar.gz",
            "https://:password@example.com/artifact.tar.gz",
            "https://admin:secret123@pkg.org/bin",
        ]
        for url in credential_urls:
            with self.assertRaises(ValueError) as ctx:
                validate_public_https_url(url)
            self.assertIn("embedded credentials", str(ctx.exception))

    def test_dns_rebinding_blocked_at_connection_time(self):
        """Simulates DNS rebinding where socket connects to a prohibited peer IP."""
        conn = SSRFSafeHTTPSConnection("rebind-target.com", 443)
        mock_sock = MagicMock()
        # Socket was connected to loopback IP (e.g. via DNS rebinding)
        mock_sock.getpeername.return_value = ("127.0.0.1", 443)

        with patch("http.client.HTTPConnection.connect", autospec=True) as mock_connect:
            conn.sock = mock_sock
            with self.assertRaises(ValueError) as ctx:
                conn.connect()
            self.assertIn("SSRF Protection", str(ctx.exception))
            self.assertIn("127.0.0.1", str(ctx.exception))
            # Socket was closed immediately to fail closed
            self.assertTrue(mock_sock.close.called)

    def test_connection_time_rejects_ipv4_mapped_and_ipv6_special(self):
        """Tests that SSRFSafeHTTPSConnection rejects IPv4-mapped and special-use peer IPs."""
        prohibited_peers = [
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "::ffff:169.254.169.254",
            "::ffff:192.168.1.1",
            "::",
            "fe80::1",
            "fc00::1",
        ]
        for peer_ip in prohibited_peers:
            conn = SSRFSafeHTTPSConnection("target.com", 443)
            mock_sock = MagicMock()
            mock_sock.getpeername.return_value = (peer_ip, 443)

            with patch("http.client.HTTPConnection.connect", autospec=True):
                conn.sock = mock_sock
                with self.assertRaises(ValueError) as ctx:
                    conn.connect()
                self.assertIn("SSRF Protection", str(ctx.exception))
                self.assertTrue(mock_sock.close.called)

    @patch("urllib.request.build_opener")
    @patch("backend.relay.validate_public_https_url")
    def test_redirect_to_prohibited_destination_is_rejected(self, mock_validate, mock_build_opener):
        """Tests that a 302 redirect to an internal IP or localhost fails closed."""
        mock_resp = MagicMock()
        mock_resp.status = 302
        mock_resp.headers = {"Location": "https://127.0.0.1/sensitive/data"}
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.__exit__.return_value = None

        mock_opener = MagicMock()
        mock_opener.open.return_value = mock_resp
        mock_build_opener.return_value = mock_opener

        # The first hop is valid, but the second hop (redirect destination) raises SSRF error
        mock_validate.side_effect = [
            "https://public.cdn.org/installer.pkg",
            ValueError("SSRF Protection: Host '127.0.0.1' resolves to blocked private/internal IP 127.0.0.1.")
        ]

        with self.assertRaises(ValueError) as ctx:
            download_and_hash_artifact("https://public.cdn.org/installer.pkg")
        self.assertIn("SSRF Protection", str(ctx.exception))

    # -------------------------------------------------------------------------
    # 2. Artifact Streaming & Hashing Tests
    # -------------------------------------------------------------------------
    @patch("urllib.request.build_opener")
    @patch("backend.relay.validate_public_https_url")
    def test_download_and_hash_valid_artifact(self, mock_validate, mock_build_opener):
        test_bytes = b"Hello, Quorum Relay independent witness verification bytes!"
        import hashlib
        expected_hash = hashlib.sha256(test_bytes).hexdigest()

        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.headers = {"Content-Length": str(len(test_bytes))}
        # read chunks
        mock_resp.read.side_effect = [test_bytes, b""]
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.__exit__.return_value = None

        mock_opener = MagicMock()
        mock_opener.open.return_value = mock_resp
        mock_build_opener.return_value = mock_opener

        computed_hash, bytes_read, status = download_and_hash_artifact("https://cdn.example.org/app.zip")
        self.assertEqual(computed_hash, expected_hash)
        self.assertEqual(bytes_read, len(test_bytes))
        self.assertEqual(status, 200)

    @patch("urllib.request.build_opener")
    @patch("backend.relay.validate_public_https_url")
    def test_download_exceeds_content_length_limit(self, mock_validate, mock_build_opener):
        oversized = MAX_ARTIFACT_SIZE + 1024
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.headers = {"Content-Length": str(oversized)}
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.__exit__.return_value = None

        mock_opener = MagicMock()
        mock_opener.open.return_value = mock_resp
        mock_build_opener.return_value = mock_opener

        with self.assertRaises(ValueError) as ctx:
            download_and_hash_artifact("https://cdn.example.org/huge.iso")
        self.assertIn("exceeds maximum limit", str(ctx.exception))

    # -------------------------------------------------------------------------
    # 3. Monitor Execution & Result Detection (MATCH, MISMATCH, ERROR)
    # -------------------------------------------------------------------------
    @patch("backend.relay.download_and_hash_artifact")
    def test_perform_monitor_check_match(self, mock_download):
        real_hash = "73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f"
        mock_download.return_value = (real_hash, 1024, 200)

        # Insert a monitor into the database
        with connect() as db:
            db.execute(
                """
                INSERT INTO artifact_monitors (id, name, artifact_url, expected_sha256, provenance, created_at)
                VALUES ('m-test-1', 'Test Monitor', 'https://example.org/release.tar.gz', ?, 'MANUAL_UNVERIFIED', '2026-10-04T00:00:00Z')
                """,
                (real_hash,),
            )

        check_res = perform_monitor_check("m-test-1")
        self.assertEqual(check_res.result, "MATCH")
        self.assertEqual(check_res.expected_sha256, real_hash)
        self.assertEqual(check_res.observed_sha256, real_hash)
        self.assertEqual(check_res.http_status, 200)

        # Verify monitor record was updated
        with connect() as db:
            row = db.execute("SELECT * FROM artifact_monitors WHERE id = 'm-test-1'").fetchone()
            self.assertEqual(row["last_result"], "MATCH")
            self.assertEqual(row["last_observed_sha256"], real_hash)

    @patch("backend.relay.download_and_hash_artifact")
    def test_perform_monitor_check_mismatch(self, mock_download):
        expected_hash = "73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f"
        tampered_hash = "badd09f10e8f9315c7c9e649a535311185f922c154a2ca58048c2ba5d42277c2"
        mock_download.return_value = (tampered_hash, 2048, 200)

        with connect() as db:
            db.execute(
                """
                INSERT INTO artifact_monitors (id, name, artifact_url, expected_sha256, provenance, created_at)
                VALUES ('m-test-2', 'Tampered Monitor', 'https://example.org/tampered.tar.gz', ?, 'MANUAL_UNVERIFIED', '2026-10-04T00:00:00Z')
                """,
                (expected_hash,),
            )

        check_res = perform_monitor_check("m-test-2")
        self.assertEqual(check_res.result, "MISMATCH")
        self.assertEqual(check_res.expected_sha256, expected_hash)
        self.assertEqual(check_res.observed_sha256, tampered_hash)

        with connect() as db:
            row = db.execute("SELECT * FROM artifact_monitors WHERE id = 'm-test-2'").fetchone()
            self.assertEqual(row["last_result"], "MISMATCH")
            self.assertEqual(row["last_observed_sha256"], tampered_hash)

    @patch("backend.relay.download_and_hash_artifact")
    def test_perform_monitor_check_error(self, mock_download):
        expected_hash = "73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f"
        mock_download.side_effect = ConnectionResetError("Connection reset by peer")

        with connect() as db:
            db.execute(
                """
                INSERT INTO artifact_monitors (id, name, artifact_url, expected_sha256, provenance, created_at)
                VALUES ('m-test-3', 'Failing Monitor', 'https://example.org/down.tar.gz', ?, 'MANUAL_UNVERIFIED', '2026-10-04T00:00:00Z')
                """,
                (expected_hash,),
            )

        check_res = perform_monitor_check("m-test-3")
        self.assertEqual(check_res.result, "ERROR")
        self.assertIn("Connection reset by peer", check_res.error_summary)

        with connect() as db:
            row = db.execute("SELECT * FROM artifact_monitors WHERE id = 'm-test-3'").fetchone()
            self.assertEqual(row["last_result"], "ERROR")
            self.assertIn("Connection reset", row["last_error_summary"])

    # -------------------------------------------------------------------------
    # 4. Verified Release Provenance vs Manual Unverified
    # -------------------------------------------------------------------------
    def test_monitor_provenance_detection(self):
        from backend.relay import create_monitor

        # 1. Create a verified release in main
        with connect() as db:
            db.execute(
                """
                INSERT INTO releases (id, repository_url, source_commit, artifact_name, recipe_sha256,
                                     candidate_sha256, status, consensus_sha256, created_at)
                VALUES ('rel-100', 'https://github.com/example/repo', 'e64ec7a3ad1ef8bc828fe61e1fb324cc2e74c604',
                        'sample-artifact', '6cb431a152226cff3072c02dd2f6f6b187751d15452265b1b9e4cc2b3014ad10',
                        '73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f',
                        'verified', '73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f',
                        '2026-10-04T00:00:00Z')
                """
            )

        with patch("backend.relay.validate_public_https_url", return_value="https://cdn.example.org/rel-100.tar.gz"):
            # Case A: linked to verified release
            mon_a = create_monitor(
                ArtifactMonitorCreate(
                    name="Mon A",
                    artifact_url="https://cdn.example.org/rel-100.tar.gz",
                    release_id="rel-100",
                )
            )
            self.assertEqual(mon_a["provenance"], "VERIFIED_RELEASE_CONSENSUS")
            self.assertEqual(mon_a["expected_sha256"], "73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f")

            # Case B: manual unverified (no release_id)
            mon_b = create_monitor(
                ArtifactMonitorCreate(
                    name="Mon B",
                    artifact_url="https://cdn.example.org/rel-100.tar.gz",
                    expected_sha256="73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f",
                )
            )
            self.assertEqual(mon_b["provenance"], "MANUAL_UNVERIFIED")

    # -------------------------------------------------------------------------
    # 5. Manifest Parsing, GitHub Release Fetching, and Guided UX Tests
    # -------------------------------------------------------------------------
    def test_parse_checksum_manifest_formats(self):
        from backend.relay import parse_checksum_manifest

        # Standard GNU sha256sum
        gnu_text = """
        # Comment line
        05e6813a337cc722c3ed07e54a764b75cc5d671e2e60459db0ba696ee5fa7504  fzf-linux_amd64.tar.gz
        2d392b50be66e2ab104ccd52a6072df692b1f9b9c5b449a9c098de885f32c4c5 *fzf-darwin_amd64.tar.gz
        """
        gnu_map = parse_checksum_manifest(gnu_text)
        self.assertEqual(
            gnu_map.get("fzf-linux_amd64.tar.gz"),
            "05e6813a337cc722c3ed07e54a764b75cc5d671e2e60459db0ba696ee5fa7504",
        )
        self.assertEqual(
            gnu_map.get("fzf-darwin_amd64.tar.gz"),
            "2d392b50be66e2ab104ccd52a6072df692b1f9b9c5b449a9c098de885f32c4c5",
        )

        # BSD style
        bsd_text = "SHA256 (app-v1.0.tar.gz) = 73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f"
        bsd_map = parse_checksum_manifest(bsd_text)
        self.assertEqual(
            bsd_map.get("app-v1.0.tar.gz"),
            "73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f",
        )

        # Single hash format
        single_text = "05e6813a337cc722c3ed07e54a764b75cc5d671e2e60459db0ba696ee5fa7504\n"
        single_map = parse_checksum_manifest(single_text)
        self.assertEqual(single_map.get("*"), "05e6813a337cc722c3ed07e54a764b75cc5d671e2e60459db0ba696ee5fa7504")

    def test_parse_checksum_manifest_invalid_content(self):
        from backend.relay import parse_checksum_manifest

        # Empty or garbage content returns empty dict without throwing
        self.assertEqual(parse_checksum_manifest(""), {})
        self.assertEqual(parse_checksum_manifest("Random text\nNot a hash\nError 404"), {})

    def test_normalize_github_repo(self):
        from backend.relay import normalize_github_repo

        self.assertEqual(normalize_github_repo("junegunn/fzf"), ("junegunn", "fzf"))
        self.assertEqual(normalize_github_repo("https://github.com/junegunn/fzf"), ("junegunn", "fzf"))
        self.assertEqual(normalize_github_repo("https://github.com/junegunn/fzf.git"), ("junegunn", "fzf"))

        with self.assertRaises(ValueError):
            normalize_github_repo("invalid_format_without_slash")
        with self.assertRaises(ValueError):
            normalize_github_repo("http://127.0.0.1/malicious")

    def test_github_release_trusted_hash_retrieval(self):
        from backend.relay import fetch_github_release_info
        import json

        fake_release = {
            "tag_name": "v1.0.0",
            "name": "Release 1.0.0",
            "published_at": "2026-10-04T00:00:00Z",
            "html_url": "https://github.com/test-org/test-tool/releases/v1.0.0",
            "assets": [
                {
                    "name": "tool-linux-amd64.tar.gz",
                    "browser_download_url": "https://github.com/test-org/test-tool/releases/download/v1.0.0/tool-linux-amd64.tar.gz",
                    "size": 1048576,
                    "content_type": "application/gzip",
                },
                {
                    "name": "checksums.txt",
                    "browser_download_url": "https://github.com/test-org/test-tool/releases/download/v1.0.0/checksums.txt",
                    "size": 256,
                    "content_type": "text/plain",
                },
            ],
        }

        fake_manifest = "73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f  tool-linux-amd64.tar.gz\n"

        def fake_fetch(url, max_bytes=1024*1024, extra_headers=None):
            if "api.github.com" in url:
                return json.dumps(fake_release), 200
            elif "checksums.txt" in url:
                return fake_manifest, 200
            return "", 404

        with patch("backend.relay.safe_fetch_text", side_effect=fake_fetch):
            info = fetch_github_release_info("test-org/test-tool")
            self.assertEqual(info.tag_name, "v1.0.0")
            self.assertTrue(info.manifest_found)
            self.assertEqual(info.manifest_name, "checksums.txt")
            self.assertIn("MANUAL_UNVERIFIED", info.provenance_note)
            self.assertIn("Not an attested multi-builder Quorum consensus", info.provenance_note)

            target_asset = next(a for a in info.assets if a.name == "tool-linux-amd64.tar.gz")
            self.assertEqual(
                target_asset.expected_sha256,
                "73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f",
            )
            self.assertEqual(target_asset.hash_source, "Manifest: checksums.txt")

    def test_github_release_unavailable_checksums(self):
        from backend.relay import fetch_github_release_info
        import json

        fake_release = {
            "tag_name": "v2.0.0",
            "name": "Release 2.0.0",
            "published_at": "2026-10-04T00:00:00Z",
            "html_url": "https://github.com/test-org/no-sums/releases/v2.0.0",
            "assets": [
                {
                    "name": "tool-binary.tar.gz",
                    "browser_download_url": "https://github.com/test-org/no-sums/releases/download/v2.0.0/tool-binary.tar.gz",
                    "size": 500000,
                    "content_type": "application/gzip",
                }
            ],
        }

        with patch("backend.relay.safe_fetch_text", return_value=(json.dumps(fake_release), 200)):
            info = fetch_github_release_info("test-org/no-sums")
            self.assertFalse(info.manifest_found)
            self.assertIn("No author SHA-256 checksum manifest was detected", info.provenance_note)
            target_asset = info.assets[0]
            self.assertIsNone(target_asset.expected_sha256)

    def test_manual_hash_entry_validation(self):
        # Valid 64-hex hash passes
        with patch("backend.relay.validate_public_https_url", return_value="https://cdn.example.org/test.bin"):
            valid = ArtifactMonitorCreate(
                name="Valid Hash Monitor",
                artifact_url="https://cdn.example.org/test.bin",
                expected_sha256="05e6813a337cc722c3ed07e54a764b75cc5d671e2e60459db0ba696ee5fa7504",
            )
            self.assertEqual(valid.expected_sha256, "05e6813a337cc722c3ed07e54a764b75cc5d671e2e60459db0ba696ee5fa7504")

            # Non-hex or invalid length fails
            for bad_hash in ["not-a-hash", "05e681", "z" * 64, ""]:
                with self.assertRaises(Exception):
                    ArtifactMonitorCreate(
                        name="Bad Hash Monitor",
                        artifact_url="https://cdn.example.org/test.bin",
                        expected_sha256=bad_hash,
                    )

    def test_verified_releases_query_includes_attestation_count(self):
        from backend.relay import list_eligible_verified_releases

        with connect() as db:
            db.execute(
                """
                INSERT INTO releases (id, repository_url, source_commit, artifact_name, recipe_sha256,
                                     candidate_sha256, status, consensus_sha256, threshold, expected_builders, created_at)
                VALUES ('rel-query-test', 'https://github.com/example/repo', 'e64ec7a3ad1ef8bc828fe61e1fb324cc2e74c604',
                        'sample-binary', '6cb431a152226cff3072c02dd2f6f6b187751d15452265b1b9e4cc2b3014ad10',
                        '73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f',
                        'verified', '73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f',
                        2, 3, '2026-10-04T00:00:00Z')
                """
            )

        releases = list_eligible_verified_releases()
        target = next(r for r in releases if r["release_id"] == "rel-query-test")
        self.assertEqual(target["artifact_name"], "sample-binary")
        self.assertEqual(target["threshold"], 2)
        self.assertEqual(target["expected_builders"], 3)
        self.assertIn("attestation_count", target)

    # -------------------------------------------------------------------------
    # 6. Trusted Baseline Hash Tracking & Baseline Change Detection Tests
    # -------------------------------------------------------------------------
    def test_baseline_not_established_by_default(self):
        """Monitors start with no baseline established; check reports NOT_ESTABLISHED."""
        real_hash = "73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f"
        with connect() as db:
            db.execute(
                """
                INSERT INTO artifact_monitors (id, name, artifact_url, expected_sha256, provenance, created_at)
                VALUES ('m-base-default', 'Baseline Default Monitor', 'https://example.org/default.tar.gz', ?, 'MANUAL_UNVERIFIED', '2026-10-04T00:00:00Z')
                """,
                (real_hash,),
            )

        mon = get_monitor("m-base-default")
        self.assertIsNone(mon.get("trusted_baseline_sha256"))
        self.assertEqual(mon.get("last_baseline_result"), "NOT_ESTABLISHED")
        self.assertIsNone(mon.get("baseline_established_at"))
        self.assertIsNone(mon.get("baseline_approved_by"))

        with patch("backend.relay.download_and_hash_artifact", return_value=(real_hash, 1024, 200)):
            check_res = perform_monitor_check("m-base-default")
            self.assertEqual(check_res.result, "MATCH")
            self.assertEqual(check_res.baseline_result, "NOT_ESTABLISHED")
            self.assertFalse(check_res.baseline_change_detected)
            self.assertIsNone(check_res.trusted_baseline_sha256)

        updated_mon = get_monitor("m-base-default")
        self.assertEqual(updated_mon["last_result"], "MATCH")
        self.assertEqual(updated_mon["last_baseline_result"], "NOT_ESTABLISHED")

    def test_establish_trusted_baseline_success(self):
        """Operator establishes baseline; verifies schema validation, operator logging, and audit trail."""
        valid_hash = "73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f"
        with connect() as db:
            db.execute(
                """
                INSERT INTO artifact_monitors (id, name, artifact_url, expected_sha256, provenance, created_at)
                VALUES ('m-base-est', 'Baseline Establish Monitor', 'https://example.org/app.tar.gz', ?, 'MANUAL_UNVERIFIED', '2026-10-04T00:00:00Z')
                """,
                (valid_hash,),
            )

        # Invalid hex validation
        for bad in ["not-a-hash", "xyz" * 21, "a" * 63, "a" * 65]:
            with self.assertRaises(Exception):
                EstablishBaselineRequest(baseline_sha256=bad)

        # Establish baseline with uppercase hex to test normalization
        req = EstablishBaselineRequest(
            baseline_sha256=valid_hash.upper(),
            approved_by="SecOps Lead",
            notes="Initial verified artifact baseline for v1.0.",
        )
        mon = establish_monitor_baseline("m-base-est", req)
        self.assertEqual(mon["trusted_baseline_sha256"], valid_hash.lower())
        self.assertEqual(mon["baseline_approved_by"], "SecOps Lead")
        self.assertEqual(mon["baseline_approval_notes"], "Initial verified artifact baseline for v1.0.")
        self.assertIsNotNone(mon["baseline_established_at"])
        self.assertIsNone(mon["previous_baseline_sha256"])

        # Check baseline event history
        history = get_monitor_baseline_history("m-base-est")
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["event_type"], "BASELINE_ESTABLISHED")
        self.assertEqual(history[0]["trusted_baseline_sha256"], valid_hash.lower())
        self.assertEqual(history[0]["approved_by"], "SecOps Lead")

    def test_baseline_match_when_observed_equals_baseline(self):
        """When downloaded artifact matches established baseline, check reports MATCH and change_detected=False."""
        baseline_hash = "73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f"
        with connect() as db:
            db.execute(
                """
                INSERT INTO artifact_monitors (id, name, artifact_url, expected_sha256, provenance, created_at)
                VALUES ('m-base-match', 'Baseline Match Monitor', 'https://example.org/match.tar.gz', ?, 'MANUAL_UNVERIFIED', '2026-10-04T00:00:00Z')
                """,
                (baseline_hash,),
            )

        establish_monitor_baseline(
            "m-base-match",
            EstablishBaselineRequest(baseline_sha256=baseline_hash, approved_by="Alice"),
        )

        with patch("backend.relay.download_and_hash_artifact", return_value=(baseline_hash, 2048, 200)):
            check_res = perform_monitor_check("m-base-match")
            self.assertEqual(check_res.baseline_result, "MATCH")
            self.assertFalse(check_res.baseline_change_detected)
            self.assertEqual(check_res.trusted_baseline_sha256, baseline_hash)

        mon = get_monitor("m-base-match")
        self.assertEqual(mon["last_baseline_result"], "MATCH")

    def test_baseline_divergence_when_observed_differs(self):
        """When downloaded artifact differs from baseline, check flags CHANGED and records divergence event."""
        baseline_hash = "73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f"
        diverged_hash = "badd09f10e8f9315c7c9e649a535311185f922c154a2ca58048c2ba5d42277c2"
        with connect() as db:
            db.execute(
                """
                INSERT INTO artifact_monitors (id, name, artifact_url, expected_sha256, provenance, created_at)
                VALUES ('m-base-div', 'Baseline Diverge Monitor', 'https://example.org/div.tar.gz', ?, 'MANUAL_UNVERIFIED', '2026-10-04T00:00:00Z')
                """,
                (baseline_hash,),
            )

        establish_monitor_baseline(
            "m-base-div",
            EstablishBaselineRequest(baseline_sha256=baseline_hash, approved_by="Alice"),
        )

        with patch("backend.relay.download_and_hash_artifact", return_value=(diverged_hash, 4096, 200)):
            check_res = perform_monitor_check("m-base-div")
            self.assertEqual(check_res.baseline_result, "CHANGED")
            self.assertTrue(check_res.baseline_change_detected)
            self.assertEqual(check_res.trusted_baseline_sha256, baseline_hash)
            self.assertEqual(check_res.observed_sha256, diverged_hash)

        mon = get_monitor("m-base-div")
        self.assertEqual(mon["last_baseline_result"], "CHANGED")

        # Verify BASELINE_DIVERGENCE event was appended to history
        history = get_monitor_baseline_history("m-base-div")
        div_events = [e for e in history if e["event_type"] == "BASELINE_DIVERGENCE"]
        self.assertEqual(len(div_events), 1)
        self.assertEqual(div_events[0]["trusted_baseline_sha256"], baseline_hash)
        self.assertEqual(div_events[0]["observed_sha256"], diverged_hash)
        # Verify message does not make unverified claims of malicious tampering
        self.assertIn("diverged from established trusted baseline", div_events[0]["notes"].lower())
        self.assertNotIn("tampering detected", div_events[0]["notes"].lower())

    def test_update_baseline_preserves_previous_baseline(self):
        """Updating a baseline retains previous_baseline_sha256 and records BASELINE_UPDATED audit event."""
        h1 = "1111111111111111111111111111111111111111111111111111111111111111"
        h2 = "2222222222222222222222222222222222222222222222222222222222222222"
        with connect() as db:
            db.execute(
                """
                INSERT INTO artifact_monitors (id, name, artifact_url, expected_sha256, provenance, created_at)
                VALUES ('m-base-upd', 'Baseline Update Monitor', 'https://example.org/upd.tar.gz', ?, 'MANUAL_UNVERIFIED', '2026-10-04T00:00:00Z')
                """,
                (h1,),
            )

        # 1. Establish v1
        establish_monitor_baseline("m-base-upd", EstablishBaselineRequest(baseline_sha256=h1, approved_by="Bob"))

        # 2. Update to v2
        mon_v2 = establish_monitor_baseline(
            "m-base-upd",
            EstablishBaselineRequest(baseline_sha256=h2, approved_by="Charlie", notes="Promoting v2 after QA"),
        )
        self.assertEqual(mon_v2["trusted_baseline_sha256"], h2)
        self.assertEqual(mon_v2["previous_baseline_sha256"], h1)
        self.assertEqual(mon_v2["baseline_approved_by"], "Charlie")

        # History has newest first
        history = get_monitor_baseline_history("m-base-upd")
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]["event_type"], "BASELINE_UPDATED")
        self.assertEqual(history[0]["previous_baseline_sha256"], h1)
        self.assertEqual(history[0]["trusted_baseline_sha256"], h2)
        self.assertEqual(history[1]["event_type"], "BASELINE_ESTABLISHED")

    def test_release_reference_and_baseline_are_independent(self):
        """Manifest/release reference comparison and baseline comparison operate independently."""
        manifest_hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        baseline_hash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        with connect() as db:
            db.execute(
                """
                INSERT INTO artifact_monitors (id, name, artifact_url, expected_sha256, provenance, created_at)
                VALUES ('m-independent', 'Independent Check Monitor', 'https://example.org/indep.tar.gz', ?, 'MANUAL_UNVERIFIED', '2026-10-04T00:00:00Z')
                """,
                (manifest_hash,),
            )

        establish_monitor_baseline("m-independent", EstablishBaselineRequest(baseline_sha256=baseline_hash, approved_by="Lead"))

        # Case A: Download matches manifest hash, but differs from baseline
        with patch("backend.relay.download_and_hash_artifact", return_value=(manifest_hash, 1024, 200)):
            res_a = perform_monitor_check("m-independent")
            self.assertEqual(res_a.result, "MATCH", "Manifest check should be MATCH")
            self.assertEqual(res_a.baseline_result, "CHANGED", "Baseline check should be CHANGED")
            self.assertTrue(res_a.baseline_change_detected)

        # Case B: Download matches baseline hash, but differs from manifest hash
        with patch("backend.relay.download_and_hash_artifact", return_value=(baseline_hash, 1024, 200)):
            res_b = perform_monitor_check("m-independent")
            self.assertEqual(res_b.result, "MISMATCH", "Manifest check should be MISMATCH")
            self.assertEqual(res_b.baseline_result, "MATCH", "Baseline check should be MATCH")
            self.assertFalse(res_b.baseline_change_detected)

    def test_baseline_persistence_across_connection_restarts(self):
        """Baseline records, checks, and audit history persist durably in SQLite across connections."""
        base_hash = "73bc91e478f14385f0a8fcd3388af75e0d7e0558fd9e343f59025a048cb5a20f"
        diverged_hash = "9999999999999999999999999999999999999999999999999999999999999999"
        with connect() as db:
            db.execute(
                """
                INSERT INTO artifact_monitors (id, name, artifact_url, expected_sha256, provenance, created_at)
                VALUES ('m-persist', 'Persist Monitor', 'https://example.org/persist.tar.gz', ?, 'MANUAL_UNVERIFIED', '2026-10-04T00:00:00Z')
                """,
                (base_hash,),
            )

        establish_monitor_baseline(
            "m-persist",
            EstablishBaselineRequest(baseline_sha256=base_hash, approved_by="Durable Officer", notes="Persistence test"),
        )

        with patch("backend.relay.download_and_hash_artifact", return_value=(diverged_hash, 1024, 200)):
            perform_monitor_check("m-persist")

        # Open completely fresh direct connection to SQLite file
        import sqlite3
        conn = sqlite3.connect(self.test_db_path)
        conn.row_factory = sqlite3.Row
        try:
            mon_row = conn.execute("SELECT * FROM artifact_monitors WHERE id = 'm-persist'").fetchone()
            self.assertEqual(mon_row["trusted_baseline_sha256"], base_hash)
            self.assertEqual(mon_row["baseline_approved_by"], "Durable Officer")
            self.assertEqual(mon_row["last_baseline_result"], "CHANGED")

            check_row = conn.execute("SELECT * FROM relay_checks WHERE monitor_id = 'm-persist' ORDER BY checked_at DESC LIMIT 1").fetchone()
            self.assertEqual(check_row["baseline_result"], "CHANGED")
            self.assertEqual(check_row["baseline_change_detected"], 1)

            events = conn.execute("SELECT * FROM relay_baseline_events WHERE monitor_id = 'm-persist'").fetchall()
            self.assertGreaterEqual(len(events), 2)  # ESTABLISHED and DIVERGENCE
            event_types = [e["event_type"] for e in events]
            self.assertIn("BASELINE_ESTABLISHED", event_types)
            self.assertIn("BASELINE_DIVERGENCE", event_types)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
