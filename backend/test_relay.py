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
    connect,
    download_and_hash_artifact,
    init_relay_db,
    perform_monitor_check,
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


if __name__ == "__main__":
    unittest.main()
