"""
name: A股竞赛 Kimi-K3 成交推送
cron: 25 9 * * 1-5
description: 交易时段监控 Kimi-K3 新成交，推送操作、成交价与该股当前仓位

青龙使用:
1. 依赖同目录 common.py / notify.py
2. 【必需】环境变量 notify = Bark 设备 key
   例: notify=你的key  或  notify={"bark":"你的key"}
3. 定时: 25 9 * * 1-5（按【北京时间】工作日 09:25 启动；若青龙是 UTC 时区，应改为 25 1 * * 1-5）
4. 脚本需在盘中常驻运行（不要被超时杀掉）；收盘后自行退出
5. 可选环境变量 ashare_kimi3_monitor（JSON）
6. 首次启动：历史成交只建基线；【当天】成交仍会推送，避免开盘后部署漏报
7. 日志里应出现「Bark 推送成功」；若只有「缺少推送配置」说明 notify 未配
8. 每次启动会先推一条「Kimi-K3 监控启动」用于确认通路；无新成交时不会再推
9. 调试: ASHARE_TEST_NOTIFY=1 强制启动推送；ASHARE_SKIP_START_NOTIFY=1 关闭启动推送

env:
- `ashare_kimi3_monitor`（可选）:
  {
    "players": ["Kimi-K3"],
    "player_ids": ["kimi3"],
    "interval": 30,
    "url": "https://asharecompetition.fun/intraday_head.json",
    "state_file": "",
    "once": false,
    "notify_on_start": true
  }
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta
from datetime import time as dtime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import notify
import requests
from common import load_config, run_single_script

TZ = ZoneInfo("Asia/Shanghai")
DEFAULT_URL = "https://asharecompetition.fun/intraday_head.json"
DEFAULT_PLAYERS = ["Kimi-K3"]
DEFAULT_PLAYER_IDS = ["kimi3"]
DEFAULT_INTERVAL = 30
AI_INITIAL_CAPITAL = 1_000_000.0

MORNING_START = dtime(9, 25)
MORNING_END = dtime(11, 35)
AFTERNOON_START = dtime(12, 55)
AFTERNOON_END = dtime(15, 5)

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/137.0.0.0 Safari/537.36"
)

PLAYER_ID_ALIASES = {
    "kimi-k3": "kimi3",
    "kimik3": "kimi3",
    "kimi_k3": "kimi3",
    "kimi3": "kimi3",
    "kimi": "kimi",
    "deepseek": "deepseek",
    "glm": "glm",
    "qwen": "qwen",
    "豆包": "doubao",
    "doubao": "doubao",
}


def now_cn() -> datetime:
    return datetime.now(TZ)


def compact_name(value: str) -> str:
    return (
        (value or "").strip().lower().replace("-", "").replace("_", "").replace(" ", "")
    )


def resolve_player_id(player: str) -> str:
    raw = (player or "").strip()
    low = raw.lower()
    if low in PLAYER_ID_ALIASES:
        return PLAYER_ID_ALIASES[low]
    compact = compact_name(raw)
    return PLAYER_ID_ALIASES.get(compact, compact or "kimi3")


def player_matched(player: str, targets: list[str]) -> bool:
    p = (player or "").strip().lower()
    cp = compact_name(player)
    for target in targets:
        t = target.strip().lower()
        if t and (p == t or cp == compact_name(t)):
            return True
    return False


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def fmt_money(value: float, *, signed: bool = False) -> str:
    if signed:
        sign = "+" if value > 0 else ""
        return f"{sign}¥{value:,.0f}"
    return f"¥{value:,.0f}"


def fmt_pct(value: float, *, signed: bool = True, digits: int = 2) -> str:
    if signed:
        sign = "+" if value > 0 else ""
        return f"{sign}{value:.{digits}f}%"
    return f"{value:.{digits}f}%"


def fmt_price(value: float) -> str:
    return f"{value:.2f}"


def load_monitor_config() -> dict[str, Any]:
    raw = load_config(__file__, required=False)
    if raw is None:
        config: dict[str, Any] = {}
    elif isinstance(raw, dict):
        config = dict(raw)
    else:
        raise ValueError("ashare_kimi3_monitor 配置必须为 JSON 对象")

    players = config.get("players") or DEFAULT_PLAYERS
    if isinstance(players, str):
        players = [p.strip() for p in players.split(",") if p.strip()]
    if not players:
        players = list(DEFAULT_PLAYERS)

    player_ids = config.get("player_ids")
    if isinstance(player_ids, str):
        player_ids = [p.strip() for p in player_ids.split(",") if p.strip()]
    if not player_ids:
        ids: list[str] = []
        for p in players:
            pid = resolve_player_id(p)
            if pid not in ids:
                ids.append(pid)
        player_ids = ids or list(DEFAULT_PLAYER_IDS)

    interval = max(5, int(config.get("interval") or DEFAULT_INTERVAL))
    state_file = config.get("state_file") or default_state_file()
    return {
        "players": [str(p) for p in players],
        "player_ids": [str(p) for p in player_ids],
        "interval": interval,
        "url": str(config.get("url") or DEFAULT_URL),
        "state_file": str(state_file),
        "once": bool(config.get("once", False)),
        "notify_on_start": bool(config.get("notify_on_start", True)),
    }


def default_state_file() -> Path:
    candidates = [
        Path(os.getenv("QL_DATA_DIR", "/ql/data"))
        / "ashare_kimi3_monitor"
        / "state.json",
        Path("/tmp/ashare_kimi3_monitor_state.json"),
        Path(__file__).resolve().with_name(".ashare_kimi3_state.json"),
    ]
    for path in candidates[:-1]:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            return path
        except OSError:
            continue
    return candidates[-1]


def is_weekday(dt: datetime) -> bool:
    return dt.weekday() < 5


def in_trading_session(dt: datetime | None = None) -> bool:
    dt = dt or now_cn()
    if not is_weekday(dt):
        return False
    t = dt.time()
    return (MORNING_START <= t <= MORNING_END) or (
        AFTERNOON_START <= t <= AFTERNOON_END
    )


def seconds_until_next_session(dt: datetime | None = None) -> float | None:
    dt = dt or now_cn()
    if not is_weekday(dt):
        return None
    t = dt.time()
    for start, end in ((MORNING_START, MORNING_END), (AFTERNOON_START, AFTERNOON_END)):
        if t < start:
            target = datetime.combine(dt.date(), start, TZ)
            return max(0.0, (target - dt).total_seconds())
        if start <= t <= end:
            return 0.0
    return None


def trade_key(trade: dict[str, Any]) -> str:
    return "|".join(
        [
            str(trade.get("date", "")),
            str(trade.get("time", "")),
            str(trade.get("player", "")),
            str(trade.get("side", "")),
            str(trade.get("code", "")),
            str(trade.get("shares", "")),
            str(trade.get("price", "")),
            str(trade.get("reason", "")),
        ]
    )


def trade_sort_key(trade: dict[str, Any]) -> tuple[str, str, str]:
    return (str(trade.get("date", "")), str(trade.get("time", "")), trade_key(trade))


def load_state(path: Path) -> dict[str, Any]:
    default: dict[str, Any] = {"seen_trades": [], "meta": {}}
    try:
        if not path.exists():
            return default
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return default
        if "keys" in data and "seen_trades" not in data:
            data["seen_trades"] = data.get("keys") or []
        data.setdefault("seen_trades", [])
        data.setdefault("meta", {})
        return data
    except Exception as exc:
        print(f"读取状态失败，将重建: {exc}")
        return default


def save_state(path: Path, state: dict[str, Any], *, keep_trades: int = 500) -> None:
    seen = [str(x) for x in state.get("seen_trades") or []]
    out = {
        "updated": now_cn().isoformat(timespec="seconds"),
        "seen_trades": seen[-keep_trades:],
        "meta": state.get("meta") or {},
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def fetch_snapshot(url: str, *, retries: int = 3) -> dict[str, Any]:
    last_err: Exception | None = None
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json,text/plain,*/*",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Referer": "https://asharecompetition.fun/",
    }
    for attempt in range(1, max(1, retries) + 1):
        try:
            resp = requests.get(
                url,
                params={"t": int(time.time())},
                headers=headers,
                timeout=20,
            )
            resp.raise_for_status()
            data = resp.json()
            if not isinstance(data, dict):
                raise ValueError("intraday_head.json 返回格式异常")
            if not isinstance(data.get("trades"), list):
                data["trades"] = []
            return data
        except Exception as exc:
            last_err = exc
            if attempt >= retries:
                break
            wait = min(2.0 * attempt, 6.0)
            print(f"拉取失败({attempt}/{retries}): {exc}，{wait:.0f}s 后重试")
            time.sleep(wait)
    assert last_err is not None
    raise last_err


def extract_ai_portfolio(data: dict[str, Any], player_id: str) -> dict[str, Any] | None:
    positions = data.get("positions") or {}
    raw = positions.get(player_id)
    if not isinstance(raw, dict):
        return None

    nav = safe_float((data.get("navs") or {}).get(player_id))
    base = safe_float((data.get("base") or {}).get(player_id))
    cash = safe_float(raw.get("cash"))
    holdings: list[dict[str, Any]] = []
    rows = raw.get("pos") or []

    if nav <= 0:
        nav = cash
        for row in rows:
            if isinstance(row, (list, tuple)) and len(row) >= 5:
                nav += safe_int(row[2]) * safe_float(row[4])

    for row in rows:
        if not isinstance(row, (list, tuple)) or len(row) < 5:
            continue
        shares = safe_int(row[2])
        price = safe_float(row[4])
        cost = safe_float(row[3])
        if shares <= 0 or price <= 0:
            continue
        mv = shares * price
        holdings.append(
            {
                "code": str(row[0]),
                "name": str(row[1]),
                "shares": shares,
                "cost": cost,
                "price": price,
                "locked": safe_int(row[5]) if len(row) > 5 else 0,
                "market_value": mv,
                "pnl": shares * (price - cost),
                "weight": mv / nav if nav > 0 else 0.0,
            }
        )

    holdings.sort(key=lambda h: h["weight"], reverse=True)
    day_pnl = nav - base if base > 0 else 0.0
    day_ret = day_pnl / base * 100.0 if base > 0 else 0.0
    total_ret = (nav / AI_INITIAL_CAPITAL - 1.0) * 100.0 if nav > 0 else 0.0
    return {
        "player_id": player_id,
        "nav": nav,
        "base": base,
        "cash": cash,
        "cash_weight": cash / nav if nav > 0 else 0.0,
        "day_ret": day_ret,
        "total_ret": total_ret,
        "holdings": holdings,
        "by_code": {h["code"]: h for h in holdings},
        "updated": data.get("updated", ""),
        "date": data.get("date", ""),
    }


def format_position(
    code: str, name: str, ai: dict[str, Any], trade: dict[str, Any]
) -> str:
    pos = (ai.get("by_code") or {}).get(code)
    trade_shares = safe_int(trade.get("shares"))
    side = str(trade.get("side") or "")

    if not pos:
        # 卖光后持仓里可能没有了
        if side == "卖出":
            return f"该股仓位: 已清仓（本笔卖出 {trade_shares} 股）"
        return "该股仓位: 暂无持仓数据"

    lock = f"，锁定{pos['locked']}股" if pos.get("locked") else ""
    return (
        f"该股仓位: {pos['shares']}股{lock}\n"
        f"成本 @{fmt_price(pos['cost'])} / 现价 @{fmt_price(pos['price'])}\n"
        f"市值 {fmt_money(pos['market_value'])} / 仓位 {pos['weight'] * 100:.1f}%\n"
        f"浮盈亏 {fmt_money(pos['pnl'], signed=True)}"
    )


def build_trade_message(trade: dict[str, Any], ai: dict[str, Any]) -> tuple[str, str]:
    side = str(trade.get("side") or "")
    code = str(trade.get("code") or "")
    name = str(trade.get("name") or code)
    shares = safe_int(trade.get("shares"))
    price = safe_float(trade.get("price"))
    amount = shares * price
    ts = f"{trade.get('date', '')} {trade.get('time', '')}".strip()
    reason = (
        trade.get("reason") or trade.get("desc") or trade.get("memo") or ""
    ).strip()
    player = str(trade.get("player") or "Kimi-K3")

    title = f"K3 {side} {name}"
    # 理由靠前，避免通知过长时被截断看不到
    parts = [
        f"{player} {side} {code} {name}",
        f"时间: {ts}",
        f"成交价: @{fmt_price(price)}",
        f"数量: {shares}股",
        f"金额: {fmt_money(amount)}",
        f"操作理由: {reason or '（无）'}",
        format_position(code, name, ai, trade),
        (
            f"账户: NAV {fmt_money(ai['nav'])} "
            f"当日{fmt_pct(ai['day_ret'])} 累计{fmt_pct(ai['total_ret'])} "
            f"现金{ai['cash_weight'] * 100:.1f}%"
        ),
    ]
    if ai.get("updated"):
        parts.append(f"数据更新: {ai.get('updated')}")
    return title, "\n".join(parts)


def build_start_message(ai: dict[str, Any], trade_count: int) -> tuple[str, str]:
    title = "Kimi-K3 监控已启动"
    lines = [
        "已记录历史成交基线，之后仅推送新操作",
        (
            f"账户 NAV {fmt_money(ai['nav'])} "
            f"当日{fmt_pct(ai['day_ret'])} 累计{fmt_pct(ai['total_ret'])} "
            f"现金{ai['cash_weight'] * 100:.1f}%"
        ),
        f"当前持仓 {len(ai['holdings'])} 只 / 历史成交基线 {trade_count} 条",
        "【当前持仓】",
    ]
    if not ai["holdings"]:
        lines.append("空仓")
    else:
        for h in ai["holdings"][:12]:
            lock = "🔒" if h.get("locked") else ""
            lines.append(
                f"{h['code']} {h['name']}{lock} {h['shares']}股 "
                f"@{fmt_price(h['price'])} 仓位{h['weight'] * 100:.1f}% "
                f"盈亏{fmt_money(h['pnl'], signed=True)}"
            )
    if ai.get("updated"):
        lines.append(f"数据更新: {ai.get('updated')}")
    return title, "\n".join(lines)


def notify_action(title: str, content: str) -> None:
    print(f"推送: {title}")
    print(content)
    print("-" * 40)
    if len(content) <= 1200:
        ok = notify.send(title, content)
        if not ok:
            print("警告: Bark 推送未成功，请检查青龙环境变量 notify 与脚本日志")
        return
    head = content[:1100] + "\n…(内容较长，已分段)"
    ok = notify.send(title, head)
    rest = content[1100:]
    idx = 2
    while rest:
        piece = rest[:1100]
        rest = rest[1100:]
        ok = notify.send(f"{title} ({idx})", piece) and ok
        idx += 1
    if not ok:
        print("警告: Bark 分段推送存在失败，请检查青龙环境变量 notify 与脚本日志")


def poll_once(
    config: dict[str, Any], state: dict[str, Any], *, bootstrap: bool
) -> dict[str, Any]:
    data = fetch_snapshot(config["url"])
    player_id = config["player_ids"][0]
    ai = extract_ai_portfolio(data, player_id)
    if not ai:
        raise RuntimeError(f"未找到 {player_id} 持仓数据")

    matched = [
        t
        for t in (data.get("trades") or [])
        if isinstance(t, dict)
        and player_matched(str(t.get("player", "")), config["players"])
    ]
    matched.sort(key=trade_sort_key)

    seen = {str(x) for x in (state.get("seen_trades") or [])}

    # 数据里的交易日；没有则用北京时间今天
    session_date = str(data.get("date") or now_cn().strftime("%Y-%m-%d"))

    new_trades: list[dict[str, Any]] = []
    if bootstrap:
        hist_n = 0
        today_n = 0
        for trade in matched:
            key = trade_key(trade)
            trade_date = str(trade.get("date") or "")
            # 仅把「非当天」成交记入基线静默跳过；当天成交照常推送
            if trade_date and trade_date != session_date:
                seen.add(key)
                hist_n += 1
                continue
            if key in seen:
                continue
            seen.add(key)
            new_trades.append(trade)
            today_n += 1
        print(
            f"首次基线: 静默历史 {hist_n} 条；当天待推送 {today_n} 条 "
            f"(session_date={session_date})"
        )
        # 启动短推送已在 run_monitor 发过；这里仅在首次基线时补发持仓摘要
        if config.get("notify_on_start", True):
            title, content = build_start_message(ai, hist_n + today_n)
            notify_action(title, content)
    else:
        for trade in matched:
            key = trade_key(trade)
            if key in seen:
                continue
            seen.add(key)
            new_trades.append(trade)

    print(
        f"[{now_cn().strftime('%H:%M:%S')}] "
        f"AI持仓={len(ai['holdings'])} 新成交={len(new_trades)} "
        f"updated={ai.get('updated')}"
    )

    for trade in new_trades:
        title, content = build_trade_message(trade, ai)
        notify_action(title, content)

    if not new_trades:
        print("无新成交")

    state["seen_trades"] = sorted(seen)
    state["meta"] = {
        "ai_updated": ai.get("updated"),
        "ai_nav": ai.get("nav"),
        "holdings": len(ai["holdings"]),
        "last_new_trades": len(new_trades),
    }
    return state


def wait_interruptible(seconds: float) -> None:
    end = time.time() + max(0.0, seconds)
    while True:
        remain = end - time.time()
        if remain <= 0:
            return
        time.sleep(min(remain, 1.0))


def run_monitor() -> None:
    config = load_monitor_config()
    state_path = Path(config["state_file"])
    state = load_state(state_path)
    bootstrap = not bool(state.get("seen_trades"))

    bark_cfg = notify.get_bark_push()
    if bark_cfg:
        masked = (
            bark_cfg if len(bark_cfg) <= 10 else f"{bark_cfg[:4]}***{bark_cfg[-4:]}"
        )
        print(f"Bark 配置已加载: {masked}")
    else:
        print("=" * 50)
        print("严重: 未检测到 Bark 配置，将不会有手机推送！")
        print("请在青龙「环境变量」添加: notify = 你的Bark设备key")
        print('也可: notify={"bark":"你的Bark设备key"}')
        print("=" * 50)

    print(
        f"K3成交推送 players={config['players']} ids={config['player_ids']} "
        f"interval={config['interval']}s once={config['once']} "
        f"bootstrap={bootstrap} state={state_path}"
    )

    # 每次进程启动先打一条短推送，证明 Bark 通路（与是否有新成交无关）
    # 可用环境变量 ASHARE_SKIP_START_NOTIFY=1 关闭；配置 notify_on_start=false 也会关闭
    force_test = os.getenv("ASHARE_TEST_NOTIFY", "").strip() in {
        "1",
        "true",
        "True",
        "yes",
        "YES",
    }
    skip_start = os.getenv("ASHARE_SKIP_START_NOTIFY", "").strip() in {
        "1",
        "true",
        "True",
        "yes",
        "YES",
    }
    if force_test or (config.get("notify_on_start", True) and not skip_start):
        title = "Kimi-K3 监控启动"
        ts = now_cn().strftime("%Y-%m-%d %H:%M:%S")
        content = (
            f"时间: {ts}\n"
            f"状态文件: {state_path}\n"
            f"bootstrap={bootstrap} once={config['once']}\n"
            "之后仅在有 K3 新成交时再推送"
        )
        print("发送启动确认推送…")
        notify_action(title, content)

    if config["once"]:
        if not in_trading_session() and not bootstrap and not os.getenv("ASHARE_FORCE"):
            print(
                f"当前非交易时段: {now_cn().isoformat(timespec='seconds')}，once 模式退出"
            )
            return
        state = poll_once(config, state, bootstrap=bootstrap)
        save_state(state_path, state)
        return

    while True:
        now = now_cn()
        if not is_weekday(now):
            print(f"非交易日 {now.date()}，退出")
            return

        if in_trading_session(now):
            try:
                state = poll_once(config, state, bootstrap=bootstrap)
                bootstrap = False
                save_state(state_path, state)
            except Exception as exc:
                print(f"本轮失败: {exc}")
            wait_interruptible(config["interval"])
            continue

        wait_sec = seconds_until_next_session(now)
        if wait_sec is None:
            print(f"今日交易已结束 ({now.strftime('%H:%M:%S')})，退出")
            return

        wake = now + timedelta(seconds=wait_sec)
        print(
            f"非交易时段，休眠 {int(wait_sec)}s，预计 {wake.strftime('%H:%M:%S')} 继续"
        )
        while wait_sec > 0:
            chunk = min(wait_sec, max(config["interval"], 30))
            wait_interruptible(chunk)
            now = now_cn()
            if in_trading_session(now):
                break
            wait_sec = seconds_until_next_session(now)
            if wait_sec is None:
                print(f"今日交易已结束 ({now.strftime('%H:%M:%S')})，退出")
                return
            wait_sec = seconds_until_next_session(now) or 0


def main() -> None:
    run_monitor()


if __name__ == "__main__":
    raise SystemExit(run_single_script(__file__, main, notify_module=notify).exit_code)
