"""
name: 大疆社区签到
cron: 0 0 * * *
description: 大疆社区每日签到

env:
- `dji_bbs`: 每行一个 JSON 对象，字段 `username`, `cookie`；需要回复奖励时可加 `csrf_token`
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
        self.csrf_token = str(account.get("csrf_token") or "").strip()
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
        error = payload.get("error")
        if isinstance(error, dict):
            for key in ("message", "msg", "errorMessage"):
                value = error.get(key)
                if isinstance(value, str) and value.strip():
                    return re.sub(r"\s+", " ", value).strip()[:160]
        elif isinstance(error, str) and error.strip():
            return re.sub(r"\s+", " ", error).strip()[:160]
        data = payload.get("data")
        if isinstance(data, dict):
            for key in ("message", "msg", "errorMessage"):
                value = data.get(key)
                if isinstance(value, str) and value.strip():
                    return re.sub(r"\s+", " ", value).strip()[:160]
        return ""

    @staticmethod
    def _payload_parts(payload: dict) -> list[dict]:
        """只遍历接口已知的四种封装，不递归搜索无关字段。"""
        if not isinstance(payload, dict):
            return []
        data = payload.get("data")
        parts = [payload, data, payload.get("item")]
        if isinstance(data, dict):
            parts.append(data.get("item"))
        return [part for part in parts if isinstance(part, dict)]

    @classmethod
    def _is_signed(cls, payload: dict) -> bool:
        if cls._has_explicit_error(payload):
            return False
        return any(
            str(part.get("signed")).strip().lower() in {"true", "1"}
            for part in cls._payload_parts(payload)
        )

    def _get_sign_status(self, headers: dict) -> bool:
        response = self._request(
            "GET",
            f"{DJI_ORIGIN}/api/v2/home/paulsigns/user?device=desktop",
            headers=headers,
        )
        payload = self._json_object(response, "查询签到状态")
        if self._has_explicit_error(payload):
            self._business_failure("查询签到状态", payload)
        values = [
            part["signed"] for part in self._payload_parts(payload) if "signed" in part
        ]
        if not values or any(
            str(value).strip().lower() not in {"true", "false", "1", "0"}
            for value in values
        ):
            raise ValueError("查询签到状态响应缺少有效 signed 字段")
        return self._is_signed(payload)

    @classmethod
    def _has_explicit_error(cls, payload: dict, *, allow_already=False) -> bool:
        parts = cls._payload_parts(payload)
        if not parts:
            return True
        for part in parts:
            if part.get("error"):
                return True
            if "code" in part and (
                isinstance(part["code"], bool)
                or str(part["code"]).strip() not in {"0", "200"}
            ):
                return True
            if "success" in part and str(part["success"]).strip().lower() in {
                "false",
                "failed",
                "error",
                "0",
            }:
                return True
        return False

    @classmethod
    def _confirmed_success(cls, payload: dict, *, allow_already=False) -> bool:
        if cls._has_explicit_error(payload):
            return False
        return cls._is_signed(payload) or any(
            str(part.get("success")).strip().lower() in {"true", "success", "ok", "1"}
            for part in cls._payload_parts(payload)
        )

    @classmethod
    def _business_failure(cls, operation: str, payload: dict):
        detail = cls._message(payload) or "服务未返回明确成功标记"
        raise RuntimeError(f"{operation}失败: {detail}")

    def _show_balance(self, headers: dict) -> None:
        try:
            credit_response = self._request(
                "GET",
                f"{DJI_ORIGIN}/home.php?mod=spacecp&ac=credit&op=widthdraw",
                headers=headers,
            )
            balance_response = self._request(
                "GET",
                f"{DJI_ORIGIN}/misc.php?mod=dji_credit",
                headers=headers,
            )
        except requests.RequestException as exc:
            print(f"积分余额读取失败（不影响签到）: {exc}")
            return

        credit = re.search(r"<span>未兑换：(\d+)分</span>", credit_response.text)
        try:
            balance = (
                balance_response.json().get("data", {}).get("dji_credit_rmb", "未找到")
            )
        except (AttributeError, ValueError):
            balance = "未找到"
        print(f"未兑换积分：{credit.group(1) if credit else '未找到'}")
        print(f"余额：{balance}")

    def run(self):
        """执行脚本逻辑"""
        user_info = f"用户: {self.username}" if self.username else "账号"
        print(f"开始执行脚本 - {user_info}")

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36",
            "Referer": "https://bbs.dji.com/",
            "Cookie": self.cookie,
        }

        # 首页之前先查询签到状态
        if self._get_sign_status(headers):
            print("已签到过了")
            return True

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
        if self._has_explicit_error(sign_payload):
            self._business_failure("签到", sign_payload)

        if not self._confirmed_success(sign_payload, allow_already=True):
            # 响应不明确时查询状态复核，signed=true才成功继续，否则明确失败；HTTP/JSON错误不得算成功。
            try:
                is_signed = self._get_sign_status(headers)
            except (requests.RequestException, ValueError) as exc:
                raise RuntimeError(f"签到状态复核失败: {exc}") from exc

            if not is_signed:
                self._business_failure("签到", sign_payload)
            print("签到成功（状态复核已确认）")
        else:
            sign_msg = self._message(sign_payload)
            if re.search(
                r"(?:今日|今天).{0,6}(?:已|已经).{0,4}签|已经签到|已签到|重复签到|签到过|今日已完成|already\s*signed",
                sign_msg,
                re.IGNORECASE,
            ):
                print("已签到过了")
            else:
                increased = sign_payload.get("increased")
                if increased is None and isinstance(sign_payload.get("data"), dict):
                    increased = sign_payload["data"].get("increased")
                if increased is None and isinstance(sign_payload.get("item"), dict):
                    increased = sign_payload["item"].get("increased")
                if (
                    increased is None
                    and isinstance(sign_payload.get("data"), dict)
                    and isinstance(sign_payload["data"].get("item"), dict)
                ):
                    increased = sign_payload["data"]["item"].get("increased")
                print(
                    f"签到成功；增长：{increased if increased is not None else '未知'}"
                )

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
        }
        if self.csrf_token:
            reply_headers["x-csrf-token"] = self.csrf_token
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

            try:
                r4 = self._request(
                    "POST",
                    reply_url,
                    headers=reply_headers,
                    json={"message": gushici_message},
                )
            except requests.RequestException as exc:
                print(f"回复奖励失败（不影响签到）: {exc}")
                break
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
                    detail = self._message(reply_payload) or "服务拒绝回复"
                    print(f"回复奖励失败（不影响签到）: {detail}")
                    break
            print(f"回复帖子成功: {i + 1}")
            time.sleep(1)

        # 积分和余额只用于展示，读取失败不否定前面已成功的签到。
        self._show_balance(headers)
        return True


def main() -> int:
    summary = run_account_scripts(__file__, Script, notify_module=notify)
    return summary.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
