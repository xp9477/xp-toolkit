"""
name: Supabase Keepalive
cron: 0 */6 * * *
description: 请求 Supabase REST API 保持项目活跃

env:
- `supabase`: {"url":"https://wcklmuftxzdtcpaercno.supabase.co","schema":"easysearch","table":"ut_entries","select":"user_id","secret_key":"<填你的 sb_secret_xxx 或 service_role>"}
- 支持单个 JSON 对象、JSON 数组，或 `{"accounts":[...]}` 多配置写法
"""

from __future__ import annotations

import urllib.error
import urllib.parse
import urllib.request
from typing import Any

import notify
from common import run_account_scripts, validate_service_origin

DEFAULT_SCHEMA = "easysearch"
DEFAULT_TABLE = "ut_entries"
DEFAULT_SELECT = "user_id"
DEFAULT_LIMIT = 1
DEFAULT_TIMEOUT = 30


def pick_text(data: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = data.get(key)
        if value is not None:
            text = str(value).strip()
            if text:
                return text
    return ""


def parse_positive_int(value: Any, default: int, field_name: str) -> int:
    if value in (None, ""):
        return default
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} 必须为正整数") from exc
    if number <= 0:
        raise ValueError(f"{field_name} 必须为正整数")
    return number


class Script:
    def __init__(self, account: dict[str, Any]):
        self.account = account
        self.config = self._normalize(account)
        self.account.setdefault("name", self.config["name"])

    def _normalize(self, account: dict[str, Any]) -> dict[str, Any]:
        raw_base_url = pick_text(account, "url", "base_url", "project_url")
        schema = pick_text(account, "schema") or DEFAULT_SCHEMA
        table = pick_text(account, "table") or DEFAULT_TABLE
        select = pick_text(account, "select") or DEFAULT_SELECT
        secret_key = pick_text(
            account,
            "secret_key",
            "service_role",
            "apikey",
            "api_key",
            "token",
        )
        limit = parse_positive_int(account.get("limit"), DEFAULT_LIMIT, "limit")
        timeout = parse_positive_int(account.get("timeout"), DEFAULT_TIMEOUT, "timeout")
        name = pick_text(account, "name", "username") or f"{schema}.{table}"

        base_url = validate_service_origin(raw_base_url, field_name="url")
        if not secret_key:
            raise ValueError("缺少 secret_key")

        return {
            "name": name,
            "url": base_url,
            "schema": schema,
            "table": table,
            "select": select,
            "secret_key": secret_key,
            "limit": limit,
            "timeout": timeout,
        }

    def run(self) -> bool:
        config = self.config
        query = urllib.parse.urlencode(
            {
                "select": config["select"],
                "limit": config["limit"],
            }
        )
        table_path = urllib.parse.quote(config["table"], safe="._-")
        url = f'{config["url"]}/rest/v1/{table_path}?{query}'
        headers = {
            "apikey": config["secret_key"],
            "Authorization": f'Bearer {config["secret_key"]}',
            "Accept": "application/json",
            "Accept-Profile": config["schema"],
        }
        request = urllib.request.Request(url, headers=headers, method="GET")

        try:
            with urllib.request.urlopen(request, timeout=config["timeout"]) as response:
                body = response.read().decode("utf-8", errors="replace")
                print(
                    f'[{config["name"]}] keepalive ok: '
                    f'http={response.status}, schema={config["schema"]}, table={config["table"]}'
                )
                if body:
                    print(f'[{config["name"]}] response_bytes={len(body.encode("utf-8"))}')
                return True
        except urllib.error.HTTPError as exc:
            body = exc.read()
            message = f'[{config["name"]}] keepalive failed: http={exc.code}'
            if body:
                message = f"{message}, response_bytes={len(body)}"
            if exc.code == 540:
                message = f"{message}。项目已暂停，请先在 Supabase Dashboard 恢复"
            raise ValueError(message) from exc
        except urllib.error.URLError as exc:
            raise ValueError(f'[{config["name"]}] 请求失败: {exc.reason}') from exc
        except Exception as exc:
            raise ValueError(f'[{config["name"]}] 请求失败: {exc}') from exc


def main() -> None:
    summary = run_account_scripts(__file__, Script, notify_module=notify)
    raise SystemExit(summary.exit_code)


if __name__ == "__main__":
    main()
