"""
name: 海底捞
cron: 10 0 * * *
description: 海底捞小程序签到

env:
- `hdl`: 每行一个 JSON 对象，字段 `username`, `openId`, `uid`
"""

from datetime import datetime

import notify
import requests
from common import require_fields, run_account_scripts

API_ORIGIN = "https://superapp-public.kiwa-tech.com"
REQUEST_TIMEOUT = (10, 30)


class HdlClient:
    def __init__(self, openId: str, uid: str, session=None):
        self.openId = openId
        self.uid = uid
        self.session = session if session is not None else requests.Session()
        self.headers = {
            "content-type": "application/json",
            "appId": "15",
            "appVersion": "3.260.0",
            "Accept-Encoding": "gzip,compress,br,deflate",
            "Referer": "https://servicewechat.com/wx1ddeb67115f30d1a/239/page-frame.html",
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.59(0x18003b2a) NetType/WIFI Language/zh_CN",
        }

    def _post(self, path: str, data: dict) -> dict:
        response = self.session.post(
            f"{API_ORIGIN}{path}",
            headers=self.headers,
            json=data,
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        try:
            payload = response.json()
        except ValueError as exc:
            raise ValueError("海底捞服务响应不是有效 JSON") from exc
        if not isinstance(payload, dict):
            raise ValueError("海底捞服务响应格式异常")
        return payload

    @staticmethod
    def _message(payload: dict) -> str:
        for key in ("message", "msg", "errorMessage"):
            value = payload.get(key)
            if isinstance(value, str):
                return value
        return ""

    @classmethod
    def _is_already_signed(cls, payload: dict) -> bool:
        message = cls._message(payload).strip()
        return any(
            marker in message
            for marker in ("今日已签", "今天已签", "已经签到", "签到过了")
        )

    def login(self):
        data = {
            "type": 1,
            "country": "CN",
            "codeType": 1,
            "business": "登录",
            "terminal": "会员小程序",
            "openId": self.openId,
            "uid": self.uid,
        }
        payload = self._post(
            "/api/gateway/login/center/login/wechatLogin",
            data,
        )
        response_data = payload.get("data")
        token = response_data.get("token") if isinstance(response_data, dict) else None
        if (
            payload.get("code") != 100000
            or not isinstance(token, str)
            or not token.strip()
        ):
            print("登录业务响应未确认成功，账号可能已失效")
            notify.send("海底捞", "登录失败，账号可能已失效")
            return False
        self.headers["_HAIDILAO_APP_TOKEN"] = token
        return True

    def query(self):
        payload = self._post("/activity/wxapp/signin/query", {})
        response_data = payload.get("data")
        activity_name = (
            response_data.get("activityName")
            if isinstance(response_data, dict)
            else None
        )
        print("活动名称：", activity_name or "未知")
        return True

    def signin(self):
        data = {"signinSource": "MiniApp"}
        payload = self._post("/activity/wxapp/signin/signin", data)
        if payload.get("code") == "ok":
            print("签到成功")
            response_data = payload.get("data")
            detail_list = (
                response_data.get("signinQueryDetailList")
                if isinstance(response_data, dict)
                else None
            )
            if isinstance(detail_list, list) and detail_list:
                detail = detail_list[0]
                if isinstance(detail, dict):
                    print(
                        "碎片：",
                        detail.get("fragment", "未知"),
                        "额外奖励：",
                        detail.get("fragmentSeries", "未知"),
                        "菜品：",
                        detail.get("dishes", "未知"),
                    )
            return True

        if self._is_already_signed(payload):
            print("已签到过了")
            return True
        print("签到业务响应未确认成功")
        return False

    def queryFragment(self):
        payload = self._post("/activity/wxapp/signin/queryFragment", {})
        response_data = payload.get("data")
        if not isinstance(response_data, dict):
            print("碎片信息：未知")
            return True
        total = response_data.get("total", "未知")
        expire_date = response_data.get("expireDate", "")
        print("碎片：", total, "活动结束时间：", expire_date)
        if expire_date:
            try:
                expires_soon = (
                    datetime.strptime(expire_date, "%Y-%m-%d %H:%M:%S") - datetime.now()
                ).days <= 2
            except ValueError:
                expires_soon = False
            if expires_soon:
                notify.send("海底捞碎片到期提醒", f"剩余{total}碎片将在2天内过期")
        return True

    def run(self):
        if not self.login():
            return False
        try:
            self.query()
        except (requests.RequestException, ValueError) as exc:
            print(f"活动信息读取失败（继续签到）: {exc}")
        if not self.signin():
            return False
        try:
            self.queryFragment()
        except (requests.RequestException, ValueError) as exc:
            print(f"碎片信息读取失败（不影响签到）: {exc}")
        return True


class Script:
    """脚本类"""

    def __init__(self, account):
        self.account = account
        self.username = account.get("username", "")
        self.openId = account.get("openId", "")
        self.uid = account.get("uid", "")
        require_fields(account, "openId", "uid")
        self.client = HdlClient(openId=self.openId, uid=self.uid)

    def run(self):
        """执行脚本逻辑"""
        if self.username:
            print(f"\n账号 [{self.username}]")
        try:
            return self.client.run()
        except Exception as e:
            print(f"执行失败: {e}")
            return False


def main() -> int:
    summary = run_account_scripts(__file__, Script, notify_module=notify)
    return summary.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
