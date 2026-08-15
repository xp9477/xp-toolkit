"""
仓库公共工具。

职责：
1. 以脚本文件名作为环境变量名加载配置
2. 统一解析单账号、多账号和顶层 accounts 配置
3. 提供活跃脚本通用的主入口执行逻辑
4. 为子目录脚本提供仓库根目录导入辅助
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT_DIR = Path(__file__).resolve().parent
SCRIPT_SUFFIXES = {".py", ".js", ".sh"}
TEMP_SUFFIXES = {".swap", ".tmp", ".bak"}


class ConfigError(ValueError):
    """配置或入口初始化错误。"""


def parse_bool(value: Any, *, default: bool, field_name: str) -> bool:
    """严格解析配置布尔值，避免字符串 ``"false"`` 被当成真值。"""
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    raise ConfigError(f"{field_name} 必须为布尔值")


def validate_service_origin(
    value: Any,
    *,
    field_name: str = "url",
    allow_http: bool = False,
) -> str:
    """校验并规范化携带凭据的服务根地址。"""
    raw = str(value or "").strip()
    if not raw:
        raise ConfigError(f"缺少 {field_name}")
    if any(character.isspace() for character in raw):
        raise ConfigError(f"{field_name} 不能包含空白字符")

    parsed = urlparse(raw)
    if parsed.scheme not in {"https", "http"} or not parsed.hostname:
        raise ConfigError(f"{field_name} 必须是有效的 HTTP(S) 根地址")
    if parsed.username is not None or parsed.password is not None:
        raise ConfigError(f"{field_name} 不能包含用户名或密码")
    if parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise ConfigError(f"{field_name} 只能包含 scheme、主机和端口")
    try:
        _ = parsed.port
    except ValueError as exc:
        raise ConfigError(f"{field_name} 端口无效") from exc
    if parsed.scheme != "https" and not allow_http:
        raise ConfigError(f"{field_name} 必须使用 HTTPS")

    return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")


@dataclass
class FailureRecord:
    display_name: str
    error: str


@dataclass
class RunSummary:
    script_name: str
    total_count: int
    success_count: int
    failures: list[FailureRecord] = field(default_factory=list)

    @property
    def failure_count(self) -> int:
        return len(self.failures)

    @property
    def exit_code(self) -> int:
        return 0 if self.failure_count == 0 else 1

    @property
    def first_error(self) -> str:
        if not self.failures:
            return ""
        return self.failures[0].error

    def failure_names(self, limit: int = 5) -> str:
        if not self.failures:
            return ""

        names = [record.display_name for record in self.failures[:limit]]
        if self.failure_count > limit:
            names.append(f"等 {self.failure_count} 项")
        return "、".join(names)


def add_repo_root_to_path(file_path: str | os.PathLike[str]) -> Path:
    """确保脚本可导入仓库根目录下的模块。"""
    file_path = Path(file_path).resolve()
    current = file_path.parent

    while current != current.parent:
        if (current / "common.py").exists():
            if str(current) not in sys.path:
                sys.path.insert(0, str(current))
            return current
        current = current.parent

    if str(ROOT_DIR) not in sys.path:
        sys.path.insert(0, str(ROOT_DIR))
    return ROOT_DIR


def get_script_env_name(file_path: str | os.PathLike[str]) -> str:
    """根据脚本文件路径获取环境变量名。"""
    name = Path(file_path).resolve().name

    while True:
        stem, suffix = os.path.splitext(name)
        if not suffix:
            return name
        if suffix.lower() in SCRIPT_SUFFIXES | TEMP_SUFFIXES:
            name = stem
            continue
        return name


def get_env(key: str, default: str | None = None, required: bool = False) -> str | None:
    """读取环境变量。"""
    value = os.getenv(key, default)
    if required and not value:
        raise ConfigError(f"缺少必需的环境变量: {key}")
    return value


def _read_script_env(file_path: str | os.PathLike[str], required: bool = True) -> tuple[str, str | None]:
    env_name = get_script_env_name(file_path)
    value = get_env(env_name)

    if value is None:
        if required:
            raise ConfigError(f"缺少必需的环境变量: {env_name}")
        return env_name, None

    value = value.strip()
    if required and not value:
        raise ConfigError(f"环境变量 {env_name} 不能为空")
    return env_name, value


def _parse_json(value: str, env_name: str) -> Any:
    try:
        return json.loads(value)
    except json.JSONDecodeError as exc:
        raise ConfigError(f"解析环境变量 {env_name} 失败: {exc}") from exc


def load_config(file_path: str | os.PathLike[str], required: bool = True) -> Any:
    """从与脚本同名的环境变量加载 JSON 配置。"""
    env_name, value = _read_script_env(file_path, required=required)
    if value is None:
        return None
    return _parse_json(value, env_name)


def _append_account(accounts: list[dict[str, Any]], item: Any, env_name: str, index: int | None = None) -> None:
    if isinstance(item, dict):
        accounts.append(item)
        return

    position = f"第 {index} 项" if index is not None else "配置项"
    print(f"{env_name} 的 {position} 需要为 JSON 对象，实际得到 {type(item).__name__}")


def load_accounts(file_path: str | os.PathLike[str]) -> list[dict[str, Any]]:
    """
    加载账号列表，支持：
    1. 单个 JSON 对象
    2. JSON 数组
    3. 顶层 JSON 对象包含 accounts 数组
    4. 每行一个 JSON 对象
    """
    env_name, value = _read_script_env(file_path, required=True)
    assert value is not None

    accounts: list[dict[str, Any]] = []

    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        parsed = None

    if parsed is not None:
        if isinstance(parsed, dict):
            if isinstance(parsed.get("accounts"), list):
                for index, item in enumerate(parsed["accounts"], 1):
                    _append_account(accounts, item, env_name, index)
            else:
                accounts.append(parsed)
        elif isinstance(parsed, list):
            for index, item in enumerate(parsed, 1):
                _append_account(accounts, item, env_name, index)
        else:
            raise ConfigError(f"{env_name} 需要为 JSON 对象、数组或按行 JSON")
    else:
        for line_number, line in enumerate(value.splitlines(), 1):
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as exc:
                print(f"解析环境变量 {env_name} 第 {line_number} 行失败: {exc}")
                # 配置行通常包含 cookie、密码或 API key，不能把原文写进任务日志。
                print(f"问题内容已隐藏（{len(line)} 字符）")
                continue
            _append_account(accounts, item, env_name, line_number)

    if not accounts:
        raise ConfigError(f"环境变量 {env_name} 中未找到有效账号配置")

    return accounts


def require_fields(data: dict[str, Any], *fields: str) -> None:
    """校验配置字段。"""
    missing = [field for field in fields if not data.get(field)]
    if missing:
        raise ValueError(f"缺少字段: {', '.join(missing)}")


def account_display_name(account: dict[str, Any], index: int) -> str:
    """生成账号展示名。"""
    for key in ("username", "name", "uid", "phone"):
        value = account.get(key)
        if value:
            return str(value)
    return f"账号 #{index}"


def safe_notify(notify_module: Any, title: str, content: str) -> None:
    """安全发送通知。"""
    if notify_module is None:
        return
    try:
        notify_module.send(title, content)
    except Exception:
        pass


def normalize_exception(exc: BaseException) -> str:
    """将异常转换为适合通知和日志的短文本。"""
    if isinstance(exc, SystemExit):
        code = exc.code
        if isinstance(code, str) and code.strip():
            return code.strip()
        if isinstance(code, int) and code != 0:
            return f"脚本以退出码 {code} 结束"
        return "脚本提前退出"

    message = str(exc).strip()
    return message or exc.__class__.__name__


def build_failure_notification(summary: RunSummary) -> str:
    """构造脚本失败汇总通知内容。"""
    lines = [
        f"脚本: {summary.script_name}",
        f"失败: {summary.failure_count}/{summary.total_count}",
    ]

    names = summary.failure_names()
    if names:
        lines.append(f"失败项: {names}")

    first_error = summary.first_error
    if first_error:
        lines.append(f"首个错误: {first_error}")

    return "\n".join(lines)


def _finalize_run(
    file_path: str | os.PathLike[str],
    total_count: int,
    success_count: int,
    failures: list[FailureRecord],
    notify_module: Any,
) -> RunSummary:
    summary = RunSummary(
        script_name=get_script_env_name(file_path),
        total_count=total_count,
        success_count=success_count,
        failures=failures,
    )

    print(f"执行完成: {summary.success_count}/{summary.total_count} 个成功")
    if summary.failure_count:
        safe_notify(
            notify_module,
            f"{summary.script_name} 执行失败",
            build_failure_notification(summary),
        )
    return summary


def _run_failure_summary(
    file_path: str | os.PathLike[str],
    error: BaseException,
    notify_module: Any,
    *,
    display_name: str = "配置/入口",
) -> RunSummary:
    message = normalize_exception(error)
    print(f"{display_name} 执行失败: {message}")
    return _finalize_run(
        file_path,
        total_count=1,
        success_count=0,
        failures=[FailureRecord(display_name=display_name, error=message)],
        notify_module=notify_module,
    )


def run_single_script(
    file_path: str | os.PathLike[str],
    runner: Callable[[], Any],
    *,
    notify_module: Any = None,
    display_name: str = "主流程",
) -> RunSummary:
    """统一执行单脚本入口，并在失败时发送汇总通知。"""
    try:
        result = runner()
    except SystemExit as exc:
        return _run_failure_summary(
            file_path,
            exc,
            notify_module,
            display_name=display_name,
        )
    except Exception as exc:
        return _run_failure_summary(
            file_path,
            exc,
            notify_module,
            display_name=display_name,
        )

    if result is False:
        return _run_failure_summary(
            file_path,
            RuntimeError("脚本返回失败"),
            notify_module,
            display_name=display_name,
        )

    return _finalize_run(file_path, total_count=1, success_count=1, failures=[], notify_module=notify_module)


def run_account_scripts(
    file_path: str | os.PathLike[str],
    script_factory: Callable[[dict[str, Any]], Any],
    *,
    notify_module: Any = None,
) -> RunSummary:
    """
    统一执行账号脚本。

    script_factory 返回的对象需要实现 run()，并以 False 表示失败。
    """
    try:
        accounts = load_accounts(file_path)
    except Exception as exc:
        return _run_failure_summary(file_path, exc, notify_module)

    success_count = 0
    failures: list[FailureRecord] = []

    for index, account in enumerate(accounts, 1):
        display_name = account_display_name(account, index)
        try:
            result = script_factory(account).run()
        except SystemExit as exc:
            message = normalize_exception(exc)
            print(f"账号执行失败 - {display_name}, 错误: {message}")
            failures.append(FailureRecord(display_name=display_name, error=message))
            continue
        except Exception as exc:
            message = normalize_exception(exc)
            print(f"账号执行失败 - {display_name}, 错误: {message}")
            failures.append(FailureRecord(display_name=display_name, error=message))
            continue

        if result is False:
            message = "脚本返回失败"
            print(f"账号执行失败 - {display_name}, 错误: {message}")
            failures.append(FailureRecord(display_name=display_name, error=message))
            continue

        success_count += 1

    return _finalize_run(
        file_path,
        total_count=len(accounts),
        success_count=success_count,
        failures=failures,
        notify_module=notify_module,
    )


async def _run_async_account(
    index: int,
    account: dict[str, Any],
    script_factory: Callable[[dict[str, Any]], Any],
) -> tuple[bool, FailureRecord | None]:
    display_name = account_display_name(account, index)

    try:
        result = script_factory(account).run()
        if asyncio.iscoroutine(result):
            result = await result
    except SystemExit as exc:
        message = normalize_exception(exc)
        print(f"账号执行失败 - {display_name}, 错误: {message}")
        return False, FailureRecord(display_name=display_name, error=message)
    except Exception as exc:
        message = normalize_exception(exc)
        print(f"账号执行失败 - {display_name}, 错误: {message}")
        return False, FailureRecord(display_name=display_name, error=message)

    if result is False:
        message = "脚本返回失败"
        print(f"账号执行失败 - {display_name}, 错误: {message}")
        return False, FailureRecord(display_name=display_name, error=message)

    return True, None


async def run_async_account_scripts(
    file_path: str | os.PathLike[str],
    script_factory: Callable[[dict[str, Any]], Any],
    *,
    notify_module: Any = None,
    concurrent: bool = False,
) -> RunSummary:
    """统一执行异步账号脚本。"""
    try:
        accounts = load_accounts(file_path)
    except Exception as exc:
        return _run_failure_summary(file_path, exc, notify_module)

    tasks = [
        _run_async_account(index, account, script_factory)
        for index, account in enumerate(accounts, 1)
    ]
    if concurrent:
        results = await asyncio.gather(*tasks)
    else:
        results = []
        for task in tasks:
            results.append(await task)

    success_count = sum(1 for success, _ in results if success)
    failures = [record for _, record in results if record is not None]

    return _finalize_run(
        file_path,
        total_count=len(accounts),
        success_count=success_count,
        failures=failures,
        notify_module=notify_module,
    )
