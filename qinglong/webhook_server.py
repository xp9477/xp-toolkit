"""
青龙任务 Webhook。

环境变量 ``webhook_server`` 示例：
{"bind":"0.0.0.0","port":8001,"token":"至少16位随机值","script":"check_ip.py"}

远程触发只接受 ``POST /trigger``（兼容旧路径 ``/check_ip``），并要求
``Authorization: Bearer <token>``。``GET /healthz`` 仅用于健康检查。
"""

from __future__ import annotations

import hmac
import ipaddress
import subprocess
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from common import ConfigError, load_config

SCRIPT_ROOT = Path(__file__).resolve().parent
TRIGGER_PATHS = {"/trigger", "/check_ip"}


@dataclass(frozen=True)
class ServerConfig:
    bind: str
    port: int
    token: str
    script: Path
    cooldown_seconds: float


def _is_loopback(host: str) -> bool:
    if host.casefold() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _parse_int(value, name: str, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f"{name} 必须为整数") from exc
    if not minimum <= parsed <= maximum:
        raise ConfigError(f"{name} 必须在 {minimum}..{maximum} 之间")
    return parsed


def resolve_task_script(value: str, root: Path = SCRIPT_ROOT) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ConfigError("webhook_server 缺少 script")
    root = root.resolve()
    candidate = (root / value.strip()).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ConfigError("script 必须位于 qinglong 目录内") from exc
    if candidate.suffix != ".py" or not candidate.is_file():
        raise ConfigError(f"script 不存在或不是 Python 文件: {candidate.name}")
    return candidate


def load_server_config(root: Path = SCRIPT_ROOT) -> ServerConfig:
    raw = load_config(__file__, required=False) or {}
    if not isinstance(raw, dict):
        raise ConfigError("webhook_server 配置必须为 JSON 对象")
    bind = str(raw.get("bind", "127.0.0.1")).strip() or "127.0.0.1"
    port = _parse_int(raw.get("port", 8001), "port", 1, 65535)
    cooldown = _parse_int(raw.get("cooldown_seconds", 30), "cooldown_seconds", 0, 3600)
    token = str(raw.get("token", "")).strip()
    if not _is_loopback(bind) and len(token) < 16:
        raise ConfigError("监听非回环地址时 token 至少需要 16 个字符")
    return ServerConfig(
        bind=bind,
        port=port,
        token=token,
        script=resolve_task_script(raw.get("script", ""), root),
        cooldown_seconds=float(cooldown),
    )


def authorization_matches(header: str | None, token: str) -> bool:
    if not token:
        return True
    prefix = "Bearer "
    if not header or not header.startswith(prefix):
        return False
    return hmac.compare_digest(header[len(prefix) :], token)


class TriggerController:
    def __init__(self, config: ServerConfig):
        self.config = config
        self.process: subprocess.Popen | None = None
        self.last_trigger = float("-inf")

    def trigger(self, now: float | None = None) -> tuple[int, str, int | None]:
        current = time.monotonic() if now is None else now
        if self.process is not None and self.process.poll() is None:
            return 409, "Task is already running.", None
        elapsed = current - self.last_trigger
        if elapsed < self.config.cooldown_seconds:
            retry_after = max(1, int(self.config.cooldown_seconds - elapsed + 0.999))
            return 429, "Trigger cooldown is active.", retry_after
        try:
            self.process = subprocess.Popen(
                ["task", str(self.config.script)],
                stdin=subprocess.DEVNULL,
                close_fds=True,
            )
        except OSError as exc:
            return 503, f"Unable to start ql task: {exc}", None
        self.last_trigger = current
        return 202, "Task accepted.", None


class WebhookHTTPServer(HTTPServer):
    def __init__(self, config: ServerConfig):
        super().__init__((config.bind, config.port), WebhookHandler)
        self.config = config
        self.controller = TriggerController(config)


class WebhookHandler(BaseHTTPRequestHandler):
    server: WebhookHTTPServer

    def _send_text(self, status: int, message: str, retry_after: int | None = None) -> None:
        body = message.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if retry_after is not None:
            self.send_header("Retry-After", str(retry_after))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/healthz":
            self._send_text(200, "ok")
        else:
            self._send_text(404, "Not Found")

    def do_POST(self):
        if self.path not in TRIGGER_PATHS:
            self._send_text(404, "Not Found")
            return
        if not authorization_matches(
            self.headers.get("Authorization"), self.server.config.token
        ):
            self._send_text(401, "Unauthorized")
            return
        status, message, retry_after = self.server.controller.trigger()
        self._send_text(status, message, retry_after)

    def log_message(self, message_format, *args):
        # 不记录 Authorization，也不接受 query token；保留最小访问日志。
        print(f"webhook {self.client_address[0]}: {message_format % args}")


def run(config: ServerConfig | None = None):
    selected = config or load_server_config()
    server = WebhookHTTPServer(selected)
    print(f"Webhook listening on http://{selected.bind}:{selected.port}")
    print(f"Task: {selected.script.name}; trigger: POST /trigger; health: GET /healthz")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Webhook stopped")
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
