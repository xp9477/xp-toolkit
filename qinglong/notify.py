"""
name: 通知模块
env:
- `notify`: Bark 设备 key（推荐纯字符串），或 JSON，例如:
  {"bark": "xxx"} / {"bark_push": "xxx"} / {"push": "xxx"} / {"token": "xxx"}
  也支持完整推送地址: "https://api.day.app/xxx" 或自建服务器地址
"""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import quote, urlparse

import requests

try:
    from dotenv import load_dotenv
except ImportError:  # 青龙通常有；本地调试可无
    def load_dotenv(*_a, **_k):
        return False

from common import get_env, get_script_env_name

load_dotenv()

DEFAULT_BARK_HOST = "https://api.day.app"
REQUEST_TIMEOUT = 15


def _first_str(*values: Any) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _extract_key_from_mapping(config: dict[str, Any]) -> str:
    # 兼容青龙/常见字段命名
    return _first_str(
        config.get("bark"),
        config.get("bark_push"),
        config.get("BARK"),
        config.get("BARK_PUSH"),
        config.get("barkPush"),
        config.get("device_key"),
        config.get("deviceKey"),
        config.get("push"),
        config.get("token"),
        config.get("key"),
    )


def _normalize_bark_target(raw: str) -> tuple[str, str]:
    """
    返回 (server_base, device_key)。
    支持:
    - device_key
    - https://api.day.app/device_key
    - https://api.day.app/device_key/
    - https://self-host.example/device_key
    """
    value = (raw or "").strip()
    if not value:
        return DEFAULT_BARK_HOST, ""

    if "://" not in value:
        return DEFAULT_BARK_HOST, value.strip("/")

    parsed = urlparse(value)
    if not parsed.scheme or not parsed.netloc:
        return DEFAULT_BARK_HOST, value.strip("/")

    base = f"{parsed.scheme}://{parsed.netloc}"
    path = (parsed.path or "").strip("/")
    # 允许 .../push 误填，尽量剥掉末尾 push
    if path.endswith("/push"):
        path = path[: -len("/push")].strip("/")
    # path 可能是 key，也可能是 key/xxx
    key = path.split("/", 1)[0] if path else ""
    return base, key


def get_bark_push() -> str:
    """读取 Bark 推送原始配置字符串（key 或 URL）。"""
    env_name = get_script_env_name(__file__)  # notify
    raw = get_env(env_name, required=False)
    if not raw:
        # 兜底常见独立变量名，避免只配了 BARK 却读不到
        raw = (
            get_env("BARK_PUSH", required=False)
            or get_env("BARK", required=False)
            or get_env("bark_push", required=False)
            or get_env("bark", required=False)
            or ""
        )

    raw = (raw or "").strip()
    if not raw:
        return ""

    if raw.startswith("{"):
        try:
            config = json.loads(raw)
        except json.JSONDecodeError:
            return raw
        if isinstance(config, dict):
            return _extract_key_from_mapping(config)
        return ""

    return raw


def _send_bark_post(server: str, device_key: str, title: str, content: str) -> tuple[bool, str]:
    url = f"{server.rstrip('/')}/push"
    payload = {
        "title": title,
        "body": content,
        "device_key": device_key,
        # 分组方便在 Bark 里筛选
        "group": "ashare-kimi3",
    }
    resp = requests.post(url, json=payload, timeout=REQUEST_TIMEOUT)
    text = (resp.text or "").strip()
    ok = 200 <= resp.status_code < 300
    # Bark 成功一般是 {"code":200,...}
    try:
        data = resp.json()
        code = data.get("code")
        if code is not None:
            ok = int(code) == 200
        msg = data.get("message") or text
    except Exception:
        msg = text or f"HTTP {resp.status_code}"
    return ok, f"POST {resp.status_code} {msg}"


def _send_bark_get(server: str, device_key: str, title: str, content: str) -> tuple[bool, str]:
    # GET 路径方式对长中文不友好，仅作后备
    url = f"{server.rstrip('/')}/{device_key}/{quote(title)}/{quote(content)}"
    if len(url) > 1800:
        return False, f"GET URL 过长({len(url)}), 已跳过"
    resp = requests.get(url, timeout=REQUEST_TIMEOUT)
    text = (resp.text or "").strip()
    ok = 200 <= resp.status_code < 300
    try:
        data = resp.json()
        code = data.get("code")
        if code is not None:
            ok = int(code) == 200
        msg = data.get("message") or text
    except Exception:
        msg = text or f"HTTP {resp.status_code}"
    return ok, f"GET {resp.status_code} {msg}"


def send(title: str, content: str) -> bool:
    """发送 Bark 推送。成功返回 True，失败打印原因并返回 False。"""
    bark_raw = get_bark_push()
    if not bark_raw:
        print("缺少推送配置: 请在青龙添加环境变量 notify = <Bark设备key>")
        print('示例: notify=xxxxxxxx 或 notify={"bark":"xxxxxxxx"}')
        return False

    server, device_key = _normalize_bark_target(bark_raw)
    if not device_key:
        print(f"推送配置无效，无法解析 device_key: {bark_raw[:80]}")
        return False

    # 脱敏日志
    masked = device_key if len(device_key) <= 8 else f"{device_key[:4]}***{device_key[-4:]}"
    print(f"Bark 推送中: server={server} key={masked} title={title!r} body_len={len(content)}")

    try:
        ok, detail = _send_bark_post(server, device_key, title, content)
        if ok:
            print(f"Bark 推送成功: {detail}")
            return True
        print(f"Bark POST 失败: {detail}，尝试 GET 后备…")
        ok2, detail2 = _send_bark_get(server, device_key, title, content)
        if ok2:
            print(f"Bark GET 推送成功: {detail2}")
            return True
        print(f"Bark 推送失败: {detail2}")
        return False
    except requests.RequestException as exc:
        print(f"Bark 推送网络异常: {exc}")
        return False
    except Exception as exc:
        print(f"Bark 推送异常: {exc}")
        return False


if __name__ == "__main__":
    configured = bool(get_bark_push())
    print(f"notify 配置已读取: {configured}")
    if configured:
        send("notify 自检", "如果你看到这条 Bark，说明推送配置正常。")
    else:
        print("未配置 notify，跳过实际发送")
