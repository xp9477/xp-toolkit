"""
name: 大疆社区签到
cron: 0 0 * * *
description: 大疆社区每日签到

env:
- `dji_bbs`: 每行一个 JSON 对象，字段 `username`, `cookie`
"""

import re
import time

import notify
import requests
from common import require_fields, run_account_scripts

DJI_ORIGIN = "https://bbs.dji.com"
POETRY_ORIGIN = "https://v1.jinrishici.com"
REQUEST_TIMEOUT = (10, 30)


class Script:
    """脚本基类"""

    def __init__(self, account):
        self.account = account
        self.username = account.get("username", "")
        self.cookie = account.get("cookie", "")
        require_fields(account, "cookie")
        self.session = requests.Session()

    def _request(self, method: str, url: str, **kwargs):
        response = self.session.request(
            method,
            url,
            timeout=REQUEST_TIMEOUT,
            **kwargs,
        )
        response.raise_for_status()
        return response

    @staticmethod
    def _json_object(response, operation: str) -> dict:
        try:
            payload = response.json()
        except ValueError as exc:
            raise ValueError(f"{operation}响应不是有效 JSON") from exc
        if not isinstance(payload, dict):
            raise ValueError(f"{operation}响应格式异常")
        return payload

    @staticmethod
    def _message(payload: dict) -> str:
        for key in ("message", "msg", "errorMessage"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return re.sub(r"\s+", " ", value).strip()[:160]
        return ""

    @classmethod
    def _confirmed_success(cls, payload: dict, *, allow_already=False) -> bool:
        value = payload.get("success")
        succeeded = str(value).strip().lower() in {"true", "success", "ok", "1"}
        if succeeded:
            return True
        if not allow_already:
            return False
        message = cls._message(payload)
        return bool(
            re.search(
                r"(?:今日|今天).{0,4}(?:已|已经).{0,3}签|已经签到|已签到", message
            )
        )

    @classmethod
    def _business_failure(cls, operation: str, payload: dict):
        detail = cls._message(payload) or "服务未返回明确成功标记"
        raise RuntimeError(f"{operation}失败: {detail}")

    def run(self):
        """执行脚本逻辑"""
        user_info = f"用户: {self.username}" if self.username else "账号"
        print(f"开始执行脚本 - {user_info}")

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36",
            "Referer": "https://bbs.dji.com/",
            "Cookie": self.cookie,
        }

        # 请求1: 访问首页并确认登录状态 (5分)
        r1 = self._request("GET", f"{DJI_ORIGIN}/", headers=headers)

        if "<span>登录</span>" in r1.text:
            print("未登录")
            return False

        # 请求2: 签到 (2分)
        headers2 = {
            "Origin": "https://bbs.dji.com",
            "Referer": "https://bbs.dji.com/",
            "User-Agent": headers["User-Agent"],
            "Cookie": self.cookie,
        }
        r2 = self._request(
            "POST",
            f"{DJI_ORIGIN}/api/v2/home/paulsigns/sign?device=desktop",
            headers=headers2,
        )

        if "您需要先登录才能继续本操作" in r2.text:
            print("需要登录")
            return False

        sign_payload = self._json_object(r2, "签到")
        if not self._confirmed_success(sign_payload, allow_already=True):
            self._business_failure("签到", sign_payload)
        increased = sign_payload.get("increased")
        print(f"签到成功；增长：{increased if increased is not None else '未知'}")

        # 请求3: 访问其他用户空间（5分）
        users = [
            "https://bbs.dji.com/home.php?mod=space&uid=3519856&uuid=c87fbae0f4172b",
            "https://bbs.dji.com/home.php?mod=space&uid=317315&uuid=c4b5f1b2ba659f",
            "https://bbs.dji.com/home.php?mod=space&uid=3842279&uuid=aaaf31767fd42a",
            "https://bbs.dji.com/home.php?mod=space&uid=2975279&uuid=02e60d8612e626",
            "https://bbs.dji.com/home.php?mod=space&uid=279428&uuid=3e7489af825b13",
            "https://bbs.dji.com/home.php?mod=space&uid=3842291&uuid=d1ffee822b658a",
            "https://bbs.dji.com/home.php?mod=space&uid=4103442&uuid=200e2ddd34d5e1",
            "https://bbs.dji.com/home.php?mod=space&uid=3381230&uuid=ae4154f6350358",
            "https://bbs.dji.com/home.php?mod=space&uid=2995942&uuid=6870d6df036241",
            "https://bbs.dji.com/home.php?mod=space&uid=9014160&uuid=631ab9b3a67842",
        ]

        for user in users:
            self._request("GET", user, headers=headers)
            print(f"访问用户主页成功: {user}")
            time.sleep(1)

        # 请求4: 回复帖子（5 分）
        # 使用 session，高度还原curl请求
        reply_url = f"{DJI_ORIGIN}/api/v2/forum/thread/341362/reply?device=desktop"
        reply_headers = {
            "accept": "application/json, text/plain, */*",
            "content-type": "application/json",
            "origin": "https://bbs.dji.com",
            "referer": "https://bbs.dji.com/pro/detail?mod=viewthread&tid=341362",
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            # 必须携带登录 Cookie，否则接口会返回 401 未授权
            "Cookie": self.cookie,
            "x-csrf-token": "87be3a37-def6-4fb6-af73-aba16ff737ba",  # 动态获取更佳
        }
        # session的cookie是自动的，不用headers/cookie
        for i in range(5):
            # 获取古诗词文案并作为 message
            try:
                gushici_resp = self._request(
                    "GET",
                    f"{POETRY_ORIGIN}/all.txt",
                )
                gushici_message = gushici_resp.text.strip() or "."
            except (requests.RequestException, RuntimeError, ValueError):
                gushici_message = "."

            r4 = self._request(
                "POST",
                reply_url,
                headers=reply_headers,
                json={"message": gushici_message},
            )
            # 不同版本的回复接口成功响应结构不同；只拒绝明确的失败标记。
            try:
                reply_payload = r4.json()
            except ValueError:
                reply_payload = None
            if isinstance(reply_payload, dict):
                reply_success = reply_payload.get("success")
                if reply_success is False or str(reply_success).strip().lower() in {
                    "false",
                    "failed",
                    "error",
                    "0",
                }:
                    self._business_failure(f"第 {i + 1} 次回复", reply_payload)
            print(f"回复帖子成功: {i + 1}")
            time.sleep(1)

        # 请求 5：查看可兑换积分和余额
        r5 = self._request(
            "GET",
            f"{DJI_ORIGIN}/home.php?mod=spacecp&ac=credit&op=widthdraw",
            headers=headers,
        )
        r6 = self._request(
            "GET",
            f"{DJI_ORIGIN}/misc.php?mod=dji_credit",
            headers=headers,
        )
        credit = re.search(r"<span>未兑换：(\d+)分</span>", r5.text)
        try:
            balance = r6.json().get("data", {}).get("dji_credit_rmb", "未找到")
        except (AttributeError, ValueError):
            balance = "未找到"
        print(f"未兑换积分：{credit.group(1) if credit else '未找到'}")
        print(f"余额：{balance}")
        return True


def main() -> int:
    summary = run_account_scripts(__file__, Script, notify_module=notify)
    return summary.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
