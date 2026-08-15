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
    def test_malformed_json_is_not_sent_as_a_device_key(self):
        malformed = '{"bark":"secret-device-key"'
        output = io.StringIO()
        with (
            patch.dict(os.environ, {"notify": malformed}, clear=True),
            patch.object(notify, "_send_bark_post") as send_post,
            contextlib.redirect_stdout(output),
        ):
            self.assertFalse(notify.send("title", "body"))

        send_post.assert_not_called()
        self.assertNotIn("secret-device-key", output.getvalue())
        self.assertIn("JSON 配置无效", output.getvalue())

    def test_plain_http_is_rejected_without_logging_the_secret(self):
        secret = "device-secret-value"
        output = io.StringIO()
        with (
            patch.object(
                notify, "get_bark_push", return_value=f"http://push.example/{secret}"
            ),
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
            patch.object(
                notify, "_send_bark_get", return_value=(True, "GET 200")
            ) as send_get,
            patch.dict(os.environ, {"BARK_ALLOW_GET": "true"}, clear=True),
        ):
            self.assertTrue(notify.send("title", "body"))
        send_get.assert_called_once()

    @patch.object(notify.requests, "get")
    def test_explicit_get_fallback_encodes_path_separators(self, get):
        response = get.return_value
        response.status_code = 200
        response.json.return_value = {"code": 200}

        ok, _detail = notify._send_bark_get(
            "https://push.example",
            "device/key",
            "title/segment",
            "body/segment",
        )

        self.assertTrue(ok)
        requested_url = get.call_args.args[0]
        self.assertIn("device%2Fkey/title%2Fsegment/body%2Fsegment", requested_url)


if __name__ == "__main__":
    unittest.main()
