from __future__ import annotations

import sys
import unittest
from pathlib import Path

import requests

QINGLONG_DIR = Path(__file__).resolve().parents[1] / "qinglong"
if str(QINGLONG_DIR) not in sys.path:
    sys.path.insert(0, str(QINGLONG_DIR))

import mt_forum


class FakeResponse:
    def __init__(self, text: str, *, error: Exception | None = None):
        self.text = text
        self.error = error
        self.encoding = None

    def raise_for_status(self):
        if self.error:
            raise self.error


class FakeCookies:
    def __init__(self):
        self.values: dict[str, str] = {}

    def set(self, name: str, value: str, **_kwargs):
        self.values[name] = value


class FakeSession:
    def __init__(
        self,
        *,
        final_text: str,
        verify_text: str = "",
        first_error: Exception | None = None,
        login_text: str = "欢迎您回来",
        first_text: str = '<input name="formhash" value="login123">',
    ):
        self.headers = {}
        self.cookies = FakeCookies()
        self.final_text = final_text
        self.first_error = first_error
        self.verify_text = verify_text
        self.login_text = login_text
        self.first_text = first_text
        self.get_count = 0
        self.posted_url = ""

    def get(self, url, **kwargs):
        self.get_count += 1
        if self.get_count == 1:
            return FakeResponse(self.first_text, error=self.first_error)
        params = kwargs.get("params") or {}
        if "operation=qiandao" in str(url) or params.get("operation") == "qiandao":
            return FakeResponse(self.final_text)
        if "k_misign:sign" in str(url):
            if self.get_count <= 2:
                return FakeResponse('<a href="?formhash=sign456">签到</a>')
            return FakeResponse(self.verify_text)
        if self.get_count == 2:
            return FakeResponse('<a href="?formhash=sign456">签到</a>')
        if self.get_count == 3:
            return FakeResponse(self.final_text)
        return FakeResponse(self.verify_text)

    def post(self, url, **_kwargs):
        self.posted_url = url
        return FakeResponse(self.login_text)


def make_script(session: FakeSession) -> mt_forum.Script:
    script = mt_forum.Script({"username": "tester", "password": "secret"})
    script.session = session
    return script


class MtForumResponseTests(unittest.TestCase):
    def test_generic_cdata_error_is_not_reported_as_success(self):
        session = FakeSession(final_text="<![CDATA[系统繁忙，请稍后再试]]>")

        with self.assertRaisesRegex(RuntimeError, "签到失败"):
            make_script(session).run()

    def test_ambiguous_ajax_result_can_be_confirmed_by_signed_page(self):
        session = FakeSession(
            final_text="<![CDATA[恭喜获得随机奖励]]>",
            verify_text="今日已签，您的签到排名 10",
        )

        self.assertTrue(make_script(session).run())

    def test_explicit_sign_success_is_accepted(self):
        session = FakeSession(final_text="<![CDATA[签到成功，获得奖励]]>")

        self.assertTrue(make_script(session).run())

    def test_changed_login_success_copy_does_not_cause_a_false_failure(self):
        session = FakeSession(final_text="<![CDATA[签到成功]]>", login_text="跳转中")

        self.assertTrue(make_script(session).run())

    def test_explicit_password_error_still_stops_before_signing(self):
        session = FakeSession(final_text="", login_text="密码错误")

        with self.assertRaisesRegex(RuntimeError, "登录失败"):
            make_script(session).run()
        self.assertEqual(session.get_count, 1)

    def test_http_failure_aborts_before_parsing_page(self):
        session = FakeSession(
            final_text="",
            first_error=requests.HTTPError("503 Service Unavailable"),
        )

        with self.assertRaisesRegex(RuntimeError, "访问登录页面失败"):
            make_script(session).run()
        self.assertEqual(session.get_count, 1)

    def test_busy_response_retries_and_succeeds(self):
        class RetrySuccessSession(FakeSession):
            def __init__(self):
                super().__init__(final_text="")
                self.sign_attempts = 0

            def get(self, url, **kwargs):
                self.get_count += 1
                if self.get_count == 1:
                    return FakeResponse(self.first_text)
                params = kwargs.get("params") or {}
                if (
                    "operation=qiandao" in str(url)
                    or params.get("operation") == "qiandao"
                ):
                    self.sign_attempts += 1
                    if self.sign_attempts == 1:
                        return FakeResponse("<![CDATA[请稍后再试]]>")
                    return FakeResponse("<![CDATA[签到成功]]>")
                if "k_misign:sign" in str(url):
                    if self.sign_attempts == 0:
                        return FakeResponse('<a href="?formhash=sign456">签到</a>')
                    return FakeResponse("")
                return FakeResponse("")

        session = RetrySuccessSession()
        self.assertTrue(make_script(session).run())
        self.assertEqual(session.sign_attempts, 2)

    def test_aliyun_esa_challenge_is_solved_before_reading_formhash(self):
        challenge = (
            Path(__file__).resolve().parent / "fixtures" / "mt_acw_challenge.html"
        ).read_text(encoding="utf-8")
        login_page = (
            '<form action="member.php?mod=logging&amp;action=login'
            '&amp;loginsubmit=yes&amp;loginhash=Lm37s">'
            '<input name="formhash" value="login123">'
            "</form>"
        )

        class ChallengeSession:
            def __init__(self):
                self.headers: dict[str, str] = {}
                self.cookies = FakeCookies()
                self.posted_url = ""
                self.login_gets = 0

            def get(self, url, **kwargs):
                params = kwargs.get("params") or {}
                if params.get("operation") == "qiandao":
                    return FakeResponse("<![CDATA[签到成功]]>")
                if "action=login" in str(url):
                    self.login_gets += 1
                    if self.login_gets == 1:
                        return FakeResponse(challenge)
                    return FakeResponse(login_page)
                if "k_misign:sign" in str(url):
                    return FakeResponse('<a href="?formhash=sign456">签到</a>')
                return FakeResponse("")

            def post(self, url, **_kwargs):
                self.posted_url = url
                return FakeResponse("欢迎您回来")

        session = ChallengeSession()
        script = mt_forum.Script({"username": "tester", "password": "secret"})
        script.session = session

        self.assertTrue(script.run())
        self.assertEqual(session.login_gets, 2)
        self.assertEqual(
            session.cookies.values["acw_sc__v2"],
            "6ad358d0eb2e4faa6817a74b413d27a52fd3bdf4",
        )
        self.assertIn("loginhash=Lm37s", session.posted_url)

    def test_acw_cookie_matches_captured_challenge(self):
        challenge = (
            Path(__file__).resolve().parent / "fixtures" / "mt_acw_challenge.html"
        ).read_text(encoding="utf-8")
        self.assertEqual(
            mt_forum.acw_sc_v2_cookie(challenge),
            "6ad358d0eb2e4faa6817a74b413d27a52fd3bdf4",
        )


if __name__ == "__main__":
    unittest.main()
