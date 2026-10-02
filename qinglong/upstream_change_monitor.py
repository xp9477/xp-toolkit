"""
name: 综合变更与更新监控
cron: 0 */6 * * *
description: 统一监控第三方上游脚本与 App Store 应用版本更新，安全隔离未审核代码并推送 Bark 提醒

env:
- `upstream_change_monitor`: JSON 字符串或对象，配置待监控的源列表（支持脚本 URL 与 App Store 应用）。
  例如:
  {
    "sources": [
      {
        "id": "yanxuan_daily_sign",
        "type": "script",
        "name": "网易严选每日签到",
        "url": "https://raw.githubusercontent.com/ddgksf2013/Scripts/refs/heads/master/yanxuan_daily_sign.js",
        "enabled": true
      },
      {
        "id": "yunding_app",
        "type": "app_store",
        "name": "云顶攻略助手",
        "bundle_id": "cloud.miplus.tft",
        "country": "cn",
        "enabled": true
      }
    ]
  }
- `UPSTREAM_MONITOR_STATE_FILE`: 状态文件路径（默认青龙 data 目录或 ~/.qinglong/，不纳入 git）
- `UPSTREAM_MONITOR_ALLOW_DOMAINS`: 允许的上游来源域名（默认 raw.githubusercontent.com, gist.githubusercontent.com）
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests

ROOT_DIR = Path(__file__).resolve().parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import notify
from common import ConfigError, get_env, load_config, run_single_script

REQUEST_TIMEOUT = 15
MAX_SNAPSHOT_SIZE = 5 * 1024 * 1024  # 单个脚本快照上限 5MB，防 DoS
MAX_DIFF_LINES = 1000
MAX_DIFF_CHARS = 100_000
SOURCE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_.-]{1,64}$")

DEFAULT_ALLOWED_DOMAINS = {
    "raw.githubusercontent.com",
    "gist.githubusercontent.com",
}


@dataclass
class UpstreamSource:
    id: str
    name: str
    url: str = ""
    enabled: bool = True
    type: str = "script"  # "script" | "app_store"
    bundle_id: str = ""
    app_id: str = ""
    country: str = "cn"


@dataclass
class ChangeResult:
    source_id: str
    source_name: str
    status: str
    changed: bool
    notified: bool
    latest_hash: str
    reviewed_hash: str
    message: str


def validate_source_id(source_id: str) -> str:
    """校验 source_id，严防路径穿越与非法字符。"""
    raw = (source_id or "").strip()
    if not SOURCE_ID_PATTERN.fullmatch(raw) or ".." in raw or raw.startswith("."):
        raise ConfigError(
            f"非法的 source_id [{raw}]: 仅允许 1-64 位英文字母、数字、点号、下划线和连字符，严禁路径穿越字符"
        )
    return raw


def get_allowed_domains() -> set[str]:
    """获取允许的上游源码域名白名单。"""
    custom = get_env("UPSTREAM_MONITOR_ALLOW_DOMAINS", required=False)
    if custom:
        domains = {d.strip().lower() for d in custom.split(",") if d.strip()}
        if domains:
            return domains
    return set(DEFAULT_ALLOWED_DOMAINS)


def validate_upstream_url(url: str, allowed_domains: set[str] | None = None) -> str:
    """
    严格校验上游脚本 URL：
    - 仅允许 HTTPS
    - 域名必须在白名单内（默认仅允许 GitHub raw 等已知来源）
    - 严禁携带用户名或密码凭据
    - 严禁包含查询参数或片段（防 token/secret 泄露）
    - 严禁非标准协议或空路径
    """
    raw = (url or "").strip()
    if not raw:
        raise ConfigError("上游脚本 URL 不能为空")
    if any(c.isspace() for c in raw):
        raise ConfigError("上游脚本 URL 不能包含空白字符")

    parsed = urlparse(raw)
    if parsed.scheme.lower() != "https":
        raise ConfigError(f"上游脚本 URL 必须使用 HTTPS: {raw}")
    if parsed.username or parsed.password:
        raise ConfigError("上游脚本 URL 禁止包含凭据信息 (username/password)")
    if parsed.query or parsed.fragment:
        raise ConfigError("上游脚本 URL 禁止包含查询参数或片段，防止凭据泄露")
    if not parsed.hostname:
        raise ConfigError(f"无效的 URL 域名: {raw}")

    domains = allowed_domains or get_allowed_domains()
    hostname = parsed.hostname.lower()
    if hostname not in domains:
        raise ConfigError(f"上游域名 [{hostname}] 不在安全白名单内: {sorted(domains)}")

    if not parsed.path or parsed.path == "/":
        raise ConfigError("上游脚本 URL 必须包含具体脚本文件路径")

    return raw


def get_default_state_path() -> Path:
    """
    获取监控状态持久化文件路径。
    优先青龙 data 或系统用户 HOME 下，确保绝不落在 git 跟踪工作区。
    """
    env_file = get_env("UPSTREAM_MONITOR_STATE_FILE", required=False)
    if env_file:
        return Path(env_file).resolve()

    # 优先青龙标准环境变量 QL_DIR，如 /ql
    ql_dir = os.getenv("QL_DIR")
    if ql_dir:
        candidate = Path(ql_dir) / "data" / "upstream_change_monitor.json"
        return candidate.resolve()

    # 标准青龙容器内的 /ql/data 目录
    ql_data = Path("/ql/data")
    if ql_data.is_dir():
        return (ql_data / "upstream_change_monitor.json").resolve()

    # 本地或非容器环境: 家目录下的 ~/.qinglong
    home_dir = Path.home() / ".qinglong"
    return (home_dir / "upstream_change_monitor.json").resolve()


def get_quarantine_dir(state_path: Path) -> Path:
    """
    返回隔离暂存目录，用于保存未审阅上游版本快照以供 diff 对比。
    独立于青龙运行目录，绝不执行此目录中的代码。
    """
    quarantine = state_path.parent / "upstream_quarantine"
    quarantine.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(quarantine, 0o700)
    except OSError:
        pass
    return quarantine


def load_state(state_path: Path) -> dict[str, Any]:
    """
    读取持久化状态文件。
    安全原则：若状态文件存在但损坏或格式非法，必须严格 Fail-Closed（抛出异常阻断运行），
    绝对不能静默重置为空状态，防止把已被篡改的上游脚本自动当成新基线信任。
    """
    if not state_path.exists():
        return {"version": 1, "sources": {}}

    try:
        with open(state_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as exc:
        raise ConfigError(
            f"状态文件 JSON 解析损坏: {state_path} ({exc})，已安全阻断，拒绝静默重建基线"
        ) from exc
    except OSError as exc:
        raise RuntimeError(f"读取状态文件 IO 失败: {state_path} ({exc})") from exc

    if not isinstance(data, dict) or not isinstance(data.get("sources"), dict):
        raise ConfigError(
            f"状态文件结构非法 (缺少有效的 sources 字典): {state_path}，已安全阻断"
        )

    return data


def save_state(state_path: Path, data: dict[str, Any]) -> None:
    """原子化保存状态文件，严格限制文件权限为 0600。"""
    state_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = state_path.with_suffix(f".tmp.{os.getpid()}")
    content = json.dumps(data, ensure_ascii=False, indent=2)

    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    fd = os.open(temp_path, flags, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        temp_path.replace(state_path)
        try:
            os.chmod(state_path, 0o600)
        except OSError:
            pass
    except Exception:
        if temp_path.exists():
            temp_path.unlink()
        raise


def load_configured_sources() -> list[UpstreamSource]:
    """
    统一加载监控源配置：
    1. 优先读取脚本同名环境变量 `upstream_change_monitor`
    2. 其次读取环境变量 `UPSTREAM_MONITOR_SOURCES`
    3. 再次读取 `UPSTREAM_SOURCES_PATH` 指定的 JSON 文件
    4. 兜底尝试读取本地示例配置 `upstream_sources.example.json`（若启用需明确提示未经人工审阅）
    """
    raw_cfg = load_config(__file__, required=False)

    if raw_cfg is None:
        env_sources = get_env("UPSTREAM_MONITOR_SOURCES", required=False)
        if env_sources:
            try:
                raw_cfg = json.loads(env_sources)
            except json.JSONDecodeError as exc:
                raise ConfigError(f"UPSTREAM_MONITOR_SOURCES JSON 解析失败: {exc}")

    if raw_cfg is None:
        file_path_env = get_env("UPSTREAM_SOURCES_PATH", required=False)
        target_file = (
            Path(file_path_env)
            if file_path_env
            else (ROOT_DIR / "upstream_sources.example.json")
        )
        if target_file.exists():
            try:
                with open(target_file, "r", encoding="utf-8") as f:
                    raw_cfg = json.load(f)
                    print(
                        f"[提示] 未检测到生产配置，已加载示例配置文件: {target_file.name}（需人工审核后方可启用）"
                    )
            except (json.JSONDecodeError, OSError) as exc:
                raise ConfigError(f"读取上游配置文件 {target_file} 失败: {exc}")

    if raw_cfg is None:
        raise ConfigError(
            "未找到上游监控配置，请配置环境变量 `upstream_change_monitor` 或提供配置文件"
        )

    raw_list: list[dict[str, Any]] = []
    if isinstance(raw_cfg, list):
        raw_list = raw_cfg
    elif isinstance(raw_cfg, dict):
        if "sources" in raw_cfg and isinstance(raw_cfg["sources"], list):
            raw_list = raw_cfg["sources"]
        else:
            raw_list = [raw_cfg]
    else:
        raise ConfigError("上游配置必须为 JSON 对象或列表")

    sources: list[UpstreamSource] = []
    # 额外兼容顶层 apps 配置
    if isinstance(raw_cfg, dict) and "apps" in raw_cfg and isinstance(raw_cfg["apps"], list):
        for app_item in raw_cfg["apps"]:
            if isinstance(app_item, dict):
                app_item["type"] = "app_store"
                raw_list.append(app_item)

    for idx, item in enumerate(raw_list, 1):
        if not isinstance(item, dict):
            continue
        source_type = str(item.get("type") or "").strip().lower()
        url = str(item.get("url") or "").strip()
        bundle_id = str(item.get("bundle_id") or "").strip()
        app_id = str(item.get("app_id") or "").strip()

        # 判断是否为 App Store 监控源
        if source_type in ("app_store", "app", "ios_app") or (bundle_id or app_id):
            source_type = "app_store"
            if not bundle_id and not app_id:
                raise ConfigError("App Store 监控源必须提供 bundle_id 或 app_id")
            raw_id = str(item.get("id") or bundle_id or app_id or f"app_{idx}").strip()
            source_id = validate_source_id(raw_id)
            name = str(item.get("name") or source_id).strip()
            country = str(item.get("country") or "cn").strip()
            enabled = bool(item.get("enabled", True))
            sources.append(
                UpstreamSource(
                    id=source_id,
                    name=name,
                    type=source_type,
                    bundle_id=bundle_id,
                    app_id=app_id,
                    country=country,
                    enabled=enabled,
                )
            )
        else:
            source_type = "script"
            if not url:
                continue
            validated_url = validate_upstream_url(url)
            raw_id = str(item.get("id") or f"source_{idx}").strip()
            source_id = validate_source_id(raw_id)
            name = str(item.get("name") or source_id).strip()
            enabled = bool(item.get("enabled", True))
            sources.append(
                UpstreamSource(
                    id=source_id,
                    name=name,
                    type=source_type,
                    url=validated_url,
                    enabled=enabled,
                )
            )

    if not sources:
        raise ConfigError("未能解析到任何有效的上游监控源")

    return sources


def fetch_upstream_content(
    url: str, session: requests.Session | None = None
) -> tuple[bytes, str]:
    """
    安全拉取上游源码作为纯文本数据：
    - 流式读取并限制最大大小，防 DoS / 压缩炸弹
    - 绝不执行拉取的任何代码，仅计算哈希并留存隔离快照
    """
    req = session or requests
    headers = {
        "User-Agent": "xp-toolkit-upstream-monitor/1.0",
        "Accept": "text/plain, application/javascript, */*",
    }
    resp = req.get(
        url,
        headers=headers,
        timeout=REQUEST_TIMEOUT,
        allow_redirects=False,
        stream=True,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"获取上游文件失败 (HTTP {resp.status_code}): {url}")

    chunks: list[bytes] = []
    total_bytes = 0
    for chunk in resp.iter_content(chunk_size=65536):
        total_bytes += len(chunk)
        if total_bytes > MAX_SNAPSHOT_SIZE:
            raise RuntimeError(
                f"上游文件大小超过安全上限 ({MAX_SNAPSHOT_SIZE} 字节)，拒绝下载"
            )
        chunks.append(chunk)

    content_bytes = b"".join(chunks)
    content_hash = hashlib.sha256(content_bytes).hexdigest()
    return content_bytes, content_hash


def _save_snapshot(
    quarantine_dir: Path, source_id: str, content_hash: str, content_bytes: bytes
) -> Path:
    """安全保存快照到隔离区（以 .snapshot 为后缀，0600 权限，绝无执行权限）。"""
    validate_source_id(source_id)
    file_path = quarantine_dir / f"{source_id}_{content_hash[:12]}.snapshot"
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    fd = os.open(file_path, flags, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(content_bytes)
    try:
        os.chmod(file_path, 0o600)
    except OSError:
        pass
    return file_path


def format_change_notification(
    source: UpstreamSource, old_hash: str, new_hash: str, content_len: int
) -> tuple[str, str]:
    """
    格式化 Bark 通知内容。
    绝对不包含任何敏感 token、cookie 或凭据。
    """
    title = f"上游脚本变更待审: {source.name}"
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    old_display = old_hash[:8] if old_hash else "未审核(无)"
    new_display = new_hash[:8]
    body = (
        f"【第三方脚本变更待人工审核】\n"
        f"名称: {source.name}\n"
        f"地址: {source.url}\n"
        f"版本: {old_display}... -> {new_display}...\n"
        f"大小: {content_len:,} 字节\n"
        f"时间: {now_str}\n"
        f"⚠️ 安全拦截: 已隔离暂存，严禁自动合并或执行。请人工审核 diff 并显式传入预期哈希批准。"
    )
    return title, body


def check_app_store_source(
    source: UpstreamSource,
    state: dict[str, Any],
    session: requests.Session | None = None,
    notifier: Any = notify,
) -> ChangeResult:
    """
    检查单个 App Store 应用版本更新：
    1. 查询 Apple iTunes Lookup API (bundleId 或 appId)
    2. 首次发现建立基线版本记录
    3. 检测到版本更新时推送 Bark 通知并去重
    """
    validate_source_id(source.id)
    now_iso = datetime.now(timezone.utc).isoformat()
    req = session or requests

    if source.bundle_id:
        param = f"bundleId={source.bundle_id}"
    elif source.app_id:
        param = f"id={source.app_id}"
    else:
        raise ConfigError(f"App Store 源 [{source.name}] 缺少 bundle_id 或 app_id")

    url = f"https://itunes.apple.com/lookup?{param}&country={source.country}"
    resp = req.get(
        url,
        headers={"User-Agent": "xp-toolkit-app-monitor/1.0"},
        timeout=REQUEST_TIMEOUT,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"App Store 查询失败 (HTTP {resp.status_code}): {url}")

    data = resp.json()
    if not isinstance(data, dict) or data.get("resultCount", 0) == 0:
        raise ValueError(f"App Store 未检索到应用信息 ({param})")

    results = data.get("results", [])
    if not results or not isinstance(results[0], dict):
        raise ValueError(f"App Store 响应数据格式异常: {data}")

    app_info = results[0]
    latest_version = str(app_info.get("version", "")).strip()
    track_name = str(app_info.get("trackName", source.name)).strip()
    release_date = str(app_info.get("currentVersionReleaseDate", "")).strip()
    release_notes = str(app_info.get("releaseNotes", "无更新日志")).strip()
    track_view_url = str(app_info.get("trackViewUrl", "")).strip()

    sources_state = state.setdefault("sources", {})
    record = sources_state.get(source.id)

    if not record:
        sources_state[source.id] = {
            "id": source.id,
            "type": "app_store",
            "name": source.name,
            "track_name": track_name,
            "bundle_id": source.bundle_id,
            "app_id": source.app_id,
            "status": "BASELINE_ESTABLISHED",
            "version": latest_version,
            "baseline_version": latest_version,
            "latest_version": latest_version,
            "last_notified_version": latest_version,
            "last_checked_at": now_iso,
            "last_changed_at": now_iso,
            "release_date": release_date,
            "track_url": track_view_url,
        }
        msg = f"首次监控建立基线版本 (v{latest_version})"
        print(f"[基线建立] [{source.name}] {msg}")
        return ChangeResult(
            source_id=source.id,
            source_name=source.name,
            status="BASELINE_ESTABLISHED",
            changed=False,
            notified=False,
            latest_hash=latest_version,
            reviewed_hash=latest_version,
            message=msg,
        )

    record["last_checked_at"] = now_iso
    prev_version = str(record.get("version") or "").strip()
    last_notified_version = str(record.get("last_notified_version") or "").strip()

    if prev_version and latest_version == prev_version:
        msg = f"应用版本无更新，当前版本: v{latest_version}"
        print(f"[未变更] [{source.name}] {msg}")
        return ChangeResult(
            source_id=source.id,
            source_name=source.name,
            status="UNCHANGED",
            changed=False,
            notified=False,
            latest_hash=latest_version,
            reviewed_hash=prev_version,
            message=msg,
        )

    record["status"] = "UPDATED"
    record["latest_version"] = latest_version
    record["last_changed_at"] = now_iso
    record["release_date"] = release_date
    record["release_notes"] = release_notes

    if last_notified_version == latest_version:
        msg = f"应用版本 (v{latest_version}) 变更此前已成功通知"
        print(f"[已通知] [{source.name}] {msg}")
        return ChangeResult(
            source_id=source.id,
            source_name=source.name,
            status="PENDING_ALREADY_NOTIFIED",
            changed=True,
            notified=False,
            latest_hash=latest_version,
            reviewed_hash=prev_version,
            message=msg,
        )

    title = f"【应用更新提醒】{source.name} 发布新版本 v{latest_version}"
    body = (
        f"应用名称: {track_name}\n"
        f"旧版本: v{prev_version}\n"
        f"新版本: v{latest_version}\n"
        f"发布时间: {release_date}\n"
        f"商店链接: {track_view_url}\n\n"
        f"【更新说明】\n{release_notes}\n"
    )
    if "cloud.miplus.tft" in (source.bundle_id or "") or "yunding" in source.id.lower():
        body += "\n【去广告提示】\n获取新版脱壳 ipa 后，运行 inject_hook.py 即可一键自动注入通用去广告 dylib。"

    notify_ok = False
    try:
        notify_ok = bool(notifier.send(title, body, group="app-update"))
    except Exception as exc:
        print(f"[推送异常] [{source.name}] 调用 Bark 异常: {exc}")
        notify_ok = False

    if notify_ok:
        record["last_notified_version"] = latest_version
        record["version"] = latest_version
        record["last_notified_at"] = now_iso
        msg = f"应用更新检测成功，已推送 Bark 通知 (旧:v{prev_version} -> 新:v{latest_version})"
        print(f"[通知成功] [{source.name}] {msg}")
        return ChangeResult(
            source_id=source.id,
            source_name=source.name,
            status="CHANGED_AND_NOTIFIED",
            changed=True,
            notified=True,
            latest_hash=latest_version,
            reviewed_hash=prev_version,
            message=msg,
        )
    else:
        msg = f"应用更新检测成功，但 Bark 通知失败，保留未通知状态下次重试 (v{latest_version})"
        print(f"[通知失败] [{source.name}] {msg}")
        return ChangeResult(
            source_id=source.id,
            source_name=source.name,
            status="CHANGED_NOTIFY_FAILED",
            changed=True,
            notified=False,
            latest_hash=latest_version,
            reviewed_hash=prev_version,
            message=msg,
        )


def check_source(
    source: UpstreamSource,
    state: dict[str, Any],
    quarantine_dir: Path,
    session: requests.Session | None = None,
    notifier: Any = notify,
) -> ChangeResult:
    """
    检查单个上游源的状态：
    1. 首次上线：建立初始基线，但【绝不标记为已审阅】（reviewed_hash=''，pending_review=True），
       避免未审核直接越权；通知去重置为当前哈希避免初次打扰，但 --list-pending 必须可见；
    2. 后续运行：哈希不一致时检测到变更，标记待审 (pending_review=True)；
    3. 通知去重：若该哈希已成功通知过，不重复调用 Bark；
    4. Bark 失败防护：Bark 发送失败绝不能提前更新已通知哈希，下次重试。
    """
    validate_source_id(source.id)
    if source.type == "app_store":
        return check_app_store_source(source, state, session=session, notifier=notifier)

    now_iso = datetime.now(timezone.utc).isoformat()
    content_bytes, current_hash = fetch_upstream_content(source.url, session=session)
    sources_state = state.setdefault("sources", {})
    record = sources_state.get(source.id)

    # 首次上线 / 首次发现该源：建立基线，但保持未审阅与待审状态
    if not record:
        _save_snapshot(quarantine_dir, source.id, current_hash, content_bytes)
        sources_state[source.id] = {
            "id": source.id,
            "name": source.name,
            "url": source.url,
            "status": "BASELINE_PENDING",
            "pending_review": True,  # 安全核心：必须标记为待审核
            "baseline_hash": current_hash,
            "reviewed_hash": "",  # 安全核心：未经人工显式确认，reviewed_hash 绝不自充填
            "latest_hash": current_hash,
            "last_notified_hash": current_hash,  # 置为当前版本，避免上线首次产生噪音通知
            "last_checked_at": now_iso,
            "last_changed_at": now_iso,
            "last_notified_at": None,
            "content_length": len(content_bytes),
            "review_note": "首次基线建立，待人工初审",
        }
        msg = f"首次监控建立基线版本 (SHA: {current_hash[:8]})，已标记为待审核 (pending_review=True)，不发送变更通知"
        print(f"[基线建立] [{source.name}] {msg}")
        return ChangeResult(
            source_id=source.id,
            source_name=source.name,
            status="BASELINE_ESTABLISHED",
            changed=False,
            notified=False,
            latest_hash=current_hash,
            reviewed_hash="",
            message=msg,
        )

    # 更新元数据
    record["last_checked_at"] = now_iso
    reviewed_hash = record.get("reviewed_hash", "")
    last_notified_hash = record.get("last_notified_hash", "")

    # 内容未变更且已获得人工审阅批准
    if reviewed_hash and current_hash == reviewed_hash:
        record["status"] = "REVIEWED"
        record["pending_review"] = False
        record["latest_hash"] = current_hash
        msg = f"上游无变更，与已审阅版本一致 ({current_hash[:8]})"
        print(f"[未变更] [{source.name}] {msg}")
        return ChangeResult(
            source_id=source.id,
            source_name=source.name,
            status="UNCHANGED",
            changed=False,
            notified=False,
            latest_hash=current_hash,
            reviewed_hash=reviewed_hash,
            message=msg,
        )

    # 检测到上游变更（或初始基线尚未被审阅）
    record["status"] = "PENDING_REVIEW"
    record["pending_review"] = True
    record["latest_hash"] = current_hash
    record["last_changed_at"] = now_iso
    record["content_length"] = len(content_bytes)
    _save_snapshot(quarantine_dir, source.id, current_hash, content_bytes)

    # 去重检查：如果该哈希已成功推送到 Bark，跳过重复推送
    if last_notified_hash == current_hash:
        msg = f"上游版本 ({current_hash[:8]}) 变更此前已成功通知，等待人工审核"
        print(f"[待审核] [{source.name}] {msg}")
        return ChangeResult(
            source_id=source.id,
            source_name=source.name,
            status="PENDING_ALREADY_NOTIFIED",
            changed=True,
            notified=False,
            latest_hash=current_hash,
            reviewed_hash=reviewed_hash,
            message=msg,
        )

    # 需要发送 Bark 通知
    title, body = format_change_notification(
        source, reviewed_hash, current_hash, len(content_bytes)
    )
    notify_ok = False
    try:
        notify_ok = bool(notifier.send(title, body, group="upstream-monitor"))
    except Exception as exc:
        print(f"[推送异常] [{source.name}] 调用 Bark 异常: {exc}")
        notify_ok = False

    # 关键安全规则：Bark 失败绝不能提前更新已通知版本
    if notify_ok:
        record["last_notified_hash"] = current_hash
        record["last_notified_at"] = now_iso
        msg = f"上游变更检测成功，已推送 Bark 通知 (旧:{reviewed_hash[:8] or '无'} -> 新:{current_hash[:8]})"
        print(f"[通知成功] [{source.name}] {msg}")
        return ChangeResult(
            source_id=source.id,
            source_name=source.name,
            status="CHANGED_AND_NOTIFIED",
            changed=True,
            notified=True,
            latest_hash=current_hash,
            reviewed_hash=reviewed_hash,
            message=msg,
        )
    else:
        msg = f"上游变更检测成功，但 Bark 通知失败，保留未通知状态下次重试 ({current_hash[:8]})"
        print(f"[通知失败] [{source.name}] {msg}")
        return ChangeResult(
            source_id=source.id,
            source_name=source.name,
            status="CHANGED_NOTIFY_FAILED",
            changed=True,
            notified=False,
            latest_hash=current_hash,
            reviewed_hash=reviewed_hash,
            message=msg,
        )


# ==========================================
# 人工审核与扩展集成接口（绝不自动执行/自动合并）
# ==========================================

ReviewHookType = Callable[[dict[str, Any], str, str], Any]
_REGISTERED_AI_REVIEW_HOOK: ReviewHookType | None = None


def register_ai_review_hook(hook: ReviewHookType | None) -> None:
    """
    注册外部 AI 安全审查回调接口（默认不调用、不自动合并）。
    签名: hook(source_info: dict, reviewed_content: str, latest_content: str) -> Any
    """
    global _REGISTERED_AI_REVIEW_HOOK
    _REGISTERED_AI_REVIEW_HOOK = hook


def get_pending_sources(state_path: Path | None = None) -> list[dict[str, Any]]:
    """
    获取所有存在未审核上游变更或初始基线未审核的脚本记录。
    确保首次建立的基线版本也能被列出供用户人工审阅。
    """
    path = state_path or get_default_state_path()
    state = load_state(path)
    pending_list = []
    for record in state.get("sources", {}).values():
        is_pending = bool(record.get("pending_review")) or not record.get(
            "reviewed_hash"
        )
        if is_pending:
            pending_list.append(record)
    return pending_list


def generate_diff_for_review(source_id: str, state_path: Path | None = None) -> str:
    """
    生成已审阅版本与最新拉取版本之间的统一 diff 文本，供人工审查。
    限制 diff 行数与字符数，防内存耗尽。绝不合并代码。
    """
    clean_id = validate_source_id(source_id)
    path = state_path or get_default_state_path()
    state = load_state(path)
    sources = state.get("sources", {})
    if clean_id not in sources:
        return f"未找到源记录: {clean_id}"

    rec = sources[clean_id]
    quarantine = get_quarantine_dir(path)

    reviewed_hash = rec.get("reviewed_hash", "")
    latest_hash = rec.get("latest_hash", "")

    old_file = (
        quarantine / f"{clean_id}_{reviewed_hash[:12]}.snapshot"
        if reviewed_hash
        else None
    )
    new_file = (
        quarantine / f"{clean_id}_{latest_hash[:12]}.snapshot" if latest_hash else None
    )

    old_text = ""
    if old_file and old_file.exists():
        try:
            old_text = old_file.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            old_text = f"(读取已审阅快照失败: {exc})"
    else:
        old_text = "(尚无已审阅版本快照 / 首次基线)"

    new_text = ""
    if new_file and new_file.exists():
        try:
            new_text = new_file.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            new_text = f"(读取最新快照失败: {exc})"
    else:
        new_text = "(未找到最新待审快照)"

    diff_lines = list(
        difflib.unified_diff(
            old_text.splitlines(keepends=True),
            new_text.splitlines(keepends=True),
            fromfile=f"reviewed:{reviewed_hash[:8] if reviewed_hash else 'none'}",
            tofile=f"latest:{latest_hash[:8]}",
        )
    )

    if not diff_lines:
        return "无文本差异"

    total_lines = len(diff_lines)
    truncated = False
    if total_lines > MAX_DIFF_LINES:
        diff_lines = diff_lines[:MAX_DIFF_LINES]
        truncated = True

    diff_output = "".join(diff_lines)
    if len(diff_output) > MAX_DIFF_CHARS:
        diff_output = diff_output[:MAX_DIFF_CHARS]
        truncated = True

    if truncated:
        diff_output += f"\n... [警告: Diff 差异过大已截断显示，总行数: {total_lines}，请直接审查快照文件] ..."

    return diff_output


def approve_source_version(
    source_id: str,
    expected_hash: str,
    state_path: Path | None = None,
    note: str = "",
) -> dict[str, Any]:
    """
    人工审核通过特定版本。
    必须由人工显式传入完整的 64 位 SHA256 哈希值，且必须与 latest_hash 精确一致，
    防止用户误在错误或被篡改的版本上盲目点击确认。
    绝不自动合并或向青龙运行目录写入代码。
    """
    clean_id = validate_source_id(source_id)
    path = state_path or get_default_state_path()
    state = load_state(path)
    sources = state.get("sources", {})
    if clean_id not in sources:
        raise ValueError(f"未找到监控源: {clean_id}")

    rec = sources[clean_id]
    latest_hash = rec.get("latest_hash", "")
    if not latest_hash:
        raise ValueError(f"监控源 [{clean_id}] 尚无拉取的最新版本")

    # 严格校验：必须传入 64 位十六进制 SHA256
    clean_expected = (expected_hash or "").strip().lower()
    if len(clean_expected) != 64 or not all(
        c in "0123456789abcdef" for c in clean_expected
    ):
        raise ValueError(
            "安全阻断: --expected-hash 必须为完整的 64 位 SHA256 十六进制字符串，禁止模糊匹配或省略"
        )

    # 严格校验：必须与最新拉取哈希完全一致
    if clean_expected != latest_hash.lower():
        raise ValueError(
            f"安全阻断: 传入的预期哈希与最新拉取哈希不一致，拒绝批准！\n"
            f"  预期传入: {clean_expected}\n"
            f"  最新拉取: {latest_hash}\n"
            f"请仔细查看 diff 与隔离快照，确认无恶意代码后再以正确的最新 SHA256 重新提交批准。"
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    rec["reviewed_hash"] = latest_hash
    rec["pending_review"] = False
    rec["status"] = "REVIEWED"
    rec["last_reviewed_at"] = now_iso
    rec["review_note"] = note or "人工审核通过"
    save_state(path, state)
    print(
        f"[人工审核确认] 源 [{rec.get('name', clean_id)}] 版本 ({latest_hash[:8]}) 已由人工严格核验通过"
    )
    return rec


# ==========================================
# 主流程入口
# ==========================================


def run_monitor(state_path: Path | None = None, notifier: Any = notify) -> bool:
    """
    执行一次完整的上游变更监控检查。
    """
    sources = load_configured_sources()
    path = state_path or get_default_state_path()
    quarantine = get_quarantine_dir(path)
    state = load_state(path)

    print(f"=== 开始上游脚本变更监控 (共 {len(sources)} 个源) ===")
    print(f"状态存储: {path}")

    session = requests.Session()
    success_count = 0
    all_ok = True

    try:
        for src in sources:
            if not src.enabled:
                print(f"[跳过] [{src.name}] 当前处于未启用状态")
                continue
            try:
                result = check_source(
                    src, state, quarantine, session=session, notifier=notifier
                )
                save_state(path, state)
                if result.status == "CHANGED_NOTIFY_FAILED":
                    all_ok = False
                else:
                    success_count += 1
            except Exception as exc:
                all_ok = False
                print(f"[异常] 检查源 [{src.name}] 失败: {exc}")
    finally:
        session.close()

    print(f"=== 上游监控检查完成: {success_count}/{len(sources)} 成功处理 ===")
    return all_ok


def main() -> int:
    parser = argparse.ArgumentParser(description="上游第三方脚本变更监控与安全隔离")
    parser.add_argument(
        "--list-pending",
        action="store_true",
        help="列出所有待人工审核的源（含首次基线）",
    )
    parser.add_argument("--diff", metavar="SOURCE_ID", help="查看指定源的变更 diff")
    parser.add_argument("--approve", metavar="SOURCE_ID", help="人工审核通过指定源")
    parser.add_argument(
        "--expected-hash", help="人工审核批准时必须显式指定的 64 位完整 SHA256 哈希"
    )
    parser.add_argument("--note", default="", help="人工审核通过时的备注")
    args = parser.parse_args()

    if args.list_pending:
        pending = get_pending_sources()
        if not pending:
            print("当前无待审核的上游源。")
        else:
            print(f"共有 {len(pending)} 个待人工审核源:")
            for p in pending:
                rev = p.get("reviewed_hash", "")
                rev_display = rev[:8] if rev else "未审核(无)"
                print(
                    f" - [{p['id']}] {p.get('name')}\n"
                    f"   状态: {p.get('status')} | 已审阅: {rev_display} | 最新: {p.get('latest_hash', '')[:8]}\n"
                    f"   完整最新哈希: {p.get('latest_hash', '')}\n"
                    f"   地址: {p.get('url')}"
                )
        return 0

    if args.diff:
        print(generate_diff_for_review(args.diff))
        return 0

    if args.approve:
        if not args.expected_hash:
            print(
                "错误: --approve 必须同时提供 --expected-hash <64位完整SHA256哈希>，防止误批准。"
            )
            return 2
        try:
            approve_source_version(
                args.approve, expected_hash=args.expected_hash, note=args.note
            )
            return 0
        except ValueError as exc:
            print(f"批准失败: {exc}")
            return 1

    summary = run_single_script(
        __file__, run_monitor, notify_module=notify, display_name="上游监控"
    )
    return summary.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
