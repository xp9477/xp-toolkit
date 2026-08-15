from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "qinglong"))

import dji_bbs
import hdl
import ycios


def make_response(*, payload=None, text: str = "", status_code: int = 200):
    response = Mock()
    response.status_code = status_code
    response.text = text
    response.json.return_value = payload
    return response


class DjiClientTests(unittest.TestCase):
    def setUp(self):
        self.script = dji_bbs.Script({"username": "tester", "cookie": "secret=1"})
        self.script.session = MagicMock()

    def test_request_has_timeout_tls_and_redirect_boundaries(self):
        response = make_response()
        self.script.session.request.return_value = response

        self.script._request("GET", "https://bbs.dji.com/")

        self.script.session.request.assert_called_once_with(
            "GET",
            "https://bbs.dji.com/",
            timeout=(10, 30),
            allow_redirects=False,
            verify=True,
        )
        response.raise_for_status.assert_called_once_with()

    def test_request_rejects_untrusted_url_and_cross_host_credentials(self):
        invalid_requests = (
            ("http://bbs.dji.com/", {}),
            ("https://bbs.dji.com.evil.example/", {}),
            ("https://user@bbs.dji.com/", {}),
            ("https://v1.jinrishici.com/all.txt", {"Cookie": "secret=1"}),
        )

        for url, headers in invalid_requests:
            with self.subTest(url=url), self.assertRaises(ValueError):
                self.script._request("GET", url, headers=headers)
        self.script.session.request.assert_not_called()

    def test_redirect_status_is_not_treated_as_success(self):
        self.script.session.request.return_value = make_response(status_code=302)

        with self.assertRaises(RuntimeError):
            self.script._request("GET", "https://bbs.dji.com/")

    def test_sign_business_failure_stops_followup_actions(self):
        homepage = make_response(text="已登录")
        sign_response = make_response(payload={"success": False}, text="{}")
        self.script.session.request.side_effect = [homepage, sign_response]

        self.assertIs(self.script.run(), False)
        self.assertEqual(self.script.session.request.call_count, 2)

    @patch("dji_bbs.time.sleep", return_value=None)
    def test_zero_balance_is_valid_when_all_business_steps_succeed(self, _sleep):
        def respond(_method, url, **_kwargs):
            if url == "https://bbs.dji.com/":
                return make_response(text="已登录")
            if "/paulsigns/sign" in url:
                return make_response(payload={"success": True, "increased": 2})
            if "/reply?" in url:
                return make_response(payload={"success": True})
            if url == "https://v1.jinrishici.com/all.txt":
                return make_response(text="山高水长")
            if "op=widthdraw" in url:
                return make_response(text="<span>未兑换：0分</span>")
            if "mod=dji_credit" in url:
                return make_response(payload={"data": {"dji_credit_rmb": 0}})
            return make_response(text="用户主页")

        self.script.session.request.side_effect = respond

        self.assertIs(self.script.run(), True)


class HdlClientTests(unittest.TestCase):
    def setUp(self):
        self.session = MagicMock()
        self.client = hdl.HdlClient("openid", "uid", session=self.session)

    def test_post_has_timeout_tls_and_redirect_boundaries(self):
        response = make_response(payload={"code": "ok"})
        self.session.post.return_value = response

        payload = self.client._post("/activity/test", {"value": 1})

        self.assertEqual(payload, {"code": "ok"})
        self.session.post.assert_called_once_with(
            "https://superapp-public.kiwa-tech.com/activity/test",
            headers=self.client.headers,
            json={"value": 1},
            timeout=(10, 30),
            allow_redirects=False,
            verify=True,
        )
        response.raise_for_status.assert_called_once_with()

    def test_post_rejects_absolute_or_scheme_relative_path(self):
        for path in ("https://evil.example/steal", "//evil.example/steal", "relative"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.client._post(path, {})
        self.session.post.assert_not_called()

    @patch("hdl.notify.send")
    def test_failed_login_is_false_and_stops_the_workflow(self, notify_send):
        self.client._post = MagicMock(
            return_value={"code": 100000, "data": {"token": ""}}
        )
        self.client.query = MagicMock()

        self.assertIs(self.client.run(), False)
        self.client.query.assert_not_called()
        notify_send.assert_called_once()

    def test_unknown_signin_failure_is_not_reported_as_already_signed(self):
        self.client._post = MagicMock(
            return_value={"code": "denied", "message": "已签到校验失败"}
        )

        self.assertIs(self.client.signin(), False)

    def test_bare_signin_label_is_not_already_signed_evidence(self):
        self.client._post = MagicMock(
            return_value={"code": "denied", "message": "签到"}
        )

        self.assertIs(self.client.signin(), False)

    def test_explicit_already_signed_response_is_idempotent_success(self):
        self.client._post = MagicMock(
            return_value={"code": "duplicate", "message": "今日已签到"}
        )

        self.assertIs(self.client.signin(), True)

    def test_success_code_without_reward_detail_fails_closed(self):
        self.client._post = MagicMock(
            return_value={"code": "ok", "data": {"signinQueryDetailList": []}}
        )

        self.assertIs(self.client.signin(), False)


class YciosClientTests(unittest.TestCase):
    def setUp(self):
        self.script = ycios.Script({"username": "tester", "password": "secret"})
        self.script.session = MagicMock()

    def test_request_has_timeout_tls_and_redirect_boundaries(self):
        response = make_response()
        self.script.session.request.return_value = response

        self.script._request("GET", "/users?tab=credit")

        self.script.session.request.assert_called_once_with(
            "GET",
            "https://iosyc.com/users?tab=credit",
            timeout=(10, 30),
            allow_redirects=False,
            verify=True,
        )
        response.raise_for_status.assert_called_once_with()

    def test_request_rejects_origin_override(self):
        for path in ("https://evil.example/steal", "//evil.example/steal", "relative"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.script._request("GET", path)
        self.script.session.request.assert_not_called()

    def test_missing_login_token_fails_explicitly(self):
        self.script._request = MagicMock(return_value=make_response(text="登录页"))

        with self.assertRaisesRegex(ValueError, "缺少 token"):
            self.script.get_token()

    def test_unknown_sign_response_fails_closed(self):
        self.script._request = MagicMock(
            return_value=make_response(
                payload={"status": 500, "msg": "签到成功条件不满足"}
            )
        )

        self.assertIs(self.script.daily_sign(), False)

    def test_bare_sign_label_and_malformed_status_fail_closed(self):
        for payload in (
            {"status": 409, "msg": "签到"},
            {"status": [], "success": {}, "msg": "未知"},
        ):
            with self.subTest(payload=payload):
                self.script._request = MagicMock(
                    return_value=make_response(payload=payload)
                )
                self.assertIs(self.script.daily_sign(), False)

    def test_explicit_already_signed_response_is_success(self):
        self.script._request = MagicMock(
            return_value=make_response(payload={"status": 409, "msg": "今日已签到"})
        )

        self.assertIs(self.script.daily_sign(), True)

    def test_sign_failure_stops_before_credit_lookup(self):
        self.script.get_token = MagicMock(return_value="token")
        self.script.login = MagicMock(return_value=True)
        self.script.daily_sign = MagicMock(return_value=False)
        self.script.get_user_info = MagicMock()

        self.assertIs(self.script.run(), False)
        self.script.get_user_info.assert_not_called()


if __name__ == "__main__":
    unittest.main()
