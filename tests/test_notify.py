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

import notify


class BarkSecurityTests(unittest.TestCase):
    def test_plain_http_is_rejected_without_logging_the_secret(self):
        secret = "device-secret-value"
        output = io.StringIO()
        with (
            patch.object(notify, "get_bark_push", return_value=f"http://push.example/{secret}"),
            patch.dict(os.environ, {}, clear=True),
            contextlib.redirect_stdout(output),
        ):
            self.assertFalse(notify.send("title", "body"))
        self.assertNotIn(secret, output.getvalue())
        self.assertIn("必须使用 HTTPS", output.getvalue())

    def test_post_failure_does_not_fall_back_to_secret_bearing_get(self):
        with (
            patch.object(notify, "get_bark_push", return_value="device-key"),
            patch.object(notify, "_send_bark_post", return_value=(False, "POST 500")),
            patch.object(notify, "_send_bark_get") as send_get,
            patch.dict(os.environ, {}, clear=True),
        ):
            self.assertFalse(notify.send("title", "sensitive body"))
        send_get.assert_not_called()

    def test_get_fallback_requires_explicit_opt_in(self):
        with (
            patch.object(notify, "get_bark_push", return_value="device-key"),
            patch.object(notify, "_send_bark_post", return_value=(False, "POST 500")),
            patch.object(notify, "_send_bark_get", return_value=(True, "GET 200")) as send_get,
            patch.dict(os.environ, {"BARK_ALLOW_GET": "true"}, clear=True),
        ):
            self.assertTrue(notify.send("title", "body"))
        send_get.assert_called_once()


if __name__ == "__main__":
    unittest.main()
