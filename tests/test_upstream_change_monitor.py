from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "qinglong"))

import upstream_change_monitor as monitor
from common import ConfigError


class UpstreamChangeMonitorSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.state_path = Path(self.temp_dir.name) / "state.json"
        self.quarantine_dir = Path(self.temp_dir.name) / "upstream_quarantine"
        self.quarantine_dir.mkdir(parents=True, exist_ok=True)
        self.sample_url = "https://raw.githubusercontent.com/ddgksf2013/Scripts/refs/heads/master/yanxuan_daily_sign.js"
        self.sample_source = monitor.UpstreamSource(
            id="yanxuan_daily_sign",
            name="网易严选每日签到",
            url=self.sample_url,
            enabled=True,
        )
        self.hash_v1 = hashlib.sha256(b"console.log('v1 initial');").hexdigest()
        self.hash_v2 = hashlib.sha256(b"console.log('v2 updated');").hexdigest()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_validate_source_id_prevents_path_traversal(self):
        self.assertEqual(monitor.validate_source_id("valid_id-123"), "valid_id-123")

        bad_ids = [
            "../evil",
            "../../etc/passwd",
            "sub/dir",
            "dir\\file",
            "id with spaces",
            "",
        ]
        for bad in bad_ids:
            with self.assertRaises(ConfigError):
                monitor.validate_source_id(bad)

    def test_validate_upstream_url_strictness(self):
        self.assertEqual(
            monitor.validate_upstream_url(self.sample_url), self.sample_url
        )

        # 拒绝 HTTP
        with self.assertRaises(ConfigError):
            monitor.validate_upstream_url(
                "http://raw.githubusercontent.com/test/repo/main/a.js"
            )

        # 拒绝携带凭据
        with self.assertRaises(ConfigError):
            monitor.validate_upstream_url(
                "https://user:pass@raw.githubusercontent.com/a.js"
            )

        # 拒绝携带查询参数 (防止 token 泄露)
        with self.assertRaises(ConfigError):
            monitor.validate_upstream_url(self.sample_url + "?token=secret123")

        # 拒绝非白名单域名
        with self.assertRaises(ConfigError):
            monitor.validate_upstream_url("https://malicious.org/script.js")

    def test_state_and_snapshot_file_permissions_0600(self):
        data = {"version": 1, "sources": {}}
        monitor.save_state(self.state_path, data)
        self.assertTrue(self.state_path.exists())
        mode = stat.S_IMODE(self.state_path.stat().st_mode)
        self.assertEqual(mode, 0o600)

        snap = monitor._save_snapshot(
            self.quarantine_dir, "yanxuan_daily_sign", self.hash_v1, b"content"
        )
        snap_mode = stat.S_IMODE(snap.stat().st_mode)
        self.assertEqual(snap_mode, 0o600)

    def test_corrupted_state_file_fails_closed_without_rebaselining(self):
        # 场景 A: 状态文件存在但 JSON 语法损坏，必须抛出异常阻断，禁止静默重新基线
        self.state_path.write_text("{malformed_json: true,", encoding="utf-8")
        with self.assertRaises(ConfigError) as ctx:
            monitor.load_state(self.state_path)
        self.assertIn("状态文件 JSON 解析损坏", str(ctx.exception))

        # 场景 B: 状态文件缺少有效的 sources 结构，必须抛出异常阻断
        self.state_path.write_text(
            '{"version": 1, "sources": "not_a_dict"}', encoding="utf-8"
        )
        with self.assertRaises(ConfigError) as ctx:
            monitor.load_state(self.state_path)
        self.assertIn("状态文件结构非法", str(ctx.exception))

    def test_fetch_upstream_content_size_limit(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        # 模拟超大分块响应
        mock_resp.iter_content.return_value = [b"A" * (1024 * 1024) for _ in range(6)]
        mock_session = MagicMock()
        mock_session.get.return_value = mock_resp

        with self.assertRaises(RuntimeError) as ctx:
            monitor.fetch_upstream_content(self.sample_url, session=mock_session)
        self.assertIn("超过安全上限", str(ctx.exception))

    def test_first_run_establishes_baseline_as_pending_without_self_approving(self):
        mock_notifier = MagicMock()
        state = {"version": 1, "sources": {}}

        mock_content = b"console.log('v1 initial');"
        with patch.object(
            monitor, "fetch_upstream_content", return_value=(mock_content, self.hash_v1)
        ):
            result = monitor.check_source(
                self.sample_source,
                state,
                self.quarantine_dir,
                notifier=mock_notifier,
            )

        self.assertEqual(result.status, "BASELINE_ESTABLISHED")
        self.assertFalse(result.changed)
        self.assertFalse(result.notified)
        mock_notifier.send.assert_not_called()

        rec = state["sources"]["yanxuan_daily_sign"]
        # 安全核心检查：首次基线必须待审，reviewed_hash 绝不能等于当前哈希
        self.assertTrue(rec["pending_review"])
        self.assertEqual(rec["reviewed_hash"], "")
        self.assertEqual(rec["latest_hash"], self.hash_v1)
        self.assertEqual(rec["baseline_hash"], self.hash_v1)

        # 验证 get_pending_sources 能够发现首次未审阅的基线
        monitor.save_state(self.state_path, state)
        pending = monitor.get_pending_sources(self.state_path)
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["id"], "yanxuan_daily_sign")

    def test_approve_requires_exact_64char_latest_hash(self):
        state = {
            "version": 1,
            "sources": {
                "yanxuan_daily_sign": {
                    "id": "yanxuan_daily_sign",
                    "name": "网易严选每日签到",
                    "url": self.sample_url,
                    "status": "BASELINE_PENDING",
                    "pending_review": True,
                    "baseline_hash": self.hash_v1,
                    "reviewed_hash": "",
                    "latest_hash": self.hash_v1,
                    "last_notified_hash": self.hash_v1,
                }
            },
        }
        monitor.save_state(self.state_path, state)

        # 1. 传入空哈希或非 64 位哈希被拒绝
        with self.assertRaises(ValueError) as ctx:
            monitor.approve_source_version(
                "yanxuan_daily_sign", expected_hash="", state_path=self.state_path
            )
        self.assertIn("必须为完整的 64 位 SHA256", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            monitor.approve_source_version(
                "yanxuan_daily_sign",
                expected_hash="short_hash",
                state_path=self.state_path,
            )
        self.assertIn("必须为完整的 64 位 SHA256", str(ctx.exception))

        # 2. 传入不匹配的哈希被安全阻断
        wrong_hash = "0" * 64
        with self.assertRaises(ValueError) as ctx:
            monitor.approve_source_version(
                "yanxuan_daily_sign",
                expected_hash=wrong_hash,
                state_path=self.state_path,
            )
        self.assertIn("预期哈希与最新拉取哈希不一致，拒绝批准", str(ctx.exception))

        # 3. 传入精确匹配的最新哈希，批准成功
        approved = monitor.approve_source_version(
            "yanxuan_daily_sign",
            expected_hash=self.hash_v1,
            state_path=self.state_path,
            note="人工首审安全",
        )
        self.assertEqual(approved["status"], "REVIEWED")
        self.assertFalse(approved["pending_review"])
        self.assertEqual(approved["reviewed_hash"], self.hash_v1)

        # 批准后不再属于 pending
        pending = monitor.get_pending_sources(self.state_path)
        self.assertEqual(len(pending), 0)

    def test_upstream_change_triggers_bark_and_bark_failure_retries(self):
        # 已经过人工审阅通过的基线
        state = {
            "version": 1,
            "sources": {
                "yanxuan_daily_sign": {
                    "id": "yanxuan_daily_sign",
                    "name": "网易严选每日签到",
                    "url": self.sample_url,
                    "status": "REVIEWED",
                    "pending_review": False,
                    "baseline_hash": self.hash_v1,
                    "reviewed_hash": self.hash_v1,
                    "latest_hash": self.hash_v1,
                    "last_notified_hash": self.hash_v1,
                }
            },
        }

        # 场景 A: 上游变更，但 Bark 发送失败
        mock_notifier = MagicMock()
        mock_notifier.send.return_value = False

        with patch.object(
            monitor, "fetch_upstream_content", return_value=(b"v2", self.hash_v2)
        ):
            res_fail = monitor.check_source(
                self.sample_source, state, self.quarantine_dir, notifier=mock_notifier
            )

        self.assertEqual(res_fail.status, "CHANGED_NOTIFY_FAILED")
        self.assertTrue(res_fail.changed)
        self.assertFalse(res_fail.notified)
        rec = state["sources"]["yanxuan_daily_sign"]
        self.assertTrue(rec["pending_review"])
        # 安全断言：Bark 失败不能提前更新已通知哈希
        self.assertEqual(rec["last_notified_hash"], self.hash_v1)

        # 场景 B: 下次检查重试，Bark 发送成功
        mock_notifier.send.return_value = True
        with patch.object(
            monitor, "fetch_upstream_content", return_value=(b"v2", self.hash_v2)
        ):
            res_ok = monitor.check_source(
                self.sample_source, state, self.quarantine_dir, notifier=mock_notifier
            )

        self.assertEqual(res_ok.status, "CHANGED_AND_NOTIFIED")
        self.assertTrue(res_ok.changed)
        self.assertTrue(res_ok.notified)
        self.assertEqual(rec["last_notified_hash"], self.hash_v2)

        # 场景 C: 再次检查，已通知过，去重不再推送 Bark
        mock_notifier.reset_mock()
        with patch.object(
            monitor, "fetch_upstream_content", return_value=(b"v2", self.hash_v2)
        ):
            res_dedup = monitor.check_source(
                self.sample_source, state, self.quarantine_dir, notifier=mock_notifier
            )

        self.assertEqual(res_dedup.status, "PENDING_ALREADY_NOTIFIED")
        self.assertFalse(res_dedup.notified)
        mock_notifier.send.assert_not_called()

    def test_diff_generation_and_truncation(self):
        state = {
            "version": 1,
            "sources": {
                "yanxuan_daily_sign": {
                    "id": "yanxuan_daily_sign",
                    "name": "网易严选每日签到",
                    "url": self.sample_url,
                    "status": "PENDING_REVIEW",
                    "pending_review": True,
                    "reviewed_hash": self.hash_v1,
                    "latest_hash": self.hash_v2,
                }
            },
        }
        monitor.save_state(self.state_path, state)

        # 写入测试快照
        q_dir = monitor.get_quarantine_dir(self.state_path)
        (q_dir / f"yanxuan_daily_sign_{self.hash_v1[:12]}.snapshot").write_text(
            "line a\nline b\n", encoding="utf-8"
        )
        (q_dir / f"yanxuan_daily_sign_{self.hash_v2[:12]}.snapshot").write_text(
            "line a\nline b modified\n", encoding="utf-8"
        )

        diff = monitor.generate_diff_for_review("yanxuan_daily_sign", self.state_path)
        self.assertIn("-line b", diff)
        self.assertIn("+line b modified", diff)

    def test_run_monitor_end_to_end_with_disabled_source(self):
        state = {"version": 1, "sources": {}}
        monitor.save_state(self.state_path, state)
        disabled_source = monitor.UpstreamSource(
            id="disabled_src",
            name="禁用源",
            url=self.sample_url,
            enabled=False,
        )

        with (
            patch.object(
                monitor,
                "load_configured_sources",
                return_value=[disabled_source, self.sample_source],
            ),
            patch.object(
                monitor,
                "fetch_upstream_content",
                return_value=(b"content", self.hash_v1),
            ),
        ):
            ok = monitor.run_monitor(state_path=self.state_path, notifier=MagicMock())
            self.assertTrue(ok)

        # 检查 state：disabled_src 不应该被请求，只有 sample_source 建立了基线
        saved = monitor.load_state(self.state_path)
        self.assertNotIn("disabled_src", saved["sources"])
        self.assertIn("yanxuan_daily_sign", saved["sources"])
        self.assertTrue(saved["sources"]["yanxuan_daily_sign"]["pending_review"])

    def test_run_monitor_reports_failed_bark_delivery(self):
        state = {"version": 1, "sources": {}}
        with patch.object(
            monitor, "fetch_upstream_content", return_value=(b"old", self.hash_v1)
        ):
            monitor.check_source(self.sample_source, state, self.quarantine_dir)
        monitor.save_state(self.state_path, state)
        notifier = MagicMock()
        notifier.send.return_value = False
        with (
            patch.object(
                monitor, "load_configured_sources", return_value=[self.sample_source]
            ),
            patch.object(
                monitor, "fetch_upstream_content", return_value=(b"new", self.hash_v2)
            ),
        ):
            self.assertFalse(
                monitor.run_monitor(state_path=self.state_path, notifier=notifier)
            )
        self.assertEqual(
            monitor.load_state(self.state_path)["sources"][self.sample_source.id][
                "last_notified_hash"
            ],
            self.hash_v1,
        )

    def test_diff_truncation_on_large_diff(self):
        state = {
            "version": 1,
            "sources": {
                "large_src": {
                    "id": "large_src",
                    "name": "超大Diff源",
                    "url": self.sample_url,
                    "status": "PENDING_REVIEW",
                    "pending_review": True,
                    "reviewed_hash": self.hash_v1,
                    "latest_hash": self.hash_v2,
                }
            },
        }
        monitor.save_state(self.state_path, state)
        q_dir = monitor.get_quarantine_dir(self.state_path)

        old_lines = "\n".join(f"old line {i}" for i in range(1500)) + "\n"
        new_lines = "\n".join(f"new line {i}" for i in range(1500)) + "\n"
        (q_dir / f"large_src_{self.hash_v1[:12]}.snapshot").write_text(
            old_lines, encoding="utf-8"
        )
        (q_dir / f"large_src_{self.hash_v2[:12]}.snapshot").write_text(
            new_lines, encoding="utf-8"
        )

        diff = monitor.generate_diff_for_review("large_src", self.state_path)
        self.assertIn("截断", diff)

    def test_load_configured_sources_rejects_empty(self):
        with patch.dict(
            os.environ,
            {"upstream_change_monitor": json.dumps({"sources": []})},
            clear=True,
        ):
            with self.assertRaises(ConfigError) as ctx:
                monitor.load_configured_sources()
            self.assertIn("未能解析到任何有效的上游监控源", str(ctx.exception))


class UpstreamChangeMonitorCLITests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.state_path = Path(self.temp_dir.name) / "state.json"
        self.hash_v1 = hashlib.sha256(b"console.log('cli test');").hexdigest()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_cli_list_pending_and_approve(self):
        state = {
            "version": 1,
            "sources": {
                "test_cli": {
                    "id": "test_cli",
                    "name": "CLI测试脚本",
                    "url": "https://raw.githubusercontent.com/test/repo/main/a.js",
                    "status": "BASELINE_PENDING",
                    "pending_review": True,
                    "baseline_hash": self.hash_v1,
                    "reviewed_hash": "",
                    "latest_hash": self.hash_v1,
                    "last_notified_hash": self.hash_v1,
                }
            },
        }
        monitor.save_state(self.state_path, state)

        # 1. 运行 --list-pending
        buf = io.StringIO()
        with (
            patch.dict(
                os.environ, {"UPSTREAM_MONITOR_STATE_FILE": str(self.state_path)}
            ),
            patch.object(sys, "argv", ["monitor", "--list-pending"]),
            contextlib.redirect_stdout(buf),
        ):
            code = monitor.main()
            self.assertEqual(code, 0)
            self.assertIn("CLI测试脚本", buf.getvalue())
            self.assertIn("BASELINE_PENDING", buf.getvalue())

        # 2. 运行 --approve 但漏传 --expected-hash 被阻断
        buf = io.StringIO()
        with (
            patch.dict(
                os.environ, {"UPSTREAM_MONITOR_STATE_FILE": str(self.state_path)}
            ),
            patch.object(sys, "argv", ["monitor", "--approve", "test_cli"]),
            contextlib.redirect_stdout(buf),
        ):
            code = monitor.main()
            self.assertEqual(code, 2)
            self.assertIn("--expected-hash", buf.getvalue())

        # 3. 运行 --approve 并传入正确的 --expected-hash
        buf = io.StringIO()
        with (
            patch.dict(
                os.environ, {"UPSTREAM_MONITOR_STATE_FILE": str(self.state_path)}
            ),
            patch.object(
                sys,
                "argv",
                [
                    "monitor",
                    "--approve",
                    "test_cli",
                    "--expected-hash",
                    self.hash_v1,
                    "--note",
                    "CLI测试通过",
                ],
            ),
            contextlib.redirect_stdout(buf),
        ):
            code = monitor.main()
            self.assertEqual(code, 0)
            self.assertIn("人工审核确认", buf.getvalue())

        # 验证已成功审阅
        st = monitor.load_state(self.state_path)
        self.assertEqual(st["sources"]["test_cli"]["status"], "REVIEWED")
        self.assertFalse(st["sources"]["test_cli"]["pending_review"])
        self.assertEqual(st["sources"]["test_cli"]["reviewed_hash"], self.hash_v1)


if __name__ == "__main__":
    unittest.main()
