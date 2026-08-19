from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "qinglong"))

import dji_bbs
import hdl
import ycios


def response(*, payload=None, text=""):
    result = Mock()
    result.text = text
    result.json.return_value = payload
    return result


class DjiTests(unittest.TestCase):
    def setUp(self):
        self.script = dji_bbs.Script({"username": "tester", "cookie": "secret=1"})
        self.script.session = MagicMock()

    def test_requests_have_a_timeout_and_check_http_status(self):
        reply = response()
        self.script.session.request.return_value = reply

        self.script._request("GET", "https://bbs.dji.com/")

        self.script.session.request.assert_called_once_with(
            "GET", "https://bbs.dji.com/", timeout=(10, 30)
        )
        reply.raise_for_status.assert_called_once_with()

    def test_sign_success_accepts_common_and_already_signed_shapes(self):
        self.assertTrue(self.script._confirmed_success({"success": True}))
        self.assertTrue(self.script._confirmed_success({"success": "true"}))
        self.assertTrue(self.script._confirmed_success({"success": "1"}))
        self.assertTrue(
            self.script._confirmed_success(
                {"success": False, "message": "今天已经签到过了"},
                allow_already=True,
            )
        )
        self.assertFalse(
            self.script._confirmed_success(
                {"success": False, "message": "签到校验失败"},
                allow_already=True,
            )
        )

    def test_sign_failure_stops_followup_actions(self):
        self.script.session.request.side_effect = [
            response(text="已登录"),
            response(payload={"success": False}, text="{}"),
        ]

        with self.assertRaisesRegex(RuntimeError, "签到失败"):
            self.script.run()
        self.assertEqual(self.script.session.request.call_count, 2)

    @patch("dji_bbs.time.sleep", return_value=None)
    def test_optional_zero_balance_does_not_fail_a_successful_run(self, _sleep):
        def respond(_method, url, **_kwargs):
            if url == "https://bbs.dji.com/":
                return response(text="已登录")
            if "/paulsigns/sign" in url:
                return response(payload={"success": True, "increased": 2})
            if "/reply?" in url:
                return response(payload={"success": True})
            if url == "https://v1.jinrishici.com/all.txt":
                return response(text="山高水长")
            if "op=widthdraw" in url:
                return response(text="<span>未兑换：0分</span>")
            if "mod=dji_credit" in url:
                return response(payload={"data": {"dji_credit_rmb": 0}})
            return response(text="用户主页")

        self.script.session.request.side_effect = respond
        self.assertTrue(self.script.run())

    def test_optional_balance_network_failure_is_ignored(self):
        self.script.session.request.side_effect = requests.ConnectionError("offline")

        self.script._show_balance({"Cookie": "secret=1"})

    def test_reply_csrf_is_optional_and_never_hardcoded(self):
        source = Path(dji_bbs.__file__).read_text(encoding="utf-8")

        self.assertNotIn("87be3a37-def6-4fb6-af73-aba16ff737ba", source)
        configured = dji_bbs.Script({"cookie": "secret=1", "csrf_token": "fresh-token"})
        self.assertEqual(configured.csrf_token, "fresh-token")

    @patch("dji_bbs.time.sleep", return_value=None)
    def test_reply_bonus_failure_does_not_undo_signin(self, _sleep):
        self.script._request = MagicMock(
            side_effect=[
                response(text="已登录"),
                response(payload={"success": True}),
                *[response(text="用户主页") for _ in range(10)],
                response(text="山高水长"),
                response(payload={"success": False, "message": "token expired"}),
                response(text="<span>未兑换：0分</span>"),
                response(payload={"data": {"dji_credit_rmb": 0}}),
            ]
        )

        self.assertTrue(self.script.run())


class HdlTests(unittest.TestCase):
    def setUp(self):
        self.session = MagicMock()
        self.client = hdl.HdlClient("openid", "uid", session=self.session)

    def test_requests_have_a_timeout_and_check_http_status(self):
        reply = response(payload={"code": "ok"})
        self.session.post.return_value = reply

        self.client._post("/activity/test", {})

        self.assertEqual(self.session.post.call_args.kwargs["timeout"], (10, 30))
        reply.raise_for_status.assert_called_once_with()

    @patch("hdl.notify.send")
    def test_failed_login_stops_the_workflow(self, _send):
        self.client._post = MagicMock(
            return_value={"code": 100000, "data": {"token": ""}}
        )
        self.client.query = MagicMock()

        self.assertFalse(self.client.run())
        self.client.query.assert_not_called()

    def test_success_does_not_require_optional_reward_details(self):
        self.client._post = MagicMock(
            return_value={"code": "ok", "data": {"signinQueryDetailList": []}}
        )
        self.assertTrue(self.client.signin())

    def test_explicit_already_signed_is_success(self):
        self.client._post = MagicMock(
            return_value={"code": "duplicate", "message": "今日已签到"}
        )
        self.assertTrue(self.client.signin())

    def test_optional_queries_do_not_fail_a_successful_signin(self):
        self.client.login = MagicMock(return_value=True)
        self.client.query = MagicMock(side_effect=requests.ConnectionError("offline"))
        self.client.signin = MagicMock(return_value=True)
        self.client.queryFragment = MagicMock(side_effect=ValueError("changed"))

        self.assertTrue(self.client.run())


class YciosTests(unittest.TestCase):
    def setUp(self):
        self.script = ycios.Script({"username": "tester", "password": "secret"})
        self.script.session = MagicMock()

    def test_requests_have_a_timeout_and_check_http_status(self):
        reply = response()
        self.script.session.request.return_value = reply

        self.script._request("GET", "/users?tab=credit")

        self.assertEqual(
            self.script.session.request.call_args.kwargs["timeout"], (10, 30)
        )
        reply.raise_for_status.assert_called_once_with()

    def test_missing_login_token_is_a_clear_failure(self):
        self.script._request = MagicMock(return_value=response(text="登录页"))
        with self.assertRaisesRegex(ValueError, "缺少 token"):
            self.script.get_token()

    def test_unknown_sign_response_fails(self):
        self.script._request = MagicMock(
            return_value=response(payload={"status": 500, "msg": "未知"})
        )
        self.assertFalse(self.script.daily_sign())

    def test_sign_failure_stops_before_optional_credit_lookup(self):
        self.script.get_token = MagicMock(return_value="token")
        self.script.login = MagicMock(return_value=True)
        self.script.daily_sign = MagicMock(return_value=False)
        self.script.get_user_info = MagicMock()

        self.assertFalse(self.script.run())
        self.script.get_user_info.assert_not_called()

    def test_optional_credit_network_failure_is_ignored(self):
        self.script.get_token = MagicMock(return_value="token")
        self.script.login = MagicMock(return_value=True)
        self.script.daily_sign = MagicMock(return_value=True)
        self.script.get_user_info = MagicMock(
            side_effect=requests.ConnectionError("offline")
        )

        self.assertTrue(self.script.run())


if __name__ == "__main__":
    unittest.main()
