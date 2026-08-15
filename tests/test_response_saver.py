from __future__ import annotations

import importlib.util
import json
import stat
import tempfile
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "skills" / "loon-plugin-maker" / "scripts" / "save_responses.py"
SPEC = importlib.util.spec_from_file_location("save_responses", MODULE_PATH)
save_responses = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(save_responses)


class RedactionTests(unittest.TestCase):
    def test_header_query_and_nested_json_secrets_are_redacted(self):
        headers = save_responses.redact_headers(
            {
                "Authorization": "Bearer secret",
                "X-Auth": "another secret",
                "Content-Type": "application/json",
            }
        )
        self.assertEqual(headers["Authorization"], "<redacted>")
        self.assertEqual(headers["X-Auth"], "<redacted>")
        self.assertEqual(headers["Content-Type"], "application/json")
        url = save_responses.redact_url("https://api.example/a?token=secret&page=2")
        self.assertNotIn("secret", url)
        self.assertNotIn("page=2", url)
        self.assertIn("page=%3Credacted%3E", url)
        self.assertNotIn(
            "fragment-secret",
            save_responses.redact_url("https://api.example/a#fragment-secret"),
        )
        body = save_responses.redact_json(
            {
                "data": {
                    "access_token": "secret",
                    "message": "also secret",
                    "account_number": 123456789,
                }
            }
        )
        self.assertEqual(body["data"]["access_token"], "<redacted>")
        self.assertNotIn("also secret", body["data"]["message"])
        self.assertEqual(body["data"]["account_number"], 0)

    def test_wildcard_does_not_match_apex(self):
        self.assertTrue(
            save_responses.host_allowed("api.example.com", ("*.example.com",))
        )
        self.assertFalse(save_responses.host_allowed("example.com", ("*.example.com",)))

    def test_unknown_body_mode_is_rejected(self):
        with self.assertRaises(ValueError):
            save_responses.ResponseSaver(
                hosts=("api.example.com",), body_mode="raw-by-mistake"
            )


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
                save_dir=directory,
                hosts=("api.example.com",),
                max_body_bytes=1024,
                body_mode="structure",
            )
            saver.response(
                self._flow(b'{"access_token":"secret","message":"private","value":1}')
            )
            files = list(Path(directory).glob("*.json"))
            self.assertEqual(len(files), 1)
            raw = files[0].read_text(encoding="utf-8")
            self.assertNotIn("secret", raw)
            self.assertNotIn("private", raw)
            self.assertEqual(stat.S_IMODE(files[0].stat().st_mode), 0o600)

    def test_oversized_body_is_not_written(self):
        with tempfile.TemporaryDirectory() as directory:
            saver = save_responses.ResponseSaver(
                save_dir=directory,
                hosts=("api.example.com",),
                max_body_bytes=4,
                body_mode="structure",
            )
            saver.response(self._flow(b"12345"))
            path = next(Path(directory).glob("*.json"))
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertIn("exceeds limit", data["body"])

    def test_default_mode_never_saves_plaintext_body(self):
        with tempfile.TemporaryDirectory() as directory:
            saver = save_responses.ResponseSaver(
                save_dir=directory, hosts=("api.example.com",)
            )
            saver.response(self._flow(b"plain text password=top-secret"))
            path = next(Path(directory).glob("*.json"))
            raw = path.read_text(encoding="utf-8")
            self.assertNotIn("top-secret", raw)
            self.assertIn("metadata-only", raw)

    def test_structure_mode_omits_xml_and_redacts_top_level_json_string(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            xml_dir = root / "xml"
            xml_saver = save_responses.ResponseSaver(
                save_dir=xml_dir,
                hosts=("api.example.com",),
                body_mode="structure",
            )
            xml_saver.response(self._flow(b"<token>xml-secret</token>"))
            xml_raw = next(xml_dir.glob("*.json")).read_text(encoding="utf-8")
            self.assertNotIn("xml-secret", xml_raw)
            self.assertIn("non-JSON", xml_raw)

            string_dir = root / "json-string"
            string_saver = save_responses.ResponseSaver(
                save_dir=string_dir,
                hosts=("api.example.com",),
                body_mode="structure",
            )
            string_saver.response(self._flow(b'"json-string-secret"'))
            string_raw = next(string_dir.glob("*.json")).read_text(encoding="utf-8")
            self.assertNotIn("json-string-secret", string_raw)
            self.assertIn("redacted-string", string_raw)

    def test_existing_directory_permissions_are_not_changed(self):
        with tempfile.TemporaryDirectory() as directory:
            existing = Path(directory) / "user-owned"
            existing.mkdir(mode=0o755)
            existing.chmod(0o755)
            save_responses.ResponseSaver(save_dir=existing, hosts=("api.example.com",))
            self.assertEqual(stat.S_IMODE(existing.stat().st_mode), 0o755)

    def test_new_capture_leaf_is_private(self):
        with tempfile.TemporaryDirectory() as directory:
            capture = Path(directory) / "dedicated-capture"
            save_responses.ResponseSaver(save_dir=capture, hosts=("api.example.com",))
            self.assertEqual(stat.S_IMODE(capture.stat().st_mode), 0o700)

    def test_missing_parent_is_not_created_implicitly(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory) / "user-must-create-this"
            capture = parent / "capture"
            with self.assertRaisesRegex(ValueError, "上级目录不存在"):
                save_responses.ResponseSaver(
                    save_dir=capture, hosts=("api.example.com",)
                )
            self.assertFalse(parent.exists())


if __name__ == "__main__":
    unittest.main()
