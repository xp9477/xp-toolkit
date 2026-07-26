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


class HdlClient:
    def __init__(self, openId: str, uid: str):
        self.openId = openId
        self.uid = uid
        self.headers = {
            "content-type": "application/json",
            "appId": '15',
            "appVersion": "3.260.0",
            "Accept-Encoding": "gzip,compress,br,deflate",
            "Referer": "https://servicewechat.com/wx1ddeb67115f30d1a/239/page-frame.html",
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.59(0x18003b2a) NetType/WIFI Language/zh_CN",
        }

    def login(self):
        url = "https://superapp-public.kiwa-tech.com/api/gateway/login/center/login/wechatLogin"
        data = {
            "type": 1,
            "country": "CN",
            "codeType": 1,
            "business": "登录",
            "terminal": "会员小程序",
            "openId": self.openId,
            "uid": self.uid
            }
        response = requests.post(url, headers=self.headers, json=data)
        if response.json()['code'] == 100000:
            self.headers['_HAIDILAO_APP_TOKEN'] = response.json()['data']['token']
        else:
            print('账号已失效')
            notify.send('海底捞', '账号已失效')

    def query(self):
        url = "https://superapp-public.kiwa-tech.com/activity/wxapp/signin/query"
        data = {}
        response = requests.post(url, headers=self.headers, json=data)
        print('活动名称：', response.json()['data']['activityName'])

    def signin(self):
        url = "https://superapp-public.kiwa-tech.com/activity/wxapp/signin/signin"
        data = {
            "signinSource": "MiniApp"
        }
        response = requests.post(url, headers=self.headers, json=data)
        if response.json()['code'] == 'ok':
            print('签到成功')
            signinQueryDetailList = response.json()['data']['signinQueryDetailList']
            if len(signinQueryDetailList) > 0:
                print('碎片：', signinQueryDetailList[0]['fragment'], '额外奖励：', signinQueryDetailList[0]['fragmentSeries'], '菜品：', signinQueryDetailList[0]['dishes'])
            else:
                print('签到失败')
        else:
            print('已签到过了')

    def queryFragment(self):
        url = "https://superapp-public.kiwa-tech.com/activity/wxapp/signin/queryFragment"
        data = {}
        response = requests.post(url, headers=self.headers, json=data)
        total = response.json()['data']['total']
        expireDate = response.json()['data']['expireDate']
        print('碎片：', total, '活动结束时间：', expireDate) # 2025-06-01 23:59:59
        if (datetime.strptime(expireDate, "%Y-%m-%d %H:%M:%S") - datetime.now()).days <= 2:
            notify.send('海底捞碎片到期提醒', f'剩余{total}碎片将在2天内过期')

    def run(self):
        self.login()
        self.query()
        self.signin()
        self.queryFragment()


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
            print(f'\n账号 [{self.username}]')
        try:
            self.client.run()
            return True
        except Exception as e:
            print(f"执行失败: {e}")
            return False


def main() -> int:
    summary = run_account_scripts(__file__, Script, notify_module=notify)
    return summary.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
