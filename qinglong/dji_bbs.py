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


class Script:
    """脚本基类"""
    
    def __init__(self, account):
        self.account = account
        self.username = account.get("username", "")
        self.cookie = account.get("cookie", "")
        require_fields(account, "cookie")
        self.session = requests.Session()
    
    def run(self):
        """执行脚本逻辑"""
        user_info = f"用户: {self.username}" if self.username else "账号"
        print(f"开始执行脚本 - {user_info}")
        
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36",
            "Referer": "https://bbs.dji.com/",
            "Cookie": self.cookie
        }
        
        # 请求1: 获取formhash (5分)
        r1 = self.session.get("https://bbs.dji.com/", headers=headers)
        if r1.status_code != 200:
            print(f"请求失败，状态码: {r1.status_code}")
            return False
        
        if "<span>登录</span>" in r1.text:
            print("未登录")
            return False
        
        formhash_match = re.search(r'name="formhash" value="(.+)"', r1.text)
        if formhash_match:
            formhash = formhash_match.group(1)
            print(f"获取formhash: {formhash}")
        
        # 请求2: 签到 (2分)
        headers2 = {
            "Origin": "https://bbs.dji.com",
            "Referer": "https://bbs.dji.com/",
            "User-Agent": headers["User-Agent"],
            "Cookie": self.cookie
        }
        r2 = self.session.post("https://bbs.dji.com/api/v2/home/paulsigns/sign?device=desktop", headers=headers2)
        if r2.status_code != 200:
            print(f"签到请求失败，状态码: {r2.status_code}")
            return False
        
        if "您需要先登录才能继续本操作" in r2.text:
            print("需要登录")
            return False
        
        success_match = re.search(r'"success":\s*(\w+)', r2.text)
        increased_match = re.search(r'"increased":\s*(\d+)', r2.text)
        
        success = success_match.group(1) if success_match else ""
        increased = increased_match.group(1) if increased_match else ""
        
        print(f"成功：{success}；增长：{increased}")

        # 请求3: 访问其他用户空间（5分）
        users = ['https://bbs.dji.com/home.php?mod=space&uid=3519856&uuid=c87fbae0f4172b',
        'https://bbs.dji.com/home.php?mod=space&uid=317315&uuid=c4b5f1b2ba659f',
        'https://bbs.dji.com/home.php?mod=space&uid=3842279&uuid=aaaf31767fd42a',
        'https://bbs.dji.com/home.php?mod=space&uid=2975279&uuid=02e60d8612e626',
        'https://bbs.dji.com/home.php?mod=space&uid=279428&uuid=3e7489af825b13',
        'https://bbs.dji.com/home.php?mod=space&uid=3842291&uuid=d1ffee822b658a',
        'https://bbs.dji.com/home.php?mod=space&uid=4103442&uuid=200e2ddd34d5e1',
        'https://bbs.dji.com/home.php?mod=space&uid=3381230&uuid=ae4154f6350358',
        'https://bbs.dji.com/home.php?mod=space&uid=2995942&uuid=6870d6df036241',
        'https://bbs.dji.com/home.php?mod=space&uid=9014160&uuid=631ab9b3a67842']

        for user in users:
            r3 = self.session.get(user, headers=headers)
            if r3.status_code != 200:
                print(f"访问用户主页失败，状态码: {r3.status_code}")
                return False
            print(f"访问用户主页成功: {user}")
            time.sleep(1)
                    
        # 请求4: 回复帖子（5 分）
        # 使用 session，高度还原curl请求
        reply_url = "https://bbs.dji.com/api/v2/forum/thread/341362/reply?device=desktop"
        reply_headers = {
            "accept": "application/json, text/plain, */*",
            "content-type": "application/json",
            "origin": "https://bbs.dji.com",
            "referer": "https://bbs.dji.com/pro/detail?mod=viewthread&tid=341362",
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            # 必须携带登录 Cookie，否则接口会返回 401 未授权
            "Cookie": self.cookie,
            "x-csrf-token": "87be3a37-def6-4fb6-af73-aba16ff737ba", # 动态获取更佳
        }
        # session的cookie是自动的，不用headers/cookie
        for i in range(5):
            # 获取古诗词文案并作为 message
            try:
                gushici_resp = self.session.get("https://v1.jinrishici.com/all.txt", timeout=5)
                if gushici_resp.status_code == 200:
                    gushici_message = gushici_resp.text.strip()
                else:
                    gushici_message = "."
            except Exception:
                gushici_message = "."

            r4 = self.session.post(
                reply_url,
                headers=reply_headers,
                json={"message": gushici_message},
            )
            if r4.status_code != 200:
                print(f"回复帖子失败，状态码: {r4.status_code}，响应内容: {r4.text}")
                return False
            print(f"回复帖子成功: {i+1}")
            time.sleep(1)

        # 请求 5：查看可兑换积分和余额
        r5 = self.session.get("https://bbs.dji.com/home.php?mod=spacecp&ac=credit&op=widthdraw", headers=headers)
        r6 = self.session.get("https://bbs.dji.com/misc.php?mod=dji_credit", headers=headers)
        if r5.status_code != 200 or r6.status_code != 200:
            print("查看可兑换积分和余额失败")
            return False
        credit = re.search(r'<span>未兑换：(\d+)分</span>', r5.text)
        balance = r6.json()['data']['dji_credit_rmb']
        print(f"未兑换积分：{credit.group(1) if credit else '未找到'}")
        print(f"余额：{str(balance) if balance else '未找到'}")
        if not balance:
            return False
        
        return True


def main() -> int:
    summary = run_account_scripts(__file__, Script, notify_module=notify)
    return summary.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
