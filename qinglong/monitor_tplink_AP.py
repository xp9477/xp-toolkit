"""
name: Tplink AP
cron: 0 * * * *
description: 监控 TP-Link AP 在线数量

env:
- `monitor_tplink_AP`: {"url": "...", "username": "...", "password": "...", "expected_count": 4}
"""

import notify
import requests
import urllib3
from common import load_config, run_single_script

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


def load_monitor_config():
    config = load_config(__file__)
    if not isinstance(config, dict):
        raise ValueError("monitor_tplink_AP 配置必须为 JSON 对象")

    url = config.get("url", "").rstrip("/")
    username = config.get("username", "")
    password = config.get("password", "")
    expected_count = config.get("expected_count", 4)

    if not url or not username or not password:
        raise ValueError("monitor_tplink_AP 配置缺少 url/username/password")

    return {
        "url": url,
        "username": username,
        "password": password,
        "expected_count": expected_count,
    }


def main():
    config = load_monitor_config()
    base_url = config["url"]

    headers = {
        "Accept": "text/plain, */*; q=0.01",
        "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Content-Type": "application/json; charset=UTF-8",
        "Origin": base_url,
        "Pragma": "no-cache",
        "Referer": f"{base_url}/login.htm",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        "X-Requested-With": "XMLHttpRequest",
    }

    login_payload = {
        "method": "do",
        "login": {
            "username": config["username"],
            "password": config["password"],
        },
    }

    response = requests.post(f"{base_url}/", headers=headers, json=login_payload, verify=False, timeout=30)
    response.raise_for_status()
    stok = response.json()["stok"]

    query_payload = {
        "method": "get",
        "apmng_upgrade": {
            "table": "ap_list",
            "filter": [
                {
                    "group_id": "0",
                    "ap_role": ["re_all", "normal", "cap_all"],
                },
            ],
            "para": {
                "start": 0,
                "end": 499,
            },
        },
    }

    response = requests.post(
        f"{base_url}/stok={stok}/ds",
        headers=headers,
        json=query_payload,
        verify=False,
        timeout=30,
    )
    response.raise_for_status()
    ap_list_num = response.json()["apmng_upgrade"]["count"]["ap_list"]

    if ap_list_num != config["expected_count"]:
        print(f"AP数量不正确: {ap_list_num}")
        notify.send("Tplink AP", f"AP异常, 在线数量: {ap_list_num}, 请检查")
        raise RuntimeError(f"AP数量不正确: {ap_list_num}")

    print(f"AP数量正常: {ap_list_num}")


if __name__ == "__main__":
    raise SystemExit(run_single_script(__file__, main, notify_module=notify).exit_code)
