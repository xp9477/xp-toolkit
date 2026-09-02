from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".github" / "scripts"))

import check_rules
import sync_rules


class ParserTests(unittest.TestCase):
    def test_round_trip_all_formats(self):
        intermediate = [
            ("comment", "# group"),
            ("domain", "api.example.com"),
            ("domain-suffix", "example.org"),
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            loon = root / "rules.list"
            clash = root / "rules.yaml"
            sync_rules.write_loon(intermediate, loon)
            sync_rules.write_clash(intermediate, clash)
            self.assertEqual(sync_rules.parse_loon(loon), intermediate)
            self.assertEqual(sync_rules.parse_clash(clash), intermediate)

    def test_unknown_rule_is_rejected_instead_of_dropped(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rules.list"
            path.write_text("DOMAIN-KEYWORD,example\n", encoding="utf-8")
            with self.assertRaises(sync_rules.RuleFormatError):
                sync_rules.parse_loon(path)


class SyncTests(unittest.TestCase):
    def test_divergent_changed_sources_are_rejected_without_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            loon = root / "rules.list"
            clash = root / "rules.yaml"
            loon.write_text("DOMAIN,a.example\n", encoding="utf-8")
            original = "payload:\n  - DOMAIN,b.example\n"
            clash.write_text(original, encoding="utf-8")
            rule_sets = [
                {
                    "name": "Test",
                    "policy": "Policy",
                    "loon": str(loon),
                    "clash": str(clash),
                }
            ]
            with self.assertRaises(sync_rules.RuleSyncError):
                sync_rules.sync_from([str(loon), str(clash)], rule_sets=rule_sets)
            self.assertEqual(clash.read_text(encoding="utf-8"), original)


class ConflictTests(unittest.TestCase):
    def test_exact_domain_overlaps_parent_suffix(self):
        self.assertTrue(
            check_rules.rules_overlap(
                ("domain", "api.example.com"),
                ("domain-suffix", "example.com"),
            )
        )

    def test_unrelated_domains_do_not_overlap(self):
        self.assertFalse(
            check_rules.rules_overlap(
                ("domain-suffix", "example.com"),
                ("domain-suffix", "example.org"),
            )
        )


if __name__ == "__main__":
    unittest.main()
