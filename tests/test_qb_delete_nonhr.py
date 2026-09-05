from __future__ import annotations

import base64
import contextlib
import hashlib
import io
import json
import os
import sys
import unittest
from pathlib import Path
from typing import ClassVar
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "qinglong"))

import qb_delete_nonHR as qb

TORRENT_HASH = "a" * 40


class FakeClient:
    torrents: ClassVar[list[dict] | None] = []
    trackers: ClassVar[list[dict] | None] = []
    login_result = True
    delete_result = True
    instances: ClassVar[list[FakeClient]] = []

    def __init__(self, _base_url, _api_key, *, verify_tls=True):
        self.verify_tls = verify_tls
        self.delete_calls = []
        self.closed = False
        type(self).instances.append(self)

    def login(self):
        return type(self).login_result

    def get_torrents(self):
        return type(self).torrents

    def get_torrent_trackers(self, _hash_value):
        return type(self).trackers

    def delete_torrent(self, hash_value, *, delete_files=False):
        self.delete_calls.append((hash_value, delete_files))
        return type(self).delete_result

    def close(self):
        self.closed = True


class ScriptSafetyTests(unittest.TestCase):
    def setUp(self):
        FakeClient.torrents = []
        FakeClient.trackers = []
        FakeClient.login_result = True
        FakeClient.delete_result = True
        FakeClient.instances = []

    @staticmethod
    def account(**overrides):
        account = {"url": "https://qb.example", "api_key": "test-key"}
        account.update(overrides)
        return account

    def run_script(self, account):
        output = io.StringIO()
        with (
            patch.object(qb, "QBittorrentClient", FakeClient),
            patch.dict(os.environ, {}, clear=True),
            contextlib.redirect_stdout(output),
        ):
            result = qb.Script(account).run()
        return result, output.getvalue(), FakeClient.instances[-1]

    def test_torrent_api_failure_aborts_without_deleting(self):
        FakeClient.torrents = None

        result, _output, client = self.run_script(self.account())

        self.assertFalse(result)
        self.assertEqual(client.delete_calls, [])
        self.assertTrue(client.closed)

    def test_tracker_api_failure_keeps_torrent_safely(self):
        FakeClient.torrents = [
            {"hash": TORRENT_HASH, "name": "Example.Release", "tags": "已整理"}
        ]
        FakeClient.trackers = None

        result, _output, client = self.run_script(self.account())

        self.assertTrue(result)
        self.assertEqual(client.delete_calls, [])

    def test_dry_run_preview_mode(self):
        FakeClient.torrents = [
            {"hash": TORRENT_HASH, "name": "Example.Release", "tags": "已整理"}
        ]
        FakeClient.trackers = [{"url": "https://tracker.example/announce"}]

        result, output, client = self.run_script(self.account(dry_run=True))

        self.assertTrue(result)
        self.assertEqual(client.delete_calls, [])
        self.assertIn("[dry-run]", output)

    def test_default_executes_direct_delete_with_files(self):
        FakeClient.torrents = [
            {"hash": TORRENT_HASH, "name": "Example.Release", "tags": "已整理"}
        ]
        FakeClient.trackers = [{"url": "udp://tracker.example:1337/announce"}]

        result, _output, client = self.run_script(self.account())

        self.assertTrue(result)
        self.assertEqual(client.delete_calls, [(TORRENT_HASH, True)])
        self.assertTrue(client.verify_tls)

    def test_delete_files_false_preserves_files(self):
        FakeClient.torrents = [
            {"hash": TORRENT_HASH, "name": "Example.Release", "tags": "已整理"}
        ]
        FakeClient.trackers = [{"url": "udp://tracker.example:1337/announce"}]

        result, _output, client = self.run_script(self.account(delete_files=False))

        self.assertTrue(result)
        self.assertEqual(client.delete_calls, [(TORRENT_HASH, False)])

    def test_unmatched_chdbits_torrent_is_deleted(self):
        FakeClient.torrents = [
            {"hash": TORRENT_HASH, "name": "Movie.2024.Remux", "tags": "已整理"}
        ]
        FakeClient.trackers = [{"url": "https://tracker.ptchdbits.co/announce"}]
        html = """
            <table>
              <tr><a href="details.php?id=1" title="Another.Movie.2024">A</a></tr>
            </table>
        """
        account = self.account(
            chdbits_userid="123",
            cookiecloud_url="https://cookies.example",
            cookiecloud_uuid="uuid",
            cookiecloud_password="password",
        )
        output = io.StringIO()
        with (
            patch.object(qb, "QBittorrentClient", FakeClient),
            patch.object(qb, "get_cookiecloud_cookies", return_value={"sid": "value"}),
            patch.object(qb.Script, "get_chdbits_userdetails", return_value=html),
            patch.dict(os.environ, {}, clear=True),
            contextlib.redirect_stdout(output),
        ):
            result = qb.Script(account).run()

        self.assertTrue(result)
        self.assertEqual(FakeClient.instances[-1].delete_calls, [(TORRENT_HASH, True)])
        self.assertIn("未找到该种子（无活跃 HR 做种），准备删除", output.getvalue())

    def test_ambiguous_hr_match_is_preserved(self):
        FakeClient.torrents = [
            {"hash": TORRENT_HASH, "name": "Movie.2024.Remux", "tags": "已整理"}
        ]
        FakeClient.trackers = [{"url": "https://tracker.ptchdbits.co/announce"}]
        html = """
            <table>
              <tr><a href="details.php?id=1" title="Movie.2024.Remux">A</a></tr>
              <tr><a href="details.php?id=2" title="Movie.2024.Remux">B</a></tr>
            </table>
        """
        account = self.account(
            chdbits_userid="123",
            cookiecloud_url="https://cookies.example",
            cookiecloud_uuid="uuid",
            cookiecloud_password="password",
        )
        output = io.StringIO()
        with (
            patch.object(qb, "QBittorrentClient", FakeClient),
            patch.object(qb, "get_cookiecloud_cookies", return_value={"sid": "value"}),
            patch.object(qb.Script, "get_chdbits_userdetails", return_value=html),
            patch.dict(os.environ, {}, clear=True),
            contextlib.redirect_stdout(output),
        ):
            result = qb.Script(account).run()

        self.assertTrue(result)
        self.assertEqual(FakeClient.instances[-1].delete_calls, [])
        self.assertIn("存在多个精确匹配，为安全起见已保留", output.getvalue())

    def test_hr_torrent_is_preserved(self):
        FakeClient.torrents = [
            {"hash": TORRENT_HASH, "name": "Movie.2024.Remux", "tags": "已整理"}
        ]
        FakeClient.trackers = [{"url": "https://tracker.ptchdbits.co/announce"}]
        html = """
            <table>
              <tr><a href="details.php?id=1" title="Movie.2024.Remux">A</a><div class="circle-text">HR</div></tr>
            </table>
        """
        account = self.account(
            chdbits_userid="123",
            cookiecloud_url="https://cookies.example",
            cookiecloud_uuid="uuid",
            cookiecloud_password="password",
        )
        output = io.StringIO()
        with (
            patch.object(qb, "QBittorrentClient", FakeClient),
            patch.object(qb, "get_cookiecloud_cookies", return_value={"sid": "value"}),
            patch.object(qb.Script, "get_chdbits_userdetails", return_value=html),
            patch.dict(os.environ, {}, clear=True),
            contextlib.redirect_stdout(output),
        ):
            result = qb.Script(account).run()

        self.assertTrue(result)
        self.assertEqual(FakeClient.instances[-1].delete_calls, [])
        self.assertIn("带有 HR 标签，保留", output.getvalue())

    def test_tls_verification_can_only_be_disabled_explicitly(self):
        result, _output, client = self.run_script(self.account(verify_tls=False))

        self.assertTrue(result)
        self.assertFalse(client.verify_tls)

    def test_plain_http_qb_url_requires_explicit_insecure_mode(self):
        with self.assertRaisesRegex(ValueError, "必须使用 HTTPS"):
            qb.Script(self.account(url="http://qb.example"))

        script = qb.Script(self.account(url="http://qb.example", verify_tls=False))
        self.assertEqual(script.url, "http://qb.example")

        script = qb.Script(
            self.account(url="http://qb.example", allow_insecure_http=True)
        )
        self.assertEqual(script.url, "http://qb.example")

    def test_private_and_loopback_http_qb_urls_work_without_tls_flags(self):
        for url in (
            "http://192.168.1.20:8080",
            "http://10.0.0.3",
            "http://127.0.0.1:8080",
            "http://qb.local:8080",
        ):
            with self.subTest(url=url):
                self.assertEqual(qb.Script(self.account(url=url)).url, url)


class MatchingAndParsingTests(unittest.TestCase):
    def test_tracker_allowlist_is_exact_hostname_match(self):
        allowed = qb.DEFAULT_CHDBITS_TRACKER_HOSTS
        deceptive_urls = [
            "https://tracker.ptchdbits.co.evil.example/announce",
            "https://evil.example/announce?next=tracker.ptchdbits.co",
            "https://ptchdbits.co@example.org/announce",
        ]

        for url in deceptive_urls:
            with self.subTest(url=url):
                self.assertNotIn(qb.tracker_hostname(url), allowed)

        self.assertEqual(
            qb.tracker_hostname("HTTPS://TRACKER.PTCHDBITS.CO./announce"),
            "tracker.ptchdbits.co",
        )

    def test_fuzzy_match_is_never_sufficient_deletion_evidence(self):
        candidates = [
            ("movie2024remuxa", False, "Movie 2024 Remux A"),
            ("movie2024remuxb", False, "Movie 2024 Remux B"),
        ]

        match, status = qb.find_unique_torrent_match("Movie.2024.Remux", candidates)

        self.assertIsNone(match)
        self.assertEqual(status, "not_found")

    @patch.object(qb.httpx, "get")
    def test_cookiecloud_password_never_enters_request_url(self, get):
        response = Mock(status_code=200)
        response.json.return_value = {
            "cookie_data": [
                {"domain": ".ptchdbits.co", "name": "sid", "value": "cookie"},
                {"domain": "evilptchdbits.co", "name": "evil", "value": "cookie"},
            ]
        }
        get.return_value = response

        cookies = qb.get_cookiecloud_cookies(
            "https://cookies.example/api",
            "uuid-123",
            "top-secret-password",
        )

        self.assertEqual(cookies, {"sid": "cookie"})
        get.assert_called_once_with(
            "https://cookies.example/api/get/uuid-123",
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            timeout=30,
            follow_redirects=False,
        )
        request_text = repr(get.call_args)
        self.assertNotIn("top-secret-password", request_text)

    def test_cookiecloud_plain_http_requires_explicit_opt_in(self):
        with self.assertRaisesRegex(ValueError, "必须使用 HTTPS"):
            qb.validate_cookiecloud_base_url("http://cookies.example")
        self.assertEqual(
            qb.validate_cookiecloud_base_url(
                "http://cookies.example/api/",
                allow_http=True,
            ),
            "http://cookies.example/api",
        )

    def test_cookiecloud_fixed_iv_payload_decrypts_with_declared_provider(self):
        from cryptography.hazmat.primitives import padding
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

        uuid = "uuid-123"
        password = "password"
        payload = {"cookie_data": [{"name": "sid", "value": "cookie"}]}
        key = hashlib.md5(f"{uuid}-{password}".encode()).hexdigest()[:16].encode()
        padder = padding.PKCS7(algorithms.AES.block_size).padder()
        padded = padder.update(json.dumps(payload).encode()) + padder.finalize()
        encryptor = Cipher(algorithms.AES(key), modes.CBC(b"\x00" * 16)).encryptor()
        encrypted = encryptor.update(padded) + encryptor.finalize()

        decoded = qb._decrypt_cookiecloud_payload(
            base64.b64encode(encrypted).decode(),
            uuid,
            password,
        )

        self.assertEqual(decoded, payload)

    def test_client_parse_failure_is_not_reported_as_empty_list(self):
        client = object.__new__(qb.QBittorrentClient)
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"unexpected": "shape"}
        client.session = Mock()
        client.session.get.return_value = response

        with contextlib.redirect_stdout(io.StringIO()):
            torrents = client.get_torrents()
            trackers = client.get_torrent_trackers(TORRENT_HASH)

        self.assertIsNone(torrents)
        self.assertIsNone(trackers)
        self.assertIsNone(qb.parse_chdbits_torrents("<html>layout changed</html>"))

    def test_cookiecloud_private_http_allowed(self):
        self.assertEqual(
            qb.validate_cookiecloud_base_url("http://192.168.1.100:8088/api/"),
            "http://192.168.1.100:8088/api",
        )
        self.assertEqual(
            qb.validate_cookiecloud_base_url("http://localhost:8088/api"),
            "http://localhost:8088/api",
        )

    def test_parse_chdbits_torrents_empty_seeding_list(self):
        self.assertEqual(
            qb.parse_chdbits_torrents(
                "<table><tr><td>没有做种的种子</td></tr></table>"
            ),
            [],
        )

    def test_find_unique_torrent_match_with_chinese_prefix(self):
        candidates = [
            (
                qb.normalize_torrent_name(
                    "Keep.Real.2026.2160p.WEB-DL.H.265.HDR.AAC2.0-HHWEB"
                ),
                False,
                "Keep.Real.2026.2160p.WEB-DL.H.265.HDR.AAC2.0-HHWEB",
            ),
        ]
        match, status = qb.find_unique_torrent_match(
            "特立独行.Keep.Real.2026.2160p.WEB-DL.H.265.HDR.AAC2.0-HHWEB", candidates
        )
        self.assertEqual(status, "matched")
        self.assertEqual(match[2], "Keep.Real.2026.2160p.WEB-DL.H.265.HDR.AAC2.0-HHWEB")

    def test_find_unique_torrent_match_with_site_prefix(self):
        candidates = [
            ("moviename20241080p", False, "Movie Name 2024 1080p"),
        ]
        match, status = qb.find_unique_torrent_match(
            "[CHDBits] Movie.Name.2024.1080p", candidates
        )
        self.assertEqual(status, "matched")
        self.assertEqual(match[0], "moviename20241080p")

    def test_client_delete_defaults_to_preserving_files(self):
        client = object.__new__(qb.QBittorrentClient)
        response = Mock(status_code=200, text="")
        client.session = Mock()
        client.session.post.return_value = response

        with contextlib.redirect_stdout(io.StringIO()):
            result = client.delete_torrent(TORRENT_HASH)

        self.assertTrue(result)
        client.session.post.assert_called_once_with(
            "/api/v2/torrents/delete",
            data={"hashes": TORRENT_HASH, "deleteFiles": "false"},
        )


if __name__ == "__main__":
    unittest.main()
