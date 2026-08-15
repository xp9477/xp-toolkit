from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "qinglong"))

import common
import monitor_tplink_AP
import supabase


class SupabaseConfigTests(unittest.TestCase):
    def test_service_role_key_requires_https_origin(self):
        with self.assertRaises(common.ConfigError):
            supabase.Script({"url": "http://project.example", "secret_key": "role-key"})

    def test_origin_cannot_redirect_key_through_path_or_userinfo(self):
        for url in (
            "https://project.example/proxy",
            "https://role-key@project.example",
        ):
            with self.subTest(url=url), self.assertRaises(common.ConfigError):
                supabase.Script({"url": url, "secret_key": "role-key"})


class TpLinkConfigTests(unittest.TestCase):
    def load(self, config: str):
        with patch.dict(os.environ, {"monitor_tplink_AP": config}, clear=True):
            return monitor_tplink_AP.load_monitor_config()

    def test_tls_verification_is_on_by_default(self):
        config = self.load(
            '{"url":"https://ap.local","username":"admin","password":"secret"}'
        )
        self.assertIs(config["verify"], True)

    def test_plain_http_requires_explicit_insecure_migration_flag(self):
        with self.assertRaises(common.ConfigError):
            self.load('{"url":"http://ap.local","username":"admin","password":"secret"}')
        config = self.load(
            '{"url":"http://ap.local","username":"admin","password":"secret",'
            '"verify_tls":false}'
        )
        self.assertIs(config["verify"], False)

    def test_custom_ca_and_disabled_verification_are_mutually_exclusive(self):
        with self.assertRaises(ValueError):
            self.load(
                '{"url":"https://ap.local","username":"admin","password":"secret",'
                '"verify_tls":false,"ca_bundle":"/tmp/device-ca.pem"}'
            )


if __name__ == "__main__":
    unittest.main()
