"""
name: 脚本模板
cron: 0 0 * * *
description: 新脚本统一模板

env:
- 变量名固定为脚本文件名去后缀
- 支持单账号 JSON、账号数组，或每行一个 JSON 对象
"""

from __future__ import annotations

import notify
from common import run_account_scripts


class Script:
    """示例脚本类。"""

    def __init__(self, account: dict):
        self.account = account
        self.username = account.get("username", "")

    def run(self) -> bool:
        if self.username:
            print(f"账号 [{self.username}]")
        # 账号对象通常包含 cookie、密码或 token，模板不能示范整体输出配置。
        print("示例任务执行完成")
        return True


def main() -> int:
    summary = run_account_scripts(__file__, Script, notify_module=notify)
    return summary.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
