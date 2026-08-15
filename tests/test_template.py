from __future__ import annotations

import contextlib
import io
import sys
import unittest
from pathlib import Path

QINGLONG_DIR = Path(__file__).resolve().parents[1] / "qinglong"
if str(QINGLONG_DIR) not in sys.path:
    sys.path.insert(0, str(QINGLONG_DIR))

import template


class TemplateSafetyTests(unittest.TestCase):
    def test_example_never_logs_account_secrets(self):
        secret = "super-secret-cookie"
        output = io.StringIO()

        with contextlib.redirect_stdout(output):
            result = template.Script(
                {"username": "example-user", "cookie": secret, "password": secret}
            ).run()

        self.assertTrue(result)
        self.assertIn("example-user", output.getvalue())
        self.assertNotIn(secret, output.getvalue())
        self.assertNotIn("password", output.getvalue())


if __name__ == "__main__":
    unittest.main()
