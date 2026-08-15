"""
name: MT论坛签到
cron: 0 8 * * *
description: MT论坛每日账号密码登录签到 (bbs.binmt.cc)

env:
- `mt_forum`: 每行一个 JSON 对象，字段包括 `username` 和 `password`
"""

from __future__ import annotations

import re

import notify
import requests
from common import require_fields, run_account_scripts


class Script:
    """MT论坛自动签到脚本（账号密码模式）。"""

    def __init__(self, account: dict):
        self.account = account
        self.username = account.get("username", "")
        self.password = account.get("password", "")
        require_fields(account, "username", "password")
        self.session = requests.Session()
        self.base_url = "https://bbs.binmt.cc"

    def run(self) -> bool:
        print(f"开始执行MT论坛签到 - 用户: {self.username}")

        self.session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": f"{self.base_url}/forum.php",
            }
        )

        # 1. 访问登录页面获取 pre-login formhash
        try:
            r1 = self.session.get(
                f"{self.base_url}/member.php?mod=logging&action=login", timeout=15
            )
            r1.encoding = "utf-8"
        except Exception as e:
            print(f"访问登录页面失败: {e}")
            return False

        formhash_match = re.search(r"formhash=([a-zA-Z0-9]+)", r1.text) or re.search(
            r'name="formhash"\s+value="([a-zA-Z0-9]+)"', r1.text
        )
        if not formhash_match:
            print("登录页面未找到 formhash")
            return False
        formhash = formhash_match.group(1)

        # 2. 提交登录表单
        payload = {
            "formhash": formhash,
            "referer": f"{self.base_url}/forum.php",
            "loginfield": "username",
            "username": self.username,
            "password": self.password,
            "questionid": "0",
            "answer": "",
            "cookietime": "2592000",
        }

        try:
            r2 = self.session.post(
                f"{self.base_url}/member.php?mod=logging&action=login&loginsubmit=yes&inajax=1",
                data=payload,
                timeout=15,
            )
            r2.encoding = "utf-8"
        except Exception as e:
            print(f"提交登录失败: {e}")
            return False

        # 验证是否登录成功
        if (
            "欢迎您回来" not in r2.text
            and "登录成功" not in r2.text
            and "现在将转入" not in r2.text
        ):
            cdata_match = re.search(r"<!\[CDATA\[(.*?)\]\]>", r2.text, re.DOTALL)
            msg_raw = cdata_match.group(1) if cdata_match else "未知原因"
            msg_no_html = re.sub(
                r"<script.*?>.*?</script>", "", msg_raw, flags=re.DOTALL
            )
            msg_no_html = re.sub(r"<.*?>", "", msg_no_html)
            login_lines = [
                line.strip()
                for line in msg_no_html.splitlines()
                if line.strip() and not line.strip().isdigit()
            ]
            msg = " | ".join(login_lines) if login_lines else "未知原因"
            print(f"登录失败: {msg}")
            return False

        print("登录成功")

        # 3. 访问签到页获取当前 Session 的新 formhash，并判断是否已签到
        try:
            r3 = self.session.get(
                f"{self.base_url}/plugin.php?id=k_misign:sign", timeout=15
            )
            r3.encoding = "utf-8"
        except Exception as e:
            print(f"访问签到页面失败: {e}")
            return False

        if (
            "您的签到排名" in r3.text
            or "今日已签" in r3.text
            or "已累计签到" in r3.text
        ):
            print("今天已经签到过了")
            return True

        sign_formhash_match = re.search(
            r"formhash=([a-zA-Z0-9]+)", r3.text
        ) or re.search(r'name="formhash"\s+value="([a-zA-Z0-9]+)"', r3.text)
        if not sign_formhash_match:
            print("签到页面未找到 formhash")
            return False
        sign_formhash = sign_formhash_match.group(1)

        # 4. 执行签到 AJAX 请求
        params = {
            "id": "k_misign:sign",
            "operation": "qiandao",
            "format": "button",
            "formhash": sign_formhash,
            "inajax": "1",
            "ajaxtarget": "midaben_sign",
        }

        try:
            r4 = self.session.get(
                f"{self.base_url}/plugin.php",
                params=params,
                headers={"Referer": f"{self.base_url}/plugin.php?id=k_misign:sign"},
                timeout=15,
            )
            r4.encoding = "utf-8"
        except Exception as e:
            print(f"发送签到请求失败: {e}")
            return False

        # 提取并美化签到提示信息
        sign_cdata = re.search(r"<!\[CDATA\[(.*?)\]\]>", r4.text, re.DOTALL)
        sign_msg_raw = sign_cdata.group(1) if sign_cdata else ""
        sign_msg_no_html = re.sub(
            r"<script.*?>.*?</script>", "", sign_msg_raw, flags=re.DOTALL
        )
        sign_msg_no_html = re.sub(r"<.*?>", "", sign_msg_no_html)

        lines = []
        for line in sign_msg_no_html.splitlines():
            line_str = line.strip()
            # 过滤空行、纯数字、以及形如 "2195人" 的签到排名信息
            if not line_str or line_str.isdigit() or re.match(r"^\d+人$", line_str):
                continue
            line_str = re.sub(r"和\s*。", "。", line_str)
            lines.append(line_str)

        sign_msg = " | ".join(lines) if lines else "未知结果"

        if "签到成功" in r4.text or "今日已签" in r4.text or "CDATA" in r4.text:
            print(f"签到成功！提示: {sign_msg}")
            return True
        else:
            print(f"签到失败: {sign_msg}")
            return False


def main() -> int:
    summary = run_account_scripts(__file__, Script, notify_module=notify)
    return summary.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
