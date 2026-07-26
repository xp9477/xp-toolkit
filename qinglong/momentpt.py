"""
name: MomentPT 喊话
cron: 0 0 * * *
description: MomentPT 站点 shoutbox 喊话

env:
- `momentpt`: {"cookie": "a=b; c=d", "message": "...", "keyword": "..."}
"""

import re

import notify
import requests
from common import load_config, run_single_script


def parse_cookie_string(cookie_string):
    cookies = {}
    for item in cookie_string.split(";"):
        item = item.strip()
        if not item or "=" not in item:
            continue
        key, value = item.split("=", 1)
        cookies[key.strip()] = value.strip()
    return cookies


def load_momentpt_config():
    config = load_config(__file__)
    if not isinstance(config, dict):
        raise ValueError("momentpt 配置必须为 JSON 对象")

    cookie = config.get("cookie", "")
    if not cookie:
        raise ValueError("momentpt 配置缺少 cookie")

    return {
        "cookies": parse_cookie_string(cookie),
        "message": config.get("message", "茄子"),
        "keyword": config.get("keyword") or config.get("username", ""),
    }


def main():
    config = load_momentpt_config()

    headers = {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "priority": "u=0, i",
        "referer": "https://www.momentpt.top/index.php",
        "sec-ch-ua": '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "iframe",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    }

    params = {
        "shbox_text": config["message"],
        "shout": "我喊",
        "sent": "yes",
        "type": "shoutbox",
    }

    response = requests.get(
        "https://www.momentpt.top/shoutbox.php",
        params=params,
        cookies=config["cookies"],
        headers=headers,
        timeout=30,
    )
    response.raise_for_status()

    messages = re.findall(r'<td class="shoutrow">(.*?)</td>', response.text, re.DOTALL)
    for msg in messages:
        clean_text = re.sub(r"<.*?>", "", msg).strip()
        keyword = config["keyword"]
        if not keyword or keyword in clean_text:
            print(clean_text)


if __name__ == "__main__":
    raise SystemExit(run_single_script(__file__, main, notify_module=notify).exit_code)
