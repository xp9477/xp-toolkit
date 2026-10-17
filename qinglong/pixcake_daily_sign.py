"""
name: 像素蛋糕每日签到
cron: 15 9 * * *
description: 像素蛋糕 (PixCake) 积分任务每日自动签到，支持青龙环境变量与本地 macOS 自动凭证探测

env:
- `pixcake_daily_sign`: JSON 数组、单个 JSON 对象或每行一个 JSON 对象。
  字段说明：
  - `token`: 必需，JWT 字符串（即客户端存储的 Token_Key）
  - `username`: 可选，账号备注（不填则自动解析手机号或 UID）
  * 注：在 macOS 本地运行且未配置环境变量时，脚本会自动从本地 PixCake 客户端存储中提取最新 Token，实现零配置即跑。
"""

from __future__ import annotations

import base64
import glob
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import requests

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

import notify
from common import (
    require_fields,
    run_account_scripts,
)

BASE_URL = "https://points-api.pixcakeai.com"
REQUEST_TIMEOUT = (10, 30)


def find_local_pixcake_tokens() -> list[dict[str, Any]]:
    """
    自动从 macOS 本地 PixCake 存储目录中探测有效 Token_Key。
    """
    base_dir = os.path.expanduser("~/Library/Application Support/PixCake-qt_pro/webengine")
    if not os.path.exists(base_dir):
        return []

    cookie_files = glob.glob(f"{base_dir}/**/Cookies", recursive=True)
    if not cookie_files:
        return []

    cookie_files.sort(key=lambda p: os.path.getmtime(p), reverse=True)

    tokens = set()
    accounts: list[dict[str, Any]] = []

    with tempfile.TemporaryDirectory() as tmpdir:
        for idx, p in enumerate(cookie_files):
            try:
                tmp_cookie = os.path.join(tmpdir, f"Cookies_{idx}")
                shutil.copy2(p, tmp_cookie)
                conn = sqlite3.connect(f"file:{tmp_cookie}?mode=ro", uri=True)
                c = conn.cursor()
                c.execute(
                    'SELECT value FROM cookies WHERE name = "Token_Key" AND host_key LIKE "%pixcakeai.com%"'
                )
                for (val,) in c.fetchall():
                    if val and val not in tokens:
                        tokens.add(val)
                        username = "PixCake-User"
                        try:
                            parts = val.split(".")
                            if len(parts) >= 2:
                                pad = "=" * (-len(parts[1]) % 4)
                                payload = json.loads(base64.urlsafe_b64decode(parts[1] + pad))
                                phone = payload.get("phone") or payload.get("user_id")
                                if phone:
                                    username = str(phone)
                        except Exception:
                            pass
                        accounts.append({"username": username, "token": val})
                conn.close()
            except Exception:
                continue

    return accounts


def notify_mac_banner(title: str, message: str) -> None:
    """在 macOS 桌面触发横幅通知。"""
    if sys.platform == "darwin":
        try:
            safe_msg = message.replace('"', '\\"')
            safe_title = title.replace('"', '\\"')
            cmd = f'display notification "{safe_msg}" with title "{safe_title}"'
            subprocess.run(["osascript", "-e", cmd], capture_output=True, timeout=5)
        except Exception:
            pass


class PixCakeSignClient:
    """像素蛋糕积分任务签到客户端。"""

    def __init__(self, token: str, session: requests.Session | None = None) -> None:
        self.token = token.strip()
        self.session = session if session is not None else requests.Session()
        self.headers = {
            "Authorization": self.token,
            "Cake-Appid": "1",
            "Ts-AppId": "1",
            "Cake-Version": "10.0.5-156",
            "Ts-Version": "10.0.5-156",
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/118.0.0.0 Safari/537.36"
            ),
            "Content-Type": "application/json",
        }

    def get_task_list(self) -> dict[str, Any]:
        resp = self.session.get(
            f"{BASE_URL}/v1/api/points/get_all_tasks",
            headers=self.headers,
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()

    def do_sign(self) -> dict[str, Any]:
        resp = self.session.post(
            f"{BASE_URL}/v1/api/points/sign",
            headers=self.headers,
            json={},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()


class Script:
    """账号执行封装。"""

    def __init__(self, account: dict[str, Any]) -> None:
        self.account = account
        require_fields(account, "token")
        self.username = account.get("username", "")
        self.token = account["token"]
        self.client = PixCakeSignClient(token=self.token)

    def run(self) -> bool:
        if self.username:
            print(f"账号 [{self.username}] 开始执行签到检查...")

        try:
            task_resp = self.client.get_task_list()
        except Exception as exc:
            print(f"获取任务列表失败: {exc}")
            return False

        if task_resp.get("code") != 0:
            print(f"任务接口异常: {task_resp}")
            return False

        tasks = task_resp.get("data", [])
        meta = task_resp.get("meta", {})
        left_points = meta.get("left_points", 0)
        total_points = meta.get("total_points", 0)

        sign_task = None
        for t in tasks:
            if t.get("type") == 1:
                sign_task = t
                break

        if not sign_task:
            print("未在任务列表中找到日常签到任务。")
            return False

        is_finish = sign_task.get("is_finish", False)
        current_progress = sign_task.get("progress", 0)
        reward_points = sign_task.get("points", 5)

        if is_finish:
            msg = (
                f"今日已完成签到！\n"
                f"已连续签到: {current_progress} 天\n"
                f"当前可用积分: {left_points} (累计获得: {total_points})"
            )
            print(msg)
            notify_mac_banner("像素蛋糕签到", f"今日已签到，连续 {current_progress} 天，当前积分 {left_points}")
            return True

        print(f"检测到今日尚未签到（当前已连续签到 {current_progress} 天），正在提交签到...")
        try:
            sign_resp = self.client.do_sign()
        except Exception as exc:
            print(f"签到请求提交失败: {exc}")
            return False

        if sign_resp.get("code") != 0:
            print(f"签到失败: {sign_resp}")
            return False

        sign_data = sign_resp.get("data", {})
        new_progress = sign_data.get("progress", current_progress + 1)
        total_cycle = sign_data.get("total_progress", 7)
        estimated_points = left_points + reward_points

        success_msg = (
            f"🎉 签到成功！\n"
            f"获得积分: +{reward_points}\n"
            f"连续签到: {new_progress}/{total_cycle} 天\n"
            f"预计可用积分: {estimated_points}"
        )
        print(success_msg)
        notify.send("像素蛋糕每日签到", success_msg)
        notify_mac_banner("像素蛋糕签到成功", f"获得 +{reward_points} 积分，连续签到 {new_progress} 天！")
        return True


def main() -> int:
    env_name = "pixcake_daily_sign"
    if not os.environ.get(env_name):
        local_accounts = find_local_pixcake_tokens()
        if local_accounts:
            print(f"ℹ️ 检测到本机 PixCake 客户端，已自动提取 {len(local_accounts)} 个账号凭证。")
            os.environ[env_name] = json.dumps(local_accounts)
        else:
            print(
                f"⚠️ 未检测到环境变量 {env_name}，且未能在本地探测到 PixCake 登录凭证。\n"
                f"请在本地运行像素蛋糕并保持登录，或在环境变量中配置 {env_name}。"
            )

    summary = run_account_scripts(__file__, Script, notify_module=notify)
    return summary.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
