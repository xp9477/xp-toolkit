"""mitmproxy addon：按 hostname 白名单安全保存响应样本。"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from mitmproxy import http

DEFAULT_SAVE_DIR = "mitm_responses"
DEFAULT_MAX_BODY_BYTES = 1024 * 1024
SENSITIVE_NAME = re.compile(
    r"(?:authorization|cookie|token|secret|password|passwd|api[-_]?key|session)",
    re.IGNORECASE,
)


def parse_hosts(raw):
    hosts = []
    for item in (raw or "").split(","):
        host = item.strip().casefold().rstrip(".")
        if not host:
            continue
        if "/" in host or "://" in host or any(char.isspace() for char in host):
            raise ValueError(f"MITM_CAPTURE_HOSTS 包含非法 hostname: {item!r}")
        hosts.append(host)
    return tuple(dict.fromkeys(hosts))


def host_allowed(host, patterns):
    candidate = (host or "").casefold().rstrip(".")
    for pattern in patterns:
        if pattern.startswith("*."):
            suffix = pattern[2:]
            if candidate.endswith(f".{suffix}"):
                return True
        elif candidate == pattern:
            return True
    return False


def redact_headers(headers):
    return {
        str(name): "<redacted>" if SENSITIVE_NAME.search(str(name)) else str(value)
        for name, value in headers.items()
    }


def redact_json(value):
    if isinstance(value, dict):
        return {
            key: "<redacted>" if SENSITIVE_NAME.search(str(key)) else redact_json(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_json(item) for item in value]
    return value


def redact_url(value):
    parsed = urlsplit(value)
    query = urlencode(
        [
            (key, "<redacted>" if SENSITIVE_NAME.search(key) else item)
            for key, item in parse_qsl(parsed.query, keep_blank_values=True)
        ],
        doseq=True,
    )
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, query, parsed.fragment))


def _safe_component(value, limit):
    cleaned = re.sub(r"[^\w.-]+", "_", value, flags=re.UNICODE).strip("._")
    return (cleaned or "root")[:limit]


class ResponseSaver:
    def __init__(self, save_dir=None, hosts=None, max_body_bytes=None):
        self.save_dir = Path(
            save_dir or os.getenv("MITM_CAPTURE_DIR", DEFAULT_SAVE_DIR)
        ).resolve()
        self.hosts = (
            tuple(hosts)
            if hosts is not None
            else parse_hosts(os.getenv("MITM_CAPTURE_HOSTS", ""))
        )
        raw_limit = (
            max_body_bytes
            if max_body_bytes is not None
            else os.getenv("MITM_CAPTURE_MAX_BYTES", DEFAULT_MAX_BODY_BYTES)
        )
        self.max_body_bytes = int(raw_limit)
        if self.max_body_bytes < 0:
            raise ValueError("MITM_CAPTURE_MAX_BYTES 不能为负数")
        self.counter = 0
        if not self.hosts:
            print("[Capture disabled] 请设置 MITM_CAPTURE_HOSTS=api.example.com")
        else:
            self.save_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.save_dir.chmod(0o700)

    def response(self, flow: http.HTTPFlow):
        if (
            not self.hosts
            or not host_allowed(flow.request.host, self.hosts)
            or not flow.response
            or not flow.response.content
        ):
            return

        self.counter += 1
        timestamp = time.time_ns()
        path_only = urlsplit(flow.request.url).path
        filename = (
            f"{timestamp}_{self.counter}_"
            f"{_safe_component(flow.request.host, 80)}_"
            f"{_safe_component(path_only, 80)}.json"
        )
        content = bytes(flow.response.content)
        data = {
            "id": flow.id,
            "method": flow.request.method,
            "host": flow.request.host,
            "path": redact_url(flow.request.path),
            "url": redact_url(flow.request.url),
            "status_code": flow.response.status_code,
            "content_length": len(content),
            "content_type": flow.response.headers.get("content-type", ""),
            "timestamp_ns": timestamp,
            "request_headers": redact_headers(flow.request.headers),
            "response_headers": redact_headers(flow.response.headers),
        }
        if len(content) > self.max_body_bytes:
            data["body"] = f"<omitted: {len(content)} bytes exceeds limit>"
        else:
            try:
                data["body"] = redact_json(json.loads(content.decode("utf-8")))
            except (UnicodeDecodeError, json.JSONDecodeError):
                data["body"] = content.decode("utf-8", errors="replace")

        destination = self.save_dir / filename
        descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=False, indent=2)
            file.write("\n")
        print(f"[Saved] {flow.request.host}{path_only[:60]} -> {filename}")


addons = [ResponseSaver()]
