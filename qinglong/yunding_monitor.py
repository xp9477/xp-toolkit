"""
name: 云顶攻略助手更新监控
cron: 0 */6 * * *
description: 监控 iOS 云顶攻略助手 (cloud.miplus.tft) App Store 版本更新，发现新版时通过 Bark 推送通知

env:
- `yunding_monitor`: 可选 JSON 配置。例如:
  {
    "bundle_id": "cloud.miplus.tft",
    "app_id": "1554801875",
    "name": "云顶攻略助手",
    "country": "cn",
    "notify_on_init": false
  }
- `notify`: Bark 设备 key
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import notify
import requests
from common import load_config, run_single_script

DEFAULT_BUNDLE_ID = "cloud.miplus.tft"
DEFAULT_APP_ID = "1554801875"
DEFAULT_APP_NAME = "云顶攻略助手"
DEFAULT_COUNTRY = "cn"
REQUEST_TIMEOUT = (10, 20)


def get_default_state_path() -> Path:
    """获取监控状态持久化路径，确保独立于 git 跟踪"""
    ql_dir = os.getenv("QL_DIR")
    if ql_dir:
        return (Path(ql_dir) / "data" / "yunding_monitor.json").resolve()
    
    ql_data = Path("/ql/data")
    if ql_data.is_dir():
        return (ql_data / "yunding_monitor.json").resolve()
    
    home_dir = Path.home() / ".qinglong"
    home_dir.mkdir(parents=True, exist_ok=True)
    return (home_dir / "yunding_monitor.json").resolve()


def query_app_store(bundle_id: str = DEFAULT_BUNDLE_ID, country: str = DEFAULT_COUNTRY) -> dict[str, Any]:
    """通过 Apple 官方 iTunes Lookup API 查询 App Store 最新元数据"""
    url = f"https://itunes.apple.com/lookup?bundleId={bundle_id}&country={country}"
    resp = requests.get(url, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, dict) or data.get("resultCount", 0) == 0:
        raise ValueError(f"App Store 未检索到 bundleId={bundle_id} 的应用信息")
    results = data.get("results", [])
    if not results or not isinstance(results[0], dict):
        raise ValueError(f"App Store 响应数据格式异常: {data}")
    return results[0]


def check_and_notify(state_path: Path | None = None, force_notify: bool = False) -> bool:
    """执行版本检查并触发通知"""
    config = load_config("yunding_monitor", required=False) or {}
    bundle_id = str(config.get("bundle_id") or DEFAULT_BUNDLE_ID).strip()
    country = str(config.get("country") or DEFAULT_COUNTRY).strip()
    notify_on_init = bool(config.get("notify_on_init", False))

    path = state_path or get_default_state_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    state: dict[str, Any] = {}
    if path.is_file():
        try:
            state = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"读取历史状态失败，将重置状态: {e}")
            state = {}

    print(f"正在查询 App Store 最新版本信息 (bundleId: {bundle_id})...")
    app_info = query_app_store(bundle_id, country)

    latest_version = str(app_info.get("version", "")).strip()
    track_name = str(app_info.get("trackName", DEFAULT_APP_NAME)).strip()
    release_date = str(app_info.get("currentVersionReleaseDate", "")).strip()
    release_notes = str(app_info.get("releaseNotes", "无")).strip()
    track_view_url = str(app_info.get("trackViewUrl", "")).strip()

    print(f"App Store 最新版本: v{latest_version} (发布时间: {release_date})")

    prev_version = state.get("version")
    now_iso = datetime.now(timezone.utc).isoformat()

    has_update = bool(prev_version and prev_version != latest_version)

    if prev_version is None:
        print(f"[初始化] 首次运行建立基线版本: v{latest_version}")
        state["version"] = latest_version
        state["track_name"] = track_name
        state["release_date"] = release_date
        state["last_checked"] = now_iso
        path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        if notify_on_init or force_notify:
            title = f"【监控已启动】{track_name} 基线版本 v{latest_version}"
            body = (
                f"应用名称: {track_name}\n"
                f"当前版本: {latest_version}\n"
                f"发布时间: {release_date}\n\n"
                f"更新说明:\n{release_notes}\n\n"
                f"后续检测到版本升级将自动推送提醒。"
            )
            notify.send(title, body, group="app-update")
        return True

    if has_update or force_notify:
        print(f"[发现新版本] v{prev_version} -> v{latest_version}，正在发送通知...")
        title = f"【应用更新提醒】{track_name} 发布新版本 v{latest_version}"
        body = (
            f"应用名称: {track_name}\n"
            f"旧版本号: {prev_version}\n"
            f"新版本号: {latest_version}\n"
            f"更新时间: {release_date}\n"
            f"商店链接: {track_view_url}\n\n"
            f"【更新说明】\n{release_notes}\n\n"
            f"【去广告处理提示】\n"
            f"获取新版本脱壳 ipa 后，运行 inject_hook.py 即可自动注入通用去广告 dylib。"
        )
        send_ok = notify.send(title, body, group="app-update")
        if send_ok:
            print("[+] Bark 推送成功！")
        else:
            print("[!] Bark 推送未确认成功（可能未配置 notify 变量）")

        state["version"] = latest_version
        state["track_name"] = track_name
        state["release_date"] = release_date
        state["last_checked"] = now_iso
        path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        return True

    print(f"[无更新] 当前已是最新版本 v{latest_version} (最后检查时间: {now_iso})")
    state["last_checked"] = now_iso
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="云顶攻略助手 App Store 更新监控")
    parser.add_argument("--test-notify", action="store_true", help="强制触发一次测试推送")
    parser.add_argument("--state-file", type=str, help="自定义状态文件路径")
    args = parser.parse_args()

    state_path = Path(args.state_file).resolve() if args.state_file else None

    if args.test_notify:
        check_and_notify(state_path=state_path, force_notify=True)
        return 0

    summary = run_single_script(
        __file__,
        lambda: check_and_notify(state_path=state_path),
        notify_module=notify,
        display_name="云顶攻略助手监控"
    )
    return summary.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
