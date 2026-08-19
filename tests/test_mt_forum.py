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


class FakeSession:
    def __init__(
        self,
        *,
        final_text: str,
        verify_text: str = "",
        first_error: Exception | None = None,
    ):
        self.headers = {}
        self.final_text = final_text
        self.first_error = first_error
        self.verify_text = verify_text
        self.get_count = 0

    def get(self, _url, **_kwargs):
        self.get_count += 1
        if self.get_count == 1:
            return FakeResponse(
                '<input name="formhash" value="login123">', error=self.first_error
            )
        if self.get_count == 2:
            return FakeResponse('<a href="?formhash=sign456">签到</a>')
        if self.get_count == 3:
            return FakeResponse(self.final_text)
        return FakeResponse(self.verify_text)

    def post(self, _url, **_kwargs):
        return FakeResponse("欢迎您回来")


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

    def test_http_failure_aborts_before_parsing_page(self):
        session = FakeSession(
            final_text="",
            first_error=requests.HTTPError("503 Service Unavailable"),
        )

        with self.assertRaisesRegex(RuntimeError, "访问登录页面失败"):
            make_script(session).run()
        self.assertEqual(session.get_count, 1)


if __name__ == "__main__":
    unittest.main()
