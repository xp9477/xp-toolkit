from __future__ import annotations

import importlib.util
import json
import stat
import sys
import tempfile
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "skills" / "loon-plugin-maker" / "scripts" / "save_responses.py"
fake_mitmproxy = types.ModuleType("mitmproxy")
fake_mitmproxy.http = types.SimpleNamespace(HTTPFlow=object)
sys.modules.setdefault("mitmproxy", fake_mitmproxy)
SPEC = importlib.util.spec_from_file_location("save_responses", MODULE_PATH)
save_responses = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(save_responses)


class RedactionTests(unittest.TestCase):
    def test_header_query_and_nested_json_secrets_are_redacted(self):
        headers = save_responses.redact_headers(
            {"Authorization": "Bearer secret", "Content-Type": "application/json"}
        )
        self.assertEqual(headers["Authorization"], "<redacted>")
        self.assertEqual(headers["Content-Type"], "application/json")
        url = save_responses.redact_url("https://api.example/a?token=secret&page=2")
        self.assertNotIn("secret", url)
        self.assertIn("page=2", url)
        body = save_responses.redact_json({"data": {"access_token": "secret"}})
        self.assertEqual(body["data"]["access_token"], "<redacted>")

    def test_wildcard_does_not_match_apex(self):
        self.assertTrue(save_responses.host_allowed("api.example.com", ("*.example.com",)))
        self.assertFalse(save_responses.host_allowed("example.com", ("*.example.com",)))


class CaptureTests(unittest.TestCase):
    @staticmethod
    def _flow(content):
        request = types.SimpleNamespace(
            host="api.example.com",
            method="GET",
            path="/user?token=secret&page=2",
            url="https://api.example.com/user?token=secret&page=2",
            headers={"Authorization": "Bearer secret"},
        )
        response = types.SimpleNamespace(
            content=content,
            status_code=200,
            headers={"content-type": "application/json", "set-cookie": "sid=secret"},
        )
        return types.SimpleNamespace(id="flow-1", request=request, response=response)

    def test_capture_is_private_and_redacted(self):
        with tempfile.TemporaryDirectory() as directory:
            saver = save_responses.ResponseSaver(
                save_dir=directory, hosts=("api.example.com",), max_body_bytes=1024
            )
            saver.response(self._flow(b'{"access_token":"secret","value":1}'))
            files = list(Path(directory).glob("*.json"))
            self.assertEqual(len(files), 1)
            raw = files[0].read_text(encoding="utf-8")
            self.assertNotIn("secret", raw)
            self.assertEqual(stat.S_IMODE(files[0].stat().st_mode), 0o600)

    def test_oversized_body_is_not_written(self):
        with tempfile.TemporaryDirectory() as directory:
            saver = save_responses.ResponseSaver(
                save_dir=directory, hosts=("api.example.com",), max_body_bytes=4
            )
            saver.response(self._flow(b"12345"))
            path = next(Path(directory).glob("*.json"))
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertIn("exceeds limit", data["body"])


if __name__ == "__main__":
    unittest.main()
