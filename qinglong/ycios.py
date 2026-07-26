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
    
    def get_token(self):
        """获取登录 token"""
        url = "https://iosyc.com/login?r=https%3A%2F%2Fiosyc.com%2F"
        resp = self.session.get(url)
        token = re.search(r'name="token" value="(.+)"', resp.text).group(1)
        return token
    
    def login(self, token):
        """登录"""
        url = "https://iosyc.com/wp-admin/admin-ajax.php"
        data = {
            'user_login': self.username,
            'password': self.password,
            'redirect': 'https://iosyc.com/',
            'action': 'userlogin_form',
            'token': token,
        }    
        resp = self.session.post(url, data=data)
        result = resp.json()
        print(result)
        return result.get('success') == "success"
    
    def daily_sign(self):
        """每日签到"""
        url = "https://iosyc.com/wp-admin/admin-ajax.php"
        data = {
            'action': 'daily_sign',
        }
        resp = self.session.post(url, data=data)
        result = resp.json()
        print(result)
        return result
    
    def get_user_info(self):
        """获取用户信息"""
        url = "https://iosyc.com/users?tab=credit"
        resp = self.session.get(url)
        credit = re.search(r'您目前可用积分： (.+)</div><div class="weixin', resp.text).group(1)
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
            self.daily_sign()
            
            # 获取用户信息
            self.get_user_info()
            
            return True
        except Exception as e:
            print(f"执行失败 - {user_info}, 错误: {e}")
            raise


def main() -> int:
    summary = run_account_scripts(__file__, Script, notify_module=notify)
    return summary.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
