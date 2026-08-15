from __future__ import annotations

import contextlib
import io
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "qinglong"))

import common


class LoadAccountsTests(unittest.TestCase):
    def test_accepts_supported_shapes(self):
        cases = (
            ('{"name":"one"}', ["one"]),
            ('[{"name":"one"},{"name":"two"}]', ["one", "two"]),
            ('{"accounts":[{"name":"one"}]}', ["one"]),
        )
        for raw, expected in cases:
            with self.subTest(raw=raw), patch.dict(os.environ, {"demo": raw}):
                actual = [item["name"] for item in common.load_accounts("demo.py")]
                self.assertEqual(actual, expected)

    def test_json_lines_error_never_logs_source_secret(self):
        secret = "super-secret-password"
        raw = f'{{"password":"{secret}"\n{{"name":"valid"}}'
        output = io.StringIO()
        with (
            patch.dict(os.environ, {"demo": raw}),
            contextlib.redirect_stdout(output),
        ):
            accounts = common.load_accounts("demo.py")
        self.assertEqual(accounts, [{"name": "valid"}])
        self.assertNotIn(secret, output.getvalue())
        self.assertIn("问题内容已隐藏", output.getvalue())

    def test_scalar_json_is_rejected(self):
        with (
            patch.dict(os.environ, {"demo": "42"}),
            self.assertRaises(common.ConfigError),
        ):
            common.load_accounts("demo.py")


class SecurityConfigTests(unittest.TestCase):
    def test_parse_bool_does_not_treat_false_string_as_true(self):
        self.assertFalse(common.parse_bool("false", default=True, field_name="flag"))
        self.assertTrue(common.parse_bool("yes", default=False, field_name="flag"))
        with self.assertRaises(common.ConfigError):
            common.parse_bool("sometimes", default=False, field_name="flag")

    def test_service_origin_is_https_and_contains_no_credentials_or_path(self):
        self.assertEqual(
            common.validate_service_origin("https://api.example:8443/"),
            "https://api.example:8443",
        )
        for value in (
            "http://api.example",
            "https://user:secret@api.example",
            "https://api.example/rest/v1",
            "https://api.example?redirect=evil",
        ):
            with self.subTest(value=value), self.assertRaises(common.ConfigError):
                common.validate_service_origin(value)

    def test_plain_http_requires_an_explicit_call_site_opt_in(self):
        self.assertEqual(
            common.validate_service_origin("http://ap.local", allow_http=True),
            "http://ap.local",
        )


class RunnerTests(unittest.TestCase):
    def test_false_result_is_failure(self):
        class Script:
            def __init__(self, account):
                self.account = account

            def run(self):
                return self.account["ok"]

        raw = '[{"name":"good","ok":true},{"name":"bad","ok":false}]'
        with patch.dict(os.environ, {"demo": raw}):
            summary = common.run_account_scripts("demo.py", Script)
        self.assertEqual(summary.total_count, 2)
        self.assertEqual(summary.success_count, 1)
        self.assertEqual(summary.failure_count, 1)
        self.assertEqual(summary.exit_code, 1)


if __name__ == "__main__":
    unittest.main()
