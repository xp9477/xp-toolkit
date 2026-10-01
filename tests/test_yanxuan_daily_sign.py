from __future__ import annotations

import io
import json
import os
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import requests

ROOT = Path(__file__).resolve().parents[1]
QINGLONG_DIR = ROOT / "qinglong"
if str(QINGLONG_DIR) not in sys.path:
    sys.path.insert(0, str(QINGLONG_DIR))

import common
import yanxuan_daily_sign as yx


def make_mock_response(
    status_code: int = 200,
    json_data: dict | None = None,
    headers: dict | None = None,
    cookies: dict | None = None,
    url: str = "https://act.you.163.com/act/test",
) -> Mock:
    resp = Mock(spec=requests.Response)
    resp.status_code = status_code
    resp.headers = headers or {}
    resp.cookies = cookies or {}
    resp.url = url
    if json_data is not None:
        resp.json.return_value = json_data
    else:
        resp.json.side_effect = ValueError("Invalid JSON")
    return resp


class YanxuanDailySignUnitTests(unittest.TestCase):
    def test_cookie_whitelist_filtering(self):
        # 字符串形式包含白名单和多余参数
        raw_cookie = (
            "unrelated_token=xxx; yx_csrf=mock_csrf; tracking_id=999; "
            "yx_new_sid=mock_new_sid; yx_sid=mock_sid; NTES_YD_SESS=mock_yd_sess; other=bad"
        )
        filtered = yx.parse_and_filter_cookies(raw_cookie)
        self.assertEqual(
            filtered,
            {
                "yx_csrf": "mock_csrf",
                "yx_new_sid": "mock_new_sid",
                "yx_sid": "mock_sid",
                "NTES_YD_SESS": "mock_yd_sess",
            },
        )
        # 序列化后不含任何未授权键
        header_str = yx.cookie_dict_to_header(filtered)
        self.assertNotIn("unrelated_token", header_str)
        self.assertNotIn("tracking_id", header_str)
        self.assertNotIn("other", header_str)
        self.assertIn("yx_csrf=mock_csrf", header_str)

        # 字典形式输入
        dict_cookie = {
            "yx_csrf": "mock_csrf_val",
            "forbidden": "mock_forbidden",
            "yx_sid": "mock_sid_val",
        }
        filtered_dict = yx.parse_and_filter_cookies(dict_cookie)
        self.assertEqual(
            filtered_dict,
            {"yx_csrf": "mock_csrf_val", "yx_sid": "mock_sid_val"},
        )

    def test_has_valid_login_state(self):
        self.assertTrue(yx.has_valid_login_state({"yx_csrf": "c", "yx_new_sid": "s"}))
        self.assertTrue(yx.has_valid_login_state({"yx_csrf": "c", "yx_sid": "s"}))
        self.assertTrue(
            yx.has_valid_login_state({"yx_csrf": "c", "NTES_YD_SESS": "sess"})
        )
        # 缺少 yx_csrf
        self.assertFalse(yx.has_valid_login_state({"yx_new_sid": "s"}))
        # 缺少会话 Cookie
        self.assertFalse(yx.has_valid_login_state({"yx_csrf": "c"}))
        # 空白
        self.assertFalse(yx.has_valid_login_state({}))

    def test_safe_business_code_sanitization(self):
        self.assertEqual(yx.safe_business_code(200), "200")
        self.assertEqual(yx.safe_business_code(1009), "1009")
        self.assertEqual(yx.safe_business_code(0), "0")
        self.assertEqual(yx.safe_business_code("200"), "200")
        self.assertEqual(yx.safe_business_code("1009"), "1009")

        # 防 bool 误判与敏感串
        self.assertEqual(yx.safe_business_code(True), "未知")
        self.assertEqual(yx.safe_business_code(False), "未知")
        self.assertEqual(yx.safe_business_code("500\ncsrf_token=leak"), "未知")
        self.assertEqual(yx.safe_business_code("<script>alert(1)</script>"), "未知")
        self.assertEqual(yx.safe_business_code("1234567"), "未知")
        self.assertEqual(yx.safe_business_code(-1), "未知")
        self.assertEqual(yx.safe_business_code(1000000), "未知")
        self.assertEqual(yx.safe_business_code(None), "未知")

    def test_safe_points_and_status(self):
        # 正常积分
        self.assertEqual(yx.safe_points(100), 100)
        self.assertEqual(yx.safe_points("250"), 250)
        self.assertEqual(yx.safe_points(0), 0)

        # 防 bool 误判
        self.assertIsNone(yx.safe_points(True))
        self.assertIsNone(yx.safe_points(False))
        # 负数与超大数值
        self.assertIsNone(yx.safe_points(-5))
        self.assertIsNone(yx.safe_points(100_000_001))
        self.assertIsNone(yx.safe_points("abc"))
        self.assertIsNone(yx.safe_points(None))

        # safe_status
        self.assertEqual(yx.safe_status(1), 1)
        self.assertEqual(yx.safe_status("0"), 0)
        self.assertIsNone(yx.safe_status(True))
        self.assertIsNone(yx.safe_status(False))
        self.assertIsNone(yx.safe_status(2))
        self.assertIsNone(yx.safe_status(-1))

    def test_account_display_name_strictly_hardcoded_to_safe_alias(self):
        # 无论输入包含任何 name、username、phone 或 cookie，统一强制为 "严选账号"
        acc1 = {
            "cookie": "yx_csrf=mock_c; yx_sid=mock_s",
            "phone": "13800138000",
            "username": "secret_user",
            "name": "secret_name",
        }
        script1 = yx.Script(acc1)
        self.assertEqual(script1.display_name, "严选账号")

        acc2 = {
            "cookie": "yx_csrf=mock_c; yx_sid=mock_s",
            "name": "任意别名",
        }
        script2 = yx.Script(acc2)
        self.assertEqual(script2.display_name, "严选账号")

    def test_env_desensitization_clears_sensitive_fields_completely(self):
        env_val = json.dumps(
            [
                {
                    "cookie": "yx_csrf=mock_c; yx_sid=mock_s",
                    "phone": "13912345678",
                    "username": "sensitive_user",
                    "uid": "123456",
                    "name": "sensitive_name",
                }
            ]
        )
        with patch.dict(os.environ, {"yanxuan_daily_sign": env_val}):
            yx._desensitize_env_accounts()
            new_env = json.loads(os.environ["yanxuan_daily_sign"])
            self.assertNotIn("phone", new_env[0])
            self.assertNotIn("uid", new_env[0])
            self.assertNotIn("username", new_env[0])
            self.assertEqual(new_env[0]["name"], "严选账号")
            # 确认 common.account_display_name 取用后严格得到安全名称
            self.assertEqual(common.account_display_name(new_env[0], 1), "严选账号")

    def test_missing_login_state_returns_false_and_no_exception(self):
        acc = {"cookie": "yx_csrf=mock_c"}
        script = yx.Script(acc)
        out = io.StringIO()
        with redirect_stdout(out):
            success = script.run()
        self.assertFalse(success)
        self.assertIn("登录态缺失", script.last_error)
        self.assertNotIn("mock_c", out.getvalue())

    def test_session_network_privacy_and_safe_get(self):
        acc = {"cookie": "yx_csrf=mock_c; yx_sid=mock_s"}
        script = yx.Script(acc)
        # 验证默认网络隐私配置
        self.assertFalse(script.session.trust_env)
        self.assertEqual(script.session.max_redirects, 0)
        self.assertEqual(len(script.session.cookies), 0)

        script.session = MagicMock()
        script.session.get.return_value = make_mock_response(status_code=200)

        script._safe_get("/act/test", params={"k": "v"})
        args, kwargs = script.session.get.call_args
        self.assertEqual(args[0], "https://act.you.163.com/act/test")
        self.assertFalse(kwargs["allow_redirects"])
        self.assertIn("Cookie", kwargs["headers"])

    def test_set_cookie_in_memory_update_only(self):
        acc = {"cookie": "yx_csrf=old_csrf; yx_sid=old_sid"}
        script = yx.Script(acc)
        script.session = MagicMock()

        init_resp = make_mock_response(
            status_code=200,
            headers={
                "Set-Cookie": "yx_csrf=new_csrf_999; path=/; HttpOnly, yx_new_sid=new_sid_888; path=/"
            },
            url="https://act.you.163.com/act/forward/xhr/act/init",
        )
        script.session.get.return_value = init_resp

        with patch.dict(os.environ, {"yanxuan_daily_sign": "original_env"}):
            script._safe_get("/act/forward/xhr/act/init")
            # 内存中成功更新
            self.assertEqual(script.cookies["yx_csrf"], "new_csrf_999")
            self.assertEqual(script.cookies["yx_new_sid"], "new_sid_888")
            self.assertEqual(script.cookies["yx_sid"], "old_sid")
            # 绝不回写环境变量
            self.assertEqual(os.environ["yanxuan_daily_sign"], "original_env")

    def test_set_cookie_ignored_for_non_origin_url(self):
        third_party_resp = make_mock_response(
            status_code=200,
            headers={"Set-Cookie": "yx_csrf=bad_csrf; path=/"},
            url="https://attacker.example.com/evil",
        )
        updates = yx._extract_set_cookie_updates(third_party_resp)
        self.assertEqual(updates, {})

    @patch("yanxuan_daily_sign.safe_notify")
    def test_full_sign_success_with_point_increase(self, mock_notify):
        acc = {"cookie": "yx_csrf=mock_c; yx_sid=mock_s"}
        script = yx.Script(acc)

        init_resp = make_mock_response(200)
        index1_resp = make_mock_response(
            200,
            {
                "code": 200,
                "success": True,
                "data": {"points": 100, "sign": {"status": 0}},
            },
        )
        sign_resp = make_mock_response(
            200,
            {
                "code": 200,
                "success": True,
                "data": {"signPoint": 10},
            },
        )
        index2_resp = make_mock_response(
            200,
            {
                "code": 200,
                "success": True,
                "data": {"points": 110, "sign": {"status": 1}},
            },
        )

        script._safe_get = MagicMock(
            side_effect=[init_resp, index1_resp, sign_resp, index2_resp]
        )

        out = io.StringIO()
        with redirect_stdout(out):
            result = script.run()

        self.assertTrue(result)
        self.assertIn("签到成功：积分 +10，当前积分 110", out.getvalue())
        mock_notify.assert_called_once()
        notify_content = mock_notify.call_args[0][2]
        self.assertIn("积分 +10", notify_content)
        self.assertIn("110", notify_content)

    def test_points_increased_but_sign_success_false_fails(self):
        # 反例：签到接口返回失败，但复核积分变大，必须拒绝标记成功
        acc = {"cookie": "yx_csrf=mock_c; yx_sid=mock_s"}
        script = yx.Script(acc)

        init_resp = make_mock_response(200)
        index1_resp = make_mock_response(
            200,
            {
                "code": 200,
                "success": True,
                "data": {"points": 100, "sign": {"status": 0}},
            },
        )
        sign_resp = make_mock_response(
            200,
            {
                "code": 500,
                "success": False,
            },
        )
        index2_resp = make_mock_response(
            200,
            {
                "code": 200,
                "success": True,
                "data": {"points": 120, "sign": {"status": 1}},
            },
        )

        script._safe_get = MagicMock(
            side_effect=[init_resp, index1_resp, sign_resp, index2_resp]
        )

        out = io.StringIO()
        with redirect_stdout(out):
            result = script.run()

        self.assertFalse(result)
        self.assertIn("业务码: 500", script.last_error)

    def test_was_signed_initial_status_fails_if_sign_server_errors(self):
        # 反例：初始为已签到，但服务端签到返回异常码 500 (非 1009 已签到业务码)，应按业务失败处理
        acc = {"cookie": "yx_csrf=mock_c; yx_sid=mock_s"}
        script = yx.Script(acc)

        init_resp = make_mock_response(200)
        index1_resp = make_mock_response(
            200,
            {
                "code": 200,
                "success": True,
                "data": {"points": 100, "sign": {"status": 1}},
            },
        )
        sign_resp = make_mock_response(
            200,
            {
                "code": 500,
                "success": False,
            },
        )
        index2_resp = make_mock_response(
            200,
            {
                "code": 200,
                "success": True,
                "data": {"points": 100, "sign": {"status": 1}},
            },
        )

        script._safe_get = MagicMock(
            side_effect=[init_resp, index1_resp, sign_resp, index2_resp]
        )

        out = io.StringIO()
        with redirect_stdout(out):
            result = script.run()

        self.assertFalse(result)
        self.assertIn("业务码: 500", script.last_error)

    @patch("yanxuan_daily_sign.safe_notify")
    def test_already_signed_with_1009_succeeds_and_notifies_already_signed(
        self, mock_notify
    ):
        acc = {"cookie": "yx_csrf=mock_c; yx_sid=mock_s"}
        script = yx.Script(acc)

        init_resp = make_mock_response(200)
        index1_resp = make_mock_response(
            200,
            {
                "code": 200,
                "success": True,
                "data": {"points": 100, "sign": {"status": 1}},
            },
        )
        sign_resp = make_mock_response(
            200,
            {
                "code": 1009,
                "success": False,
            },
        )
        index2_resp = make_mock_response(
            200,
            {
                "code": 200,
                "success": True,
                "data": {"points": 100, "sign": {"status": 1}},
            },
        )

        script._safe_get = MagicMock(
            side_effect=[init_resp, index1_resp, sign_resp, index2_resp]
        )

        out = io.StringIO()
        with redirect_stdout(out):
            result = script.run()

        self.assertTrue(result)
        self.assertIn("今日已签到", out.getvalue())
        mock_notify.assert_called_once()
        notify_content = mock_notify.call_args[0][2]
        self.assertIn("今日已签到", notify_content)
        self.assertNotIn("签到成功", notify_content)

    def test_sign_business_failure_returns_false_and_no_individual_notify(self):
        # 业务失败时 Script.run() 自身不发通知（统一由 common 汇总通知），且脱敏业务码
        acc = {"cookie": "yx_csrf=mock_c; yx_sid=mock_s"}
        script = yx.Script(acc)

        init_resp = make_mock_response(200)
        index1_resp = make_mock_response(
            200,
            {
                "code": 200,
                "success": True,
                "data": {"points": 100, "sign": {"status": 0}},
            },
        )
        sign_resp = make_mock_response(
            200,
            {
                "code": "malicious\nline",
                "success": False,
            },
        )
        index2_resp = make_mock_response(
            200,
            {
                "code": 200,
                "success": True,
                "data": {"points": 100, "sign": {"status": 0}},
            },
        )

        script._safe_get = MagicMock(
            side_effect=[init_resp, index1_resp, sign_resp, index2_resp]
        )

        with patch("yanxuan_daily_sign.safe_notify") as mock_notify:
            out = io.StringIO()
            with redirect_stdout(out):
                result = script.run()

            self.assertFalse(result)
            self.assertEqual(script.last_error, "签到业务返回失败 (业务码: 未知)")
            self.assertNotIn("malicious", out.getvalue())
            mock_notify.assert_not_called()

    def test_points_not_increased_after_sign_returns_false(self):
        acc = {"cookie": "yx_csrf=mock_c; yx_sid=mock_s"}
        script = yx.Script(acc)

        init_resp = make_mock_response(200)
        index1_resp = make_mock_response(
            200,
            {
                "code": 200,
                "success": True,
                "data": {"points": 100, "sign": {"status": 0}},
            },
        )
        sign_resp = make_mock_response(
            200,
            {
                "code": 200,
                "success": True,
            },
        )
        index2_resp = make_mock_response(
            200,
            {
                "code": 200,
                "success": True,
                "data": {"points": 100, "sign": {"status": 0}},
            },
        )

        script._safe_get = MagicMock(
            side_effect=[init_resp, index1_resp, sign_resp, index2_resp]
        )

        out = io.StringIO()
        with redirect_stdout(out):
            result = script.run()

        self.assertFalse(result)
        self.assertEqual(script.last_error, "签到积分未确认增加")

    def test_requests_exception_swallowed_and_sanitized(self):
        acc = {"cookie": "yx_csrf=mock_csrf; yx_sid=mock_sid"}
        script = yx.Script(acc)

        leak_url = (
            "https://act.you.163.com/act-attendance/att/v4/index?csrf_token=mock_csrf"
        )
        script._safe_get = MagicMock(
            side_effect=requests.HTTPError(f"500 Server Error for url: {leak_url}")
        )

        out = io.StringIO()
        with redirect_stdout(out):
            result = script.run()

        self.assertFalse(result)
        self.assertEqual(script.last_error, "网络请求异常")
        self.assertNotIn("mock_csrf", out.getvalue())
        self.assertNotIn("mock_sid", out.getvalue())
        self.assertNotIn("url:", out.getvalue())


if __name__ == "__main__":
    unittest.main()
