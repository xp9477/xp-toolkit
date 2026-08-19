"""
name: 雨辰 IOS 签到
cron: 0 0 * * *
description: 雨辰 IOS 每日签到

env:
- `ycios`: 每行一个 JSON 对象，字段 `username`, `password`
"""

import re

import notify
import requests
from common import require_fields, run_account_scripts

API_ORIGIN = "https://iosyc.com"
REQUEST_TIMEOUT = (10, 30)


class Script:
    """脚本基类"""

    def __init__(self, account):
        self.account = account
        self.username = account.get("username", "")
        self.password = account.get("password", "")
        require_fields(account, "username", "password")
        self.session = requests.Session()
        self.session.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
        }

    def _request(self, method: str, path: str, **kwargs):
        response = self.session.request(
            method,
            f"{API_ORIGIN}{path}",
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

    def get_token(self):
        """获取登录 token"""
        resp = self._request("GET", "/login?r=https%3A%2F%2Fiosyc.com%2F")
        token_match = re.search(r'name="token" value="([^"]+)"', resp.text)
        if not token_match:
            raise ValueError("登录页缺少 token，页面结构或登录流程可能已变化")
        return token_match.group(1)

    def login(self, token):
        """登录"""
        data = {
            "user_login": self.username,
            "password": self.password,
            "redirect": "https://iosyc.com/",
            "action": "userlogin_form",
            "token": token,
        }
        resp = self._request("POST", "/wp-admin/admin-ajax.php", data=data)
        result = self._json_object(resp, "登录")
        success = result.get("success") == "success"
        print("登录成功" if success else "登录业务响应未确认成功")
        return success

    def daily_sign(self):
        """每日签到"""
        data = {
            "action": "daily_sign",
        }
        resp = self._request("POST", "/wp-admin/admin-ajax.php", data=data)
        result = self._json_object(resp, "签到")

        success_value = result.get("success")
        status_value = result.get("status")
        message = next(
            (
                result[key]
                for key in ("message", "msg")
                if isinstance(result.get(key), str)
            ),
            "",
        )
        succeeded = (
            success_value is True
            or (isinstance(success_value, str) and success_value in {"success", "ok"})
            or (isinstance(status_value, int) and status_value == 1)
            or (
                isinstance(status_value, str) and status_value in {"1", "success", "ok"}
            )
        )
        already_signed = any(
            marker in message
            for marker in ("今日已签", "今天已签", "已经签到", "签到过了")
        )
        if not succeeded and not already_signed:
            print("签到业务响应未确认成功")
            return False
        print("签到成功" if succeeded else "今日已签到")
        return True

    def get_user_info(self):
        """获取用户信息"""
        resp = self._request("GET", "/users?tab=credit")
        credit_match = re.search(r"您目前可用积分：\s*([^<]+)", resp.text)
        if not credit_match:
            raise ValueError("积分页面缺少积分字段，页面结构或登录状态可能已变化")
        credit = credit_match.group(1).strip()
        print(f"积分：{credit}")
        return credit

    def run(self):
        """执行脚本逻辑"""
        user_info = f"用户: {self.username}" if self.username else "账号"
        print(f"开始执行脚本 - {user_info}")

        try:
            # 获取 token
            token = self.get_token()

            # 登录
            if not self.login(token):
                print(f"登录失败 - {user_info}")
                return False

            # 每日签到
            if not self.daily_sign():
                return False

            # 获取用户信息
            try:
                self.get_user_info()
            except ValueError as e:
                print(f"积分信息读取失败（不影响签到）: {e}")
            return True
        except Exception as e:
            print(f"执行失败 - {user_info}, 错误: {e}")
            raise


def main() -> int:
    summary = run_account_scripts(__file__, Script, notify_module=notify)
    return summary.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
