"""
name: 薇诺娜
cron: 10 0 * * *
description: 薇诺娜专柜商城签到与种树任务

env:
- `wnn`: 每行一个 JSON 对象，字段 `username`, `appUserToken`
"""

import asyncio
import json

import aiohttp
import notify
from common import require_fields, run_async_account_scripts


async def delay() -> None:
    await asyncio.sleep(7)


class Client:
    def __init__(self, username: str, app_user_token: str):
        self.username = username
        self.app_user_token = app_user_token.strip()
        self.base_url = "https://api.qiumeiapp.com/zg-activity/zg-daily/"
        self.session: aiohttp.ClientSession | None = None
        self.headers = {
            "Host": "api.qiumeiapp.com",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept-Encoding": "gzip, deflate, br",
            "User-Agent": (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 "
                "MicroMessenger/8.0.56(0x18003830) NetType/WIFI Language/zh_CN"
            ),
            "Referer": "https://servicewechat.com/wx250394ab3f680bfa/637/page-frame.html",
            "Connection": "keep-alive",
        }
        self.share_code = "818012ba"

    async def _request(self, endpoint: str, data: str | None = None) -> dict:
        if self.session is None:
            raise RuntimeError("HTTP 会话尚未初始化")

        try:
            url = self.base_url + endpoint
            post_data = data or f"appUserToken={self.app_user_token}"
            async with self.session.post(url, data=post_data, headers=self.headers) as response:
                response.raise_for_status()
                return await response.json()
        except Exception as exc:
            print(f"请求异常: {exc}")
            return {}

    async def checkin(self) -> bool:
        result = await self._request("zgSigninNew")
        if not result:
            return False

        if result.get("code") == 703:
            print("今日已签到")
        elif result.get("code") == 200:
            print("签到成功")
        elif result.get("code") == 600:
            print("Token 失效，请重新获取")
            return False
        else:
            print(f"签到失败: {json.dumps(result, ensure_ascii=False)}")
        return True

    async def tree_checkin(self) -> None:
        result = await self._request("signinZgForest")
        if result.get("code") == 200:
            water = result.get("data", {}).get("waterGram", "")
            print(f"树木签到成功，获得 {water}g 水滴")
        else:
            print(f"树木签到失败: {json.dumps(result, ensure_ascii=False)}")

    async def assist(self) -> None:
        data = (
            f"appUserToken={self.app_user_token}&sysCode=zgxcx&isRegister=1"
            f"&userShareCode={self.share_code}"
        )
        await self._request("addZgForestInvite", data)

    async def browse_mall(self) -> None:
        data = f"appUserToken={self.app_user_token}&taskCode=2025001"
        result = await self._request("updateZgForestTask", data)
        if result.get("code") == 200:
            print("浏览商城任务完成")
        else:
            print(f"浏览商城失败: {json.dumps(result, ensure_ascii=False)}")

    async def read_article(self) -> None:
        data = f"appUserToken={self.app_user_token}&taskCode=2025002"
        result = await self._request("updateZgForestTask", data)
        if result.get("code") == 200:
            print("阅读文章任务完成")
        elif result.get("code") == 703:
            print("请勿频繁操作")
        else:
            print(f"阅读文章失败: {json.dumps(result, ensure_ascii=False)}")

    async def get_water_drops(self) -> int:
        result = await self._request("getZgForest")
        if result.get("code") == 200:
            water = result.get("data", {}).get("remainWaterGram", 0)
            print(f"当前水滴数量: {water}g")
            return int(water)

        print(f"获取水滴失败: {json.dumps(result, ensure_ascii=False)}")
        return 0

    async def water_tree(self) -> None:
        water = await self.get_water_drops()
        times = water // 10
        if times <= 0:
            print("水滴不足，无法浇水")
            return

        print(f"计划浇水 {times} 次")
        for index in range(1, times + 1):
            result = await self._request("wateringZgForest")
            if result.get("code") == 200:
                print(f"第 {index} 次浇水成功")
            else:
                print(f"浇水失败: {json.dumps(result, ensure_ascii=False)}")
            await delay()

    async def run(self) -> bool:
        self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30))
        try:
            if not await self.checkin():
                return False

            await delay()
            await self.tree_checkin()
            await delay()
            await self.assist()
            await delay()
            await self.browse_mall()
            await delay()
            await self.read_article()
            await delay()
            await self.water_tree()
            return True
        finally:
            await self.session.close()
            self.session = None


class Script:
    def __init__(self, account: dict):
        require_fields(account, "appUserToken")
        self.username = account.get("username", "未命名账号")
        self.client = Client(self.username, account["appUserToken"])

    async def run(self) -> bool:
        print(f"账号 [{self.username}]")
        return await self.client.run()


async def main() -> int:
    print("\n薇诺娜专柜商城\n")
    summary = await run_async_account_scripts(
        __file__,
        Script,
        notify_module=notify,
    )
    return summary.exit_code


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
