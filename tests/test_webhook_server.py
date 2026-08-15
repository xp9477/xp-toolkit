from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "qinglong"))

import common
import webhook_server


class ConfigTests(unittest.TestCase):
    def test_non_loopback_requires_long_token(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "job.py").write_text("", encoding="utf-8")
            raw = '{"bind":"0.0.0.0","script":"job.py","token":"short"}'
            with (
                patch.dict(os.environ, {"webhook_server": raw}),
                self.assertRaises(common.ConfigError),
            ):
                webhook_server.load_server_config(root)

    def test_script_cannot_escape_allowed_root(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "allowed"
            root.mkdir()
            outside = base / "outside.py"
            outside.write_text("", encoding="utf-8")
            with self.assertRaises(common.ConfigError):
                webhook_server.resolve_task_script("../outside.py", root)


class AuthorizationTests(unittest.TestCase):
    def test_bearer_token_is_exact(self):
        self.assertTrue(webhook_server.authorization_matches("Bearer secret", "secret"))
        self.assertFalse(webhook_server.authorization_matches("Bearer secret-x", "secret"))
        self.assertFalse(webhook_server.authorization_matches(None, "secret"))


class TriggerTests(unittest.TestCase):
    def setUp(self):
        self.config = webhook_server.ServerConfig(
            bind="127.0.0.1",
            port=8001,
            token="",
            script=Path("/tmp/job.py"),
            cooldown_seconds=30,
        )

    @patch("webhook_server.subprocess.Popen")
    def test_running_task_cannot_be_fork_bombed(self, popen):
        process = Mock()
        process.poll.return_value = None
        popen.return_value = process
        controller = webhook_server.TriggerController(self.config)
        self.assertEqual(controller.trigger(now=100)[0], 202)
        self.assertEqual(controller.trigger(now=101)[0], 409)
        popen.assert_called_once()

    @patch("webhook_server.subprocess.Popen")
    def test_cooldown_returns_retry_after(self, popen):
        process = Mock()
        process.poll.return_value = 0
        popen.return_value = process
        controller = webhook_server.TriggerController(self.config)
        self.assertEqual(controller.trigger(now=100)[0], 202)
        status, _, retry_after = controller.trigger(now=105)
        self.assertEqual(status, 429)
        self.assertEqual(retry_after, 25)


if __name__ == "__main__":
    unittest.main()
