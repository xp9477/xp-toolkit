from __future__ import annotations

import codecs
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "skills" / "loon-plugin-maker" / "scripts" / "find_endpoints.py"
SPEC = importlib.util.spec_from_file_location("find_endpoints", MODULE_PATH)
find_endpoints = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(find_endpoints)


class FlowEncodingTests(unittest.TestCase):
    def test_utf8_utf8_sig_and_bom_marked_utf16_are_supported(self):
        payload = [{"request": {"host": "api.example.com"}}]
        text = json.dumps(payload)
        encodings = {
            "utf-8": text.encode("utf-8"),
            "utf-8-sig": codecs.BOM_UTF8 + text.encode("utf-8"),
            "utf-16-le": codecs.BOM_UTF16_LE + text.encode("utf-16-le"),
            "utf-16-be": codecs.BOM_UTF16_BE + text.encode("utf-16-be"),
        }
        with tempfile.TemporaryDirectory() as directory:
            for name, raw in encodings.items():
                with self.subTest(encoding=name):
                    path = Path(directory) / f"{name}.json"
                    path.write_bytes(raw)
                    self.assertEqual(find_endpoints.parse_flows(path), payload)

    def test_non_array_flows_member_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.json"
            path.write_text('{"flows": {}}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "flows 必须是数组"):
                find_endpoints.parse_flows(path)


class VipFieldTests(unittest.TestCase):
    def test_shared_vip_patterns_are_used(self):
        fields = find_endpoints.find_vip_fields(
            {"data": {"expiry": 123, "ordinary": False}}
        )
        self.assertEqual([field["path"] for field in fields], ["data.expiry"])

        marker = "customEntitlementMarker"
        find_endpoints.VIP_FIELD_PATTERNS.append(marker)
        try:
            fields = find_endpoints.find_vip_fields({marker: True})
        finally:
            find_endpoints.VIP_FIELD_PATTERNS.pop()
        self.assertEqual([field["path"] for field in fields], [marker])


if __name__ == "__main__":
    unittest.main()
