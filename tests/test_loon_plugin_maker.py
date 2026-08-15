from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "skills" / "loon-plugin-maker" / "scripts" / "generate_plugin.py"
SPEC = importlib.util.spec_from_file_location("generate_plugin", MODULE_PATH)
generate_plugin = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(generate_plugin)


class GeneratorTests(unittest.TestCase):
    def test_strings_remain_strings_and_output_is_valid_javascript(self):
        script = generate_plugin.generate_vip_script(
            {"data.user.label": 'quoted "value"', "data.items[0].count": "0"},
            "/api/user's-status",
        )
        self.assertIn('"value":"0"', script)
        result = subprocess.run(
            ["node", "--check"],
            input=script,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_invalid_field_path_is_rejected(self):
        with self.assertRaises(generate_plugin.ConfigError):
            generate_plugin.parse_field_path("data.items[0]junk.vip")

    def test_header_injection_hostname_is_rejected(self):
        with self.assertRaises(generate_plugin.ConfigError):
            generate_plugin.generate_plugin(
                "App",
                "https://example.com/script.js",
                ["api.example.com\n[MITM]"],
            )

    def test_wildcard_hostname_becomes_a_real_url_regex(self):
        plugin = generate_plugin.generate_plugin(
            "App",
            "https://example.com/script.js",
            ["*.example.com/api/user"],
        )
        line = next(
            line for line in plugin.splitlines() if line.startswith("http-response")
        )
        pattern = line.split(" ", 2)[1]
        self.assertIsNotNone(re.match(pattern, "https://api.example.com/api/user"))
        self.assertIsNotNone(re.match(pattern, "https://v2.api.example.com/api/user"))
        self.assertIsNone(re.match(pattern, "https://example.com/api/user"))
        self.assertIsNone(re.match(pattern, "https://evil-example.com/api/user"))
        self.assertIsNone(re.match(pattern, "https://user@api.example.com/api/user"))
        self.assertNotIn(r"\*", pattern)

    def test_documented_one_argument_cli_writes_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "output"
            config = {
                "app_name": "Test App",
                "url_pattern": "/api/user",
                "field_mappings": {"data.vip": True},
                "mitm_hostnames": ["api.example.com/api/user"],
                "script_url": "https://example.com/response-mapping.js",
                "output_dir": str(output),
            }
            config_path = root / "config.json"
            config_path.write_text(json.dumps(config), encoding="utf-8")
            self.assertEqual(generate_plugin.main([str(config_path)]), 0)
            self.assertTrue((output / "response-mapping.js").is_file())
            self.assertTrue((output / "Test_App.plugin").is_file())


if __name__ == "__main__":
    unittest.main()
