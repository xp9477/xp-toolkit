"""从受校验的 JSON 配置生成 Loon 响应脚本和插件。"""

from __future__ import annotations

import argparse
import json
import re
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

FIELD_PART = re.compile(r"^([^\[\]]+?)(?:\[(\d+)\])?$")
HOST = re.compile(
    r"^(?:\*\.)?(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*"
    r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?::\d{1,5})?$"
)
HOST_LABEL_PATTERN = r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"


class ConfigError(ValueError):
    """生成配置不完整或可能产生无效插件。"""


def parse_field_path(path):
    if not isinstance(path, str) or not path.strip():
        raise ConfigError("字段路径不能为空")
    parts = []
    for raw_part in path.split("."):
        match = FIELD_PART.fullmatch(raw_part)
        if not match:
            raise ConfigError(f"字段路径不合法: {path!r}")
        parts.append(
            {
                "name": match.group(1),
                "index": int(match.group(2)) if match.group(2) is not None else None,
            }
        )
    return parts


def generate_vip_script(field_mappings, url_pattern):
    if not isinstance(field_mappings, dict) or not field_mappings:
        raise ConfigError("field_mappings 必须为非空对象")
    if not isinstance(url_pattern, str) or not url_pattern:
        raise ConfigError("url_pattern 必须为非空字符串")

    mappings = [
        {"path": parse_field_path(field_path), "value": target_value}
        for field_path, target_value in field_mappings.items()
    ]
    mappings_json = json.dumps(mappings, ensure_ascii=False, separators=(",", ":"))
    pattern_json = json.dumps(url_pattern, ensure_ascii=False)

    return f"""var body = $response.body;

function setMappedValue(root, parts, value) {{
    var target = root;
    for (var i = 0; i < parts.length - 1; i++) {{
        var part = parts[i];
        if (target === null || typeof target !== "object" ||
            !Object.prototype.hasOwnProperty.call(target, part.name)) return false;
        target = target[part.name];
        if (part.index !== null) {{
            if (!Array.isArray(target) || part.index >= target.length) return false;
            target = target[part.index];
        }}
    }}

    var last = parts[parts.length - 1];
    if (target === null || typeof target !== "object" ||
        !Object.prototype.hasOwnProperty.call(target, last.name)) return false;
    if (last.index === null) {{
        target[last.name] = value;
        return true;
    }}
    var array = target[last.name];
    if (!Array.isArray(array) || last.index >= array.length) return false;
    array[last.index] = value;
    return true;
}}

if ($request.url.indexOf({pattern_json}) !== -1 && body) {{
    try {{
        var json = JSON.parse(body);
        var mappings = {mappings_json};
        for (var i = 0; i < mappings.length; i++) {{
            setMappedValue(json, mappings[i].path, mappings[i].value);
        }}
        body = JSON.stringify(json);
    }} catch (e) {{
        console.log("Response mapping error: " + e.message);
    }}
}}

$done({{ body }});"""


def _https_url(value, field_name):
    if not isinstance(value, str):
        raise ConfigError(f"{field_name} 必须为 HTTPS URL")
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc or "\n" in value or "\r" in value:
        raise ConfigError(f"{field_name} 必须为 HTTPS URL")
    return value


def _target(value):
    if not isinstance(value, str) or not value or any(char.isspace() for char in value):
        raise ConfigError(f"MITM hostname 不合法: {value!r}")
    host, separator, path = value.partition("/")
    if not HOST.fullmatch(host):
        raise ConfigError(f"MITM hostname 不合法: {value!r}")
    if separator and not path:
        raise ConfigError(f"hostname 路径不能为空: {value!r}")
    return host, f"{host}/{path}" if separator else host


def _hostname_pattern(host):
    """Convert a validated MITM hostname into a URL-regex fragment."""
    if not host.startswith("*."):
        return re.escape(host)

    suffix = host[2:]
    hostname, separator, port = suffix.rpartition(":")
    if separator and port.isdigit():
        suffix_pattern = re.escape(hostname) + ":" + re.escape(port)
    else:
        suffix_pattern = re.escape(suffix)
    # Keep the same semantics as MITM ``*.example.com``: require at least
    # one subdomain label, while allowing nested subdomains.
    return rf"(?:{HOST_LABEL_PATTERN}\.)+{suffix_pattern}"


def generate_plugin(app_name, script_url, mitm_hostnames, icon_url=None):
    if (
        not isinstance(app_name, str)
        or not app_name.strip()
        or "\n" in app_name
        or "\r" in app_name
    ):
        raise ConfigError("app_name 不合法")
    script_url = _https_url(script_url, "script_url")
    if icon_url:
        icon_url = _https_url(icon_url, "icon_url")
    if not isinstance(mitm_hostnames, list) or not mitm_hostnames:
        raise ConfigError("mitm_hostnames 必须为非空数组")

    targets = [_target(value) for value in mitm_hostnames]
    hosts = list(dict.fromkeys(host for host, _ in targets))
    rules = []
    for host, target in targets:
        _, separator, path = target.partition("/")
        pattern = f"^https?://{_hostname_pattern(host)}"
        if separator:
            pattern += "/" + re.escape(path)
        else:
            pattern += "/"
        rules.append(
            f"http-response {pattern} script-path={script_url}, "
            "requires-body=true, timeout=10"
        )

    icon_line = f"#!icon={icon_url}" if icon_url else "#!icon="
    return f"""#!name={app_name.strip()} 去广告
#!desc=按配置修改指定 API 响应字段。
#!homepage=https://github.com/xp9477/xp-toolkit
#!author=xp9477
{icon_line}

[Script]

{chr(10).join(rules)}

[MITM]
hostname = {", ".join(hosts)}
"""


def download_icon(url, output_path, max_bytes=2 * 1024 * 1024):
    """下载有大小上限的 HTTPS 图标。"""
    url = _https_url(url, "icon_url")
    target = Path(output_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "xp-toolkit/1"})
    with urllib.request.urlopen(request, timeout=20) as response:
        data = response.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ConfigError(f"图标超过 {max_bytes} 字节")
    target.write_bytes(data)
    return target


def _safe_filename(app_name):
    filename = re.sub(r"[^\w.-]+", "_", app_name, flags=re.UNICODE).strip("._")
    return filename or "loon-plugin"


def build(config):
    required = (
        "app_name",
        "url_pattern",
        "field_mappings",
        "mitm_hostnames",
        "script_url",
    )
    missing = [name for name in required if name not in config]
    if missing:
        raise ConfigError(f"缺少配置字段: {', '.join(missing)}")
    script = generate_vip_script(config["field_mappings"], config["url_pattern"])
    plugin = generate_plugin(
        config["app_name"],
        config["script_url"],
        config["mitm_hostnames"],
        config.get("icon_url"),
    )
    return script, plugin


def main(argv=None):
    parser = argparse.ArgumentParser(description="生成 Loon 响应改写插件")
    parser.add_argument("config", type=Path, help="JSON 配置文件")
    args = parser.parse_args(argv)
    with args.config.open(encoding="utf-8") as file:
        config = json.load(file)
    if not isinstance(config, dict):
        raise ConfigError("配置顶层必须为 JSON 对象")
    script, plugin = build(config)
    output_dir = Path(config.get("output_dir", "."))
    output_dir.mkdir(parents=True, exist_ok=True)
    script_path = output_dir / "response-mapping.js"
    plugin_path = output_dir / f"{_safe_filename(config['app_name'])}.plugin"
    script_path.write_text(script, encoding="utf-8")
    plugin_path.write_text(plugin, encoding="utf-8")
    print(f"脚本: {script_path}")
    print(f"插件: {plugin_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
