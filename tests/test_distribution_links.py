from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOON_ROOT = ROOT / "proxy" / "loon"
CURRENT_RAW_URL = re.compile(
    r"https://raw\.githubusercontent\.com/xp9477/xp-toolkit/main/"
    r"([A-Za-z0-9_.\-/]+)"
)


class DistributionLinkTests(unittest.TestCase):
    def test_distribution_files_do_not_reference_retired_repositories(self):
        for path in LOON_ROOT.rglob("*"):
            if not path.is_file() or path.suffix == ".png":
                continue
            source = path.read_text(encoding="utf-8")
            self.assertNotRegex(source, r"github\.com/xp9477/(?:Rules|Scripts)(?:/|$)")

    def test_current_repository_raw_links_resolve_to_tracked_files(self):
        checked = 0
        for path in LOON_ROOT.rglob("*"):
            if not path.is_file() or path.suffix == ".png":
                continue
            source = path.read_text(encoding="utf-8")
            for relative_path in CURRENT_RAW_URL.findall(source):
                checked += 1
                target = ROOT / relative_path
                self.assertTrue(target.is_file(), f"broken raw link in {path}: {target}")
        self.assertGreater(checked, 0, "expected at least one local raw distribution link")


if __name__ == "__main__":
    unittest.main()
