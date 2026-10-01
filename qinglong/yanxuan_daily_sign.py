"""
name: 网易严选每日签到
cron: 10 9 * * *
description: 网易严选活动页每日签到 (act.you.163.com)

env:
- `yanxuan_daily_sign`: JSON 数组、单个 JSON 对象或每行一个 JSON 对象。
  字段说明：
  - `cookie`: 必需，支持字符串格式（必须包含 yx_csrf 及 yx_new_sid/yx_sid/NTES_YD_SESS 之一）
  - `ua`: 可选，自定义 User-Agent
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

import notify
from common import (
    require_fields,
    run_account_scripts,
    safe_notify,
)

ORIGIN = "https://act.you.163.com"
PAGE_URL = "https://act.you.163.com/act/pub/ssr/HysmFsmeKj88.html?appConfig=1_1_2"
DEFAULT_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 yanxuan/9.7.6"
)

# 严格白名单限制，防止过宽 Cookie 泄露
ALLOWED_COOKIE_KEYS = {"yx_csrf", "yx_new_sid", "yx_sid", "NTES_YD_SESS"}
SET_COOKIE_KEYS = {"yx_sid", "yx_new_sid", "yx_csrf"}
REQUEST_TIMEOUT = 15
MAX_SAFE_POINTS = 100_000_000


def parse_and_filter_cookies(
    cookie_input: str | dict[str, Any] | None,
) -> dict[str, str]:
    """严格白名单过滤 Cookie 字段，仅保留必要字段：yx_csrf, yx_new_sid, yx_sid, NTES_YD_SESS。"""
    cookies: dict[str, str] = {}
    if not cookie_input:
        return cookies

    if isinstance(cookie_input, dict):
        for k, v in cookie_input.items():
            if k in ALLOWED_COOKIE_KEYS and v:
                val = str(v).strip()
                if val and len(val) <= 512 and not any(c in val for c in "\r\n\0"):
                    cookies[k] = val
        return cookies

    for part in str(cookie_input).split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            k = k.strip()
            v = v.strip()
            if (
                k in ALLOWED_COOKIE_KEYS
                and v
                and len(v) <= 512
                and not any(c in v for c in "\r\n\0")
            ):
                cookies[k] = v
    return cookies


def cookie_dict_to_header(cookies: dict[str, str]) -> str:
    """序列化为仅含白名单键的 Cookie 请求头。"""
    return "; ".join(f"{k}={v}" for k, v in cookies.items() if k in ALLOWED_COOKIE_KEYS)


def has_valid_login_state(cookies: dict[str, str]) -> bool:
    """校验登录态完整性：必需 yx_csrf，且必须包含会话 Cookie 之一。"""
    if not cookies.get("yx_csrf"):
        return False
    return bool(
        cookies.get("yx_new_sid")
        or cookies.get("yx_sid")
        or cookies.get("NTES_YD_SESS")
    )


def safe_business_code(raw_code: Any) -> str:
    """业务码脱敏校验：仅允许非负整数且上限 999999，防 bool 误判与敏感串。"""
    if isinstance(raw_code, bool) or raw_code is None:
        return "未知"
    if isinstance(raw_code, int) and 0 <= raw_code <= 999999:
        return str(raw_code)
    if isinstance(raw_code, str):
        clean = raw_code.strip()
        if clean.isdigit() and len(clean) <= 6:
            return clean
    return "未知"


def safe_points(raw_points: Any) -> int | None:
    """严格解析积分数值：防止 bool 误判、负数及不合理超大数值。"""
    if isinstance(raw_points, bool) or raw_points is None:
        return None
    try:
        val = int(raw_points)
        if 0 <= val <= MAX_SAFE_POINTS:
            return val
    except (TypeError, ValueError):
        pass
    return None


def safe_status(raw_status: Any) -> int | None:
    """严格解析签到状态码 (0 或 1)，防 bool 误判。"""
    if isinstance(raw_status, bool) or raw_status is None:
        return None
    try:
        val = int(raw_status)
        if val in (0, 1):
            return val
    except (TypeError, ValueError):
        pass
    return None


def _extract_set_cookie_updates(response: Any) -> dict[str, str]:
    """仅从受信严选活动域名的响应中提取 Set-Cookie (yx_sid, yx_new_sid, yx_csrf)。"""
    updates: dict[str, str] = {}

    resp_url = str(getattr(response, "url", "") or "")
    if resp_url:
        parsed = urlparse(resp_url)
        if parsed.scheme != "https" or parsed.netloc != "act.you.163.com":
            return updates

    # 1. 尝试从 response.cookies 读取
    cookie_jar = getattr(response, "cookies", None)
    if cookie_jar is not None:
        try:
            for k, v in cookie_jar.items():
                if k in SET_COOKIE_KEYS and v:
                    val = str(v).strip()
                    if val and len(val) <= 512 and not any(c in val for c in "\r\n\0"):
                        updates[k] = val
        except Exception:
            pass

    # 2. 从 Set-Cookie 响应头中正则解析
    headers = getattr(response, "headers", None)
    if headers:
        raw_headers: list[str] = []
        if hasattr(headers, "get_all"):
            raw_headers = headers.get_all("Set-Cookie") or []
        elif hasattr(headers, "getlist"):
            raw_headers = headers.getlist("Set-Cookie") or []
        elif "Set-Cookie" in headers:
            raw_val = headers["Set-Cookie"]
            raw_headers = [raw_val] if isinstance(raw_val, str) else list(raw_val)

        pattern = re.compile(
            r"(?:^|[\r\n,]\s*)(yx_sid|yx_new_sid|yx_csrf)=([^;,\r\n]*)"
        )
        for cookie_line in raw_headers:
            for match in pattern.finditer(str(cookie_line)):
                k, v = match.group(1), match.group(2).strip()
                if (
                    k in SET_COOKIE_KEYS
                    and v
                    and len(v) <= 512
                    and not any(c in v for c in "\r\n\0")
                ):
                    updates[k] = v

    return updates


class Script:
    """网易严选活动页每日签到。"""

    def __init__(self, account: dict[str, Any]):
        self.account = account
        require_fields(account, "cookie")

        # 严格固定安全别名，拒绝任何用户原始输入进入日志或推送
        self.display_name = "严选账号"

        self.ua = (
            account.get("ua")
            or account.get("user_agent")
            or account.get("User-Agent")
            or DEFAULT_UA
        )

        self.cookies = parse_and_filter_cookies(account.get("cookie"))
        self.session = requests.Session()
        # 禁用默认继承环境变量代理与 netrc，避免 Cookie 经未授权网络出站
        self.session.trust_env = False
        self.session.max_redirects = 0
        self.session.cookies.clear()
        self.last_error: str | None = None

    def _safe_get(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        accept: str | None = None,
    ) -> requests.Response:
        """执行受信同源 GET 请求，严格禁止重定向，仅在内存更新 Cookie。"""
        if not path.startswith("/"):
            path = f"/{path}"
        url = f"{ORIGIN}{path}"

        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.netloc != "act.you.163.com":
            raise ValueError("非受信请求地址")

        headers = {
            "User-Agent": self.ua,
            "Referer": PAGE_URL,
            "X-Requested-With": "XMLHttpRequest",
            "Accept": accept or "application/json, text/javascript, */*; q=0.01",
            "Cookie": cookie_dict_to_header(self.cookies),
        }

        # 确保 session 内部 CookieJar 不跨请求非受控累积持久化
        self.session.cookies.clear()

        response = self.session.get(
            url,
            params=params,
            headers=headers,
            allow_redirects=False,
            timeout=REQUEST_TIMEOUT,
        )

        updates = _extract_set_cookie_updates(response)
        self.session.cookies.clear()
        if updates:
            # 仅在内存更新，绝不回写环境变量或持久化存储
            self.cookies.update(updates)

        return response

    def run(self) -> bool:
        """执行签到业务流程，捕获所有底层网络异常以避免泄露 URL/CSRF 至外部通知。"""
        print(f"开始执行网易严选每日签到 - 账号: {self.display_name}")

        if not has_valid_login_state(self.cookies):
            self.last_error = "登录态缺失或已失效，请重新获取 Cookie"
            print(
                f"账号 [{self.display_name}] 登录态缺失: 缺少必要 Cookie 字段 (yx_csrf 或 会话标识)"
            )
            return False

        try:
            return self._execute_sign_flow()
        except requests.RequestException:
            # 捕获并脱敏 requests 异常对象（其内含完整请求 URL 及查询参数 CSRF），防止冒泡至 Bark
            self.last_error = "网络请求异常"
            print(f"账号 [{self.display_name}] 网络请求异常")
            return False
        except Exception:
            self.last_error = "业务处理异常"
            print(f"账号 [{self.display_name}] 业务处理异常")
            return False

    def _execute_sign_flow(self) -> bool:
        now_ms = int(time.time() * 1000)
        csrf = self.cookies.get("yx_csrf", "")

        # 1. 活动初始化 GET /act/forward/xhr/act/init
        init_params = {
            "callback": f"yxInit{now_ms}",
            "url": PAGE_URL,
            "_hd_from": "148031",
            "csrf_token": csrf,
            "_": now_ms,
        }
        try:
            init_resp = self._safe_get(
                "/act/forward/xhr/act/init",
                params=init_params,
                accept="text/javascript, */*; q=0.01",
            )
            if not (200 <= init_resp.status_code < 300):
                print("活动初始化 HTTP 状态非 2xx，继续尝试签到")
        except requests.RequestException:
            print("活动初始化网络请求异常，继续尝试签到")

        # 使用初始化可能更新后的内存 csrf
        csrf = self.cookies.get("yx_csrf", "")

        # 2. 签到前查询状态 GET /act-attendance/att/v4/index
        now_ms = int(time.time() * 1000)
        index_params = {
            "__timestamp": now_ms,
            "csrf_token": csrf,
        }
        resp1 = self._safe_get("/act-attendance/att/v4/index", params=index_params)
        if not (200 <= resp1.status_code < 300):
            self.last_error = "查询签到状态 HTTP 异常"
            print(f"账号 [{self.display_name}] 查询签到状态 HTTP 异常")
            return False

        try:
            json1 = resp1.json()
        except Exception:
            self.last_error = "查询签到状态响应非有效 JSON"
            print(f"账号 [{self.display_name}] 查询签到状态响应格式异常")
            return False

        if json1.get("code") != 200 or json1.get("success") is not True:
            code_str = safe_business_code(json1.get("code"))
            self.last_error = f"查询签到状态业务返回失败 (业务码: {code_str})"
            print(
                f"账号 [{self.display_name}] 查询签到状态返回失败 (业务码: {code_str})"
            )
            return False

        data1 = json1.get("data")
        if not isinstance(data1, dict):
            self.last_error = "查询签到状态数据格式异常"
            print(f"账号 [{self.display_name}] 查询签到状态数据格式异常")
            return False

        before_points = safe_points(data1.get("points"))

        # 3. 发送签到请求 GET /act-attendance/att/v3/sign
        now_ms = int(time.time() * 1000)
        sign_params = {
            "__timestamp": now_ms,
            "csrf_token": csrf,
        }
        sign_resp = self._safe_get("/act-attendance/att/v3/sign", params=sign_params)
        if not (200 <= sign_resp.status_code < 300):
            self.last_error = "签到接口 HTTP 异常"
            print(f"账号 [{self.display_name}] 签到接口 HTTP 异常")
            return False

        try:
            sign_json = sign_resp.json()
        except Exception:
            self.last_error = "签到响应非有效 JSON"
            print(f"账号 [{self.display_name}] 签到响应格式异常")
            return False

        raw_sign_code = sign_json.get("code")
        sign_code = (
            raw_sign_code
            if (isinstance(raw_sign_code, int) and type(raw_sign_code) is not bool)
            else None
        )
        sign_success = (
            raw_sign_code == 200 and type(raw_sign_code) is not bool
        ) and sign_json.get("success") is True

        # 4. 签到后复核积分 GET /act-attendance/att/v4/index
        now_ms = int(time.time() * 1000)
        index2_params = {
            "__timestamp": now_ms,
            "csrf_token": csrf,
        }
        after_points: int | None = None
        after_status: int | None = None

        try:
            resp2 = self._safe_get("/act-attendance/att/v4/index", params=index2_params)
            if 200 <= resp2.status_code < 300:
                json2 = resp2.json()
                if json2.get("code") == 200 and json2.get("success") is True:
                    data2 = json2.get("data")
                    if isinstance(data2, dict):
                        after_points = safe_points(data2.get("points"))
                        sign_info2 = (
                            data2.get("sign")
                            if isinstance(data2.get("sign"), dict)
                            else {}
                        )
                        after_status = safe_status(sign_info2.get("status"))
        except Exception:
            print(f"账号 [{self.display_name}] 复核签到状态网络或解析异常")

        # 5. 结果校验与通知判断
        # 规则 1: 全新签到成功，必须同时满足 sign_success 为 True 且积分确认增加
        if (
            sign_success
            and before_points is not None
            and after_points is not None
            and after_points > before_points
        ):
            diff = after_points - before_points
            msg = f"签到成功：积分 +{diff}，当前积分 {after_points}"
            print(f"账号 [{self.display_name}] {msg}")
            safe_notify(notify, "网易严选每日签到", f"账号 [{self.display_name}] {msg}")
            return True

        # 规则 2: 服务端判定已签到，必须有明确业务码 1009 且后验签到状态确认 (after_status == 1)
        if sign_code == 1009 and after_status == 1:
            cur_p = f"，当前积分 {after_points}" if after_points is not None else ""
            msg = f"今日已签到{cur_p}"
            print(f"账号 [{self.display_name}] {msg}")
            safe_notify(notify, "网易严选每日签到", f"账号 [{self.display_name}] {msg}")
            return True

        # 规则 3: 业务明确报错（失败不单独发通知，由 common 统一汇总通知）
        if not sign_success:
            code_str = safe_business_code(raw_sign_code)
            self.last_error = f"签到业务返回失败 (业务码: {code_str})"
            print(f"账号 [{self.display_name}] 签到业务返回失败 (业务码: {code_str})")
            return False

        # 规则 4: 签到接口成功但积分未确认增加（或复核失败）
        if (
            after_points is not None
            and before_points is not None
            and after_points <= before_points
        ):
            print(f"账号 [{self.display_name}] 已调用签到接口，但积分未增加（未确认）")
            self.last_error = "签到积分未确认增加"
            return False

        self.last_error = "签到积分复核未确认"
        print(f"账号 [{self.display_name}] 签到积分复核未确认")
        return False


def _desensitize_env_accounts() -> None:
    """运行前在内存中脱敏配置，清除 phone/uid/username，强制设置安全别名'严选账号'。"""
    raw = os.getenv("yanxuan_daily_sign")
    if not raw or not raw.strip():
        return

    def _sanitize(item: Any) -> None:
        if isinstance(item, dict):
            # 彻底清理所有潜在敏感标识字段，防止 common.account_display_name 优先取用泄漏
            item.pop("phone", None)
            item.pop("uid", None)
            item.pop("username", None)
            item["name"] = "严选账号"

    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            if isinstance(data.get("accounts"), list):
                for acc in data["accounts"]:
                    _sanitize(acc)
            else:
                _sanitize(data)
        elif isinstance(data, list):
            for acc in data:
                _sanitize(acc)
        os.environ["yanxuan_daily_sign"] = json.dumps(data)
    except json.JSONDecodeError:
        lines = [line.strip() for line in raw.splitlines() if line.strip()]
        new_lines: list[str] = []
        for line in lines:
            try:
                obj = json.loads(line)
                _sanitize(obj)
                new_lines.append(json.dumps(obj))
            except Exception:
                new_lines.append(line)
        os.environ["yanxuan_daily_sign"] = "\n".join(new_lines)


def main() -> int:
    _desensitize_env_accounts()
    summary = run_account_scripts(__file__, Script, notify_module=notify)
    return summary.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
