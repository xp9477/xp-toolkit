from __future__ import annotations

import io
import json
import stat
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path

# 动态加载 proxy/capture/addon.py
ROOT = Path(__file__).resolve().parents[1]
ADDON_PATH = ROOT / "proxy" / "capture" / "addon.py"

import importlib.util

spec = importlib.util.spec_from_file_location("capture_addon", ADDON_PATH)
assert spec is not None and spec.loader is not None
capture_addon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture_addon)


def create_mock_flow(
    host: str = "act.you.163.com",
    path: str = "/act-attendance/task/list",
    method: str = "GET",
    headers: dict[str, str] | None = None,
    cookies: dict[str, str] | None = None,
):
    """构建用于测试的 mock flow 对象。"""
    hdrs = headers.copy() if headers else {}
    if cookies and "Cookie" not in hdrs and "cookie" not in hdrs:
        hdrs["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())

    req = types.SimpleNamespace(
        host=host,
        path=path,
        method=method,
        headers=hdrs,
        cookies=cookies or {},
    )
    return types.SimpleNamespace(id="flow-test-1", request=req)


class DomainMatchingTests(unittest.TestCase):
    """测试严格域名匹配与域名后缀伪造防御。"""

    def test_exact_domain_match_success(self):
        patterns = ["act.you.163.com"]
        self.assertTrue(capture_addon.is_domain_allowed("act.you.163.com", patterns))
        self.assertTrue(capture_addon.is_domain_allowed("ACT.YOU.163.COM", patterns))
        self.assertTrue(
            capture_addon.is_domain_allowed("act.you.163.com:443", patterns)
        )
        self.assertTrue(capture_addon.is_domain_allowed("act.you.163.com.", patterns))

    def test_domain_suffix_spoofing_blocked(self):
        patterns = ["act.you.163.com"]
        # 伪造前缀、中缀、后缀以及包含攻击必须全部拦截
        self.assertFalse(
            capture_addon.is_domain_allowed("fakeact.you.163.com", patterns)
        )
        self.assertFalse(
            capture_addon.is_domain_allowed("evil-act.you.163.com", patterns)
        )
        self.assertFalse(
            capture_addon.is_domain_allowed("act.you.163.com.evil.com", patterns)
        )
        self.assertFalse(capture_addon.is_domain_allowed("163.com", patterns))
        self.assertFalse(capture_addon.is_domain_allowed("you.163.com", patterns))
        self.assertFalse(
            capture_addon.is_domain_allowed("evil.com/act.you.163.com", patterns)
        )

    def test_wildcard_subdomain_match_and_anti_spoofing(self):
        patterns = ["*.163.com"]
        # 合法子域名命中
        self.assertTrue(capture_addon.is_domain_allowed("act.163.com", patterns))
        self.assertTrue(capture_addon.is_domain_allowed("sub.act.163.com", patterns))

        # 域名后缀伪造攻击必须拦截
        self.assertFalse(capture_addon.is_domain_allowed("evil163.com", patterns))
        self.assertFalse(capture_addon.is_domain_allowed("evil-163.com", patterns))
        self.assertFalse(
            capture_addon.is_domain_allowed("163.com.attacker.com", patterns)
        )
        # 根域名本身不满足 *.163.com 的子域名约束
        self.assertFalse(capture_addon.is_domain_allowed("163.com", patterns))


class PathMatchingTests(unittest.TestCase):
    """测试严格路径匹配与前缀伪造防御。"""

    def test_exact_path_match(self):
        patterns = ["/act-attendance/task/list"]
        self.assertTrue(
            capture_addon.is_path_allowed("/act-attendance/task/list", patterns)
        )
        self.assertTrue(
            capture_addon.is_path_allowed("/act-attendance/task/list/", patterns)
        )
        self.assertTrue(
            capture_addon.is_path_allowed(
                "/act-attendance/task/list?token=secret&page=1#frag", patterns
            )
        )

    def test_path_prefix_spoofing_blocked(self):
        patterns = ["/act-attendance/task/list"]
        self.assertFalse(
            capture_addon.is_path_allowed("/act-attendance/task/list_evil", patterns)
        )
        self.assertFalse(
            capture_addon.is_path_allowed("/act-attendance/task/list-fake", patterns)
        )
        self.assertFalse(
            capture_addon.is_path_allowed("/act-attendance/task", patterns)
        )
        self.assertFalse(capture_addon.is_path_allowed("/other/path", patterns))

    def test_directory_wildcard_matching(self):
        patterns = ["/api/v1/*"]
        self.assertTrue(capture_addon.is_path_allowed("/api/v1", patterns))
        self.assertTrue(capture_addon.is_path_allowed("/api/v1/", patterns))
        self.assertTrue(capture_addon.is_path_allowed("/api/v1/user", patterns))
        self.assertTrue(capture_addon.is_path_allowed("/api/v1/user/info", patterns))
        self.assertFalse(capture_addon.is_path_allowed("/api/v1_evil", patterns))


class CaptureAddonExecutionTests(unittest.TestCase):
    """测试完整流程：匹配、白名单提取、截断限制、零明文落盘及权限。"""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_path = Path(self.temp_dir.name)
        self.config_file = self.temp_path / "config.json"
        self.output_file = self.temp_path / "records.enc"

        # 基础测试配置（默认严选示例）
        self.base_config = {
            "version": 1,
            "settings": {
                "output_file": str(self.output_file),
                "default_max_value_bytes": 1024,
                "default_max_record_bytes": 8192,
            },
            "projects": [
                {
                    "id": "yanxuan",
                    "name": "网易严选签到",
                    "enabled": True,
                    "domains": ["act.you.163.com"],
                    "paths": [
                        "/act-attendance/task/list",
                        "/act-attendance/att/v4/index",
                    ],
                    "methods": ["GET", "POST"],
                    "capture_headers": ["User-Agent", "X-Requested-With"],
                    "capture_cookies": ["yx_csrf", "yx_sid", "NTES_YD_SESS"],
                    "max_value_bytes": 20,
                    "max_record_bytes": 500,
                }
            ],
        }
        self.config_file.write_text(json.dumps(self.base_config), encoding="utf-8")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_unmatched_requests_pass_through_with_zero_capture(self):
        addon = capture_addon.CaptureAddon(
            config_path=self.config_file, output_file=self.output_file
        )

        # 1. 域名不匹配
        flow1 = create_mock_flow(host="evil.com", path="/act-attendance/task/list")
        addon.request(flow1)
        self.assertFalse(self.output_file.exists())

        # 2. 路径不匹配
        flow2 = create_mock_flow(host="act.you.163.com", path="/unauthorized/path")
        addon.request(flow2)
        self.assertFalse(self.output_file.exists())

        # 3. HTTP 方法不匹配
        flow3 = create_mock_flow(
            host="act.you.163.com",
            path="/act-attendance/task/list",
            method="DELETE",
        )
        addon.request(flow3)
        self.assertFalse(self.output_file.exists())

    def test_disabled_project_produces_zero_capture(self):
        self.base_config["projects"][0]["enabled"] = False
        self.config_file.write_text(json.dumps(self.base_config), encoding="utf-8")

        addon = capture_addon.CaptureAddon(
            config_path=self.config_file, output_file=self.output_file
        )
        flow = create_mock_flow(
            cookies={"yx_csrf": "csrf123", "yx_sid": "sid123"},
            headers={"User-Agent": "Loon"},
        )
        addon.request(flow)
        self.assertFalse(self.output_file.exists())

    def test_strict_whitelist_filtering(self):
        """测试仅提取白名单内的 header 与 cookie，丢弃一切非白名单字段。"""
        addon = capture_addon.CaptureAddon(
            config_path=self.config_file, output_file=self.output_file
        )

        flow = create_mock_flow(
            headers={
                "User-Agent": "LoonBrowser",
                "X-Requested-With": "com.netease.yanxuan",
                "Authorization": "Bearer super-secret-auth-token",
                "X-Untracked-Private-Header": "do-not-capture",
            },
            cookies={
                "yx_csrf": "csrf_val",
                "yx_sid": "sid_val",
                "untracked_auth_session": "session_secret_cookie",
                "random_cookie": "12345",
            },
        )
        addon.request(flow)

        self.assertTrue(self.output_file.exists())
        lines = self.output_file.read_text(encoding="utf-8").strip().splitlines()
        self.assertEqual(len(lines), 1)
        record = json.loads(lines[0])

        # 在无密钥模式下，元数据仅记录匹配的 key 名，绝无值明文
        self.assertEqual(
            record["matched_header_keys"], ["User-Agent", "X-Requested-With"]
        )
        self.assertEqual(record["matched_cookie_keys"], ["yx_csrf", "yx_sid"])
        # 验证非白名单字段完全不存在
        self.assertNotIn("Authorization", record["matched_header_keys"])
        self.assertNotIn("untracked_auth_session", record["matched_cookie_keys"])

    def test_zero_plaintext_on_disk_without_encryption_key(self):
        """未配置加密密钥时：绝对不落盘任何敏感凭据明文，仅保存脱敏元数据。"""
        addon = capture_addon.CaptureAddon(
            config_path=self.config_file,
            encryption_key=None,
            output_file=self.output_file,
        )

        secret_csrf = "csrf_secret_999"
        secret_sid = "sid_secret_888"
        flow = create_mock_flow(
            cookies={"yx_csrf": secret_csrf, "yx_sid": secret_sid},
            headers={"User-Agent": "Mozilla/5.0"},
        )
        addon.request(flow)

        raw_file_content = self.output_file.read_text(encoding="utf-8")
        # 核心断言：文件中绝不出现任何凭据明文！
        self.assertNotIn(secret_csrf, raw_file_content)
        self.assertNotIn(secret_sid, raw_file_content)

        record = json.loads(raw_file_content.strip())
        self.assertEqual(record["status"], "metadata_only_no_encryption_key")
        self.assertIn("value_lengths", record)
        self.assertEqual(record["value_lengths"]["yx_csrf"], len(secret_csrf))

    def test_encryption_mode_with_fernet_key(self):
        """配置有效密钥时：强加密落盘，零明文泄露，并可通过密钥正确解密。"""
        fernet_key = capture_addon.Fernet.generate_key().decode("ascii")
        addon = capture_addon.CaptureAddon(
            config_path=self.config_file,
            encryption_key=fernet_key,
            output_file=self.output_file,
        )

        secret_csrf = "csrf_secret_val"
        secret_sid = "sid_secret_val"
        flow = create_mock_flow(
            cookies={"yx_csrf": secret_csrf, "yx_sid": secret_sid},
            headers={"User-Agent": "LoonClient"},
        )
        addon.request(flow)

        raw_file_content = self.output_file.read_text(encoding="utf-8")
        # 绝无明文
        self.assertNotIn(secret_csrf, raw_file_content)
        self.assertNotIn(secret_sid, raw_file_content)

        record = json.loads(raw_file_content.strip())
        self.assertEqual(record["status"], "encrypted")
        self.assertEqual(record["algorithm"], "fernet")
        self.assertIn("ciphertext", record)

        # 离线解密验证
        encryptor = capture_addon.RecordEncryptor(fernet_key)
        decrypted_json = encryptor.decrypt(record["ciphertext"], record["algorithm"])
        decrypted_data = json.loads(decrypted_json)

        self.assertEqual(decrypted_data["cookies"]["yx_csrf"], secret_csrf)
        self.assertEqual(decrypted_data["cookies"]["yx_sid"], secret_sid)
        self.assertEqual(decrypted_data["headers"]["User-Agent"], "LoonClient")

    def test_file_and_directory_permissions(self):
        """确保捕获目录权限为 0700，文件权限为 0600（仅当前所有者可访问）。"""
        addon = capture_addon.CaptureAddon(
            config_path=self.config_file, output_file=self.output_file
        )
        flow = create_mock_flow(
            cookies={"yx_csrf": "csrf_val"},
            headers={"User-Agent": "Loon"},
        )
        addon.request(flow)

        self.assertTrue(self.output_file.exists())
        file_mode = stat.S_IMODE(self.output_file.stat().st_mode)
        self.assertEqual(file_mode, 0o600)

        dir_mode = stat.S_IMODE(self.output_file.parent.stat().st_mode)
        self.assertEqual(dir_mode, 0o700)

    def test_max_value_length_truncation(self):
        """测试字段超过 max_value_bytes 时的安全截断。"""
        addon = capture_addon.CaptureAddon(
            config_path=self.config_file, output_file=self.output_file
        )
        # 项目配置中 max_value_bytes 为 20
        long_ua = "A" * 100
        flow = create_mock_flow(
            cookies={"yx_csrf": "B" * 50},
            headers={"User-Agent": long_ua},
        )
        addon.request(flow)

        record = json.loads(self.output_file.read_text(encoding="utf-8").strip())
        self.assertEqual(record["value_lengths"]["User-Agent"], 20)
        self.assertEqual(record["value_lengths"]["yx_csrf"], 20)

    def test_zero_leak_to_stdout(self):
        """测试标准输出与控制台绝不包含任何敏感 Token 明文。"""
        addon = capture_addon.CaptureAddon(
            config_path=self.config_file, output_file=self.output_file
        )
        secret_value = "SUPER_SECRET_COOKIE_STRING_XYZ_12345"
        flow = create_mock_flow(
            cookies={"yx_csrf": secret_value},
            headers={"User-Agent": "Loon"},
        )

        captured_stdout = io.StringIO()
        old_stdout = sys.stdout
        try:
            sys.stdout = captured_stdout
            addon.request(flow)
        finally:
            sys.stdout = old_stdout

        printed = captured_stdout.getvalue()
        self.assertIn("捕获成功", printed)
        self.assertNotIn(secret_value, printed)

    def test_hot_reload_on_config_change(self):
        """测试修改配置文件后，插件自适应重新加载，无需重启。"""
        # 初始为禁用状态
        self.base_config["projects"][0]["enabled"] = False
        self.config_file.write_text(json.dumps(self.base_config), encoding="utf-8")

        addon = capture_addon.CaptureAddon(
            config_path=self.config_file, output_file=self.output_file
        )
        flow = create_mock_flow(
            cookies={"yx_csrf": "csrf123"},
            headers={"User-Agent": "Loon"},
        )
        addon.request(flow)
        self.assertFalse(self.output_file.exists())

        # 修改为启用状态，延时确保 mtime 改变
        time.sleep(0.05)
        self.base_config["projects"][0]["enabled"] = True
        self.config_file.write_text(json.dumps(self.base_config), encoding="utf-8")

        # 再次请求，自动热重载并成功捕获
        addon.request(flow)
        self.assertTrue(self.output_file.exists())


if __name__ == "__main__":
    unittest.main()
