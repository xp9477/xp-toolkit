"""在 Loon 与 Clash 之间同步代理规则。"""

from __future__ import annotations

import argparse
import os
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


class RuleFormatError(ValueError):
    """规则文件包含无法安全同步的内容。"""


class RuleSyncError(ValueError):
    """一次同步包含互相冲突的来源。"""


def _path(path):
    candidate = Path(path)
    return candidate if candidate.is_absolute() else REPO_ROOT / candidate


def _error(path, line_number, line, reason):
    return RuleFormatError(f"{path}:{line_number}: {reason}: {line!r}")


def _domain(path, line_number, line, value):
    value = value.strip()
    if not value or "," in value or any(char.isspace() for char in value):
        raise _error(path, line_number, line, "域名为空或包含空白/多余逗号")
    return value


def parse_loon(path):
    source = _path(path)
    result = []
    with source.open(encoding="utf-8-sig") as file:
        for number, raw_line in enumerate(file, 1):
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("#"):
                result.append(("comment", line))
            elif line.startswith("DOMAIN-SUFFIX,"):
                result.append(
                    (
                        "domain-suffix",
                        _domain(
                            source, number, line, line.removeprefix("DOMAIN-SUFFIX,")
                        ),
                    )
                )
            elif line.startswith("DOMAIN,"):
                result.append(
                    (
                        "domain",
                        _domain(source, number, line, line.removeprefix("DOMAIN,")),
                    )
                )
            else:
                raise _error(source, number, line, "不支持的 Loon 规则")
    return result


def parse_clash(path):
    source = _path(path)
    result = []
    saw_payload = False
    with source.open(encoding="utf-8-sig") as file:
        for number, raw_line in enumerate(file, 1):
            line = raw_line.strip()
            if not line:
                continue
            if line == "payload:":
                if saw_payload or result:
                    raise _error(source, number, line, "payload 必须且只能位于首行")
                saw_payload = True
            elif not saw_payload:
                raise _error(source, number, line, "缺少首行 payload:")
            elif line.startswith("#"):
                result.append(("comment", line))
            elif line.startswith("- DOMAIN-SUFFIX,"):
                result.append(
                    (
                        "domain-suffix",
                        _domain(
                            source, number, line, line.removeprefix("- DOMAIN-SUFFIX,")
                        ),
                    )
                )
            elif line.startswith("- DOMAIN,"):
                result.append(
                    (
                        "domain",
                        _domain(source, number, line, line.removeprefix("- DOMAIN,")),
                    )
                )
            else:
                raise _error(source, number, line, "不支持的 Clash 规则")
    if not saw_payload:
        raise RuleFormatError(f"{source}: 缺少首行 payload:")
    return result


def _atomic_write(path, lines):
    target = _path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    mode = target.stat().st_mode & 0o777 if target.exists() else 0o644
    descriptor, temporary_name = tempfile.mkstemp(
        dir=target.parent, prefix=f".{target.name}."
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as file:
            file.write("\n".join(lines) + "\n")
            file.flush()
            os.fsync(file.fileno())
        temporary.chmod(mode)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def write_loon(intermediate, path):
    prefixes = {"domain": "DOMAIN", "domain-suffix": "DOMAIN-SUFFIX"}
    lines = [
        value if kind == "comment" else f"{prefixes[kind]},{value}"
        for kind, value in intermediate
    ]
    _atomic_write(path, lines)


def write_clash(intermediate, path):
    prefixes = {"domain": "DOMAIN", "domain-suffix": "DOMAIN-SUFFIX"}
    lines = ["payload:"] + [
        value if kind == "comment" else f"  - {prefixes[kind]},{value}"
        for kind, value in intermediate
    ]
    _atomic_write(path, lines)


def parse(rule_format, path, *, policy=None):
    if rule_format == "loon":
        return parse_loon(path)
    if rule_format == "clash":
        return parse_clash(path)
    raise ValueError(f"unknown format: {rule_format}")


RULE_SETS = [
    {
        "name": "Self-Direct",
        "policy": "Self-Direct",
        "loon": "proxy/loon/Self-Direct.list",
        "clash": "proxy/clash/Self-Direct.yaml",
    },
    {
        "name": "Self-Proxy",
        "policy": "Self-Proxy",
        "loon": "proxy/loon/Self-Proxy.list",
        "clash": "proxy/clash/Self-Proxy.yaml",
    },
]


def _changed_path(path):
    candidate = Path(path)
    if candidate.is_absolute():
        try:
            candidate = candidate.resolve().relative_to(REPO_ROOT)
        except ValueError:
            return candidate.resolve().as_posix()
    return candidate.as_posix().removeprefix("./")


def sync_from(changed_files, *, rule_sets=None):
    """同步明确来源；多个来源同时变化时，只有内容一致才允许继续。"""
    changed = {_changed_path(path) for path in changed_files}
    written = []
    for rule_set in RULE_SETS if rule_sets is None else rule_sets:
        formats = [
            fmt
            for fmt in ("loon", "clash")
            if _changed_path(rule_set[fmt]) in changed
        ]
        if not formats:
            continue
        parsed = {
            fmt: parse(fmt, rule_set[fmt], policy=rule_set["policy"]) for fmt in formats
        }
        source_format = formats[0]
        intermediate = parsed[source_format]
        if any(value != intermediate for value in parsed.values()):
            raise RuleSyncError(
                f"[{rule_set['name']}] 同一次提交修改了内容不一致的来源: {', '.join(formats)}"
            )
        print(
            f"[{rule_set['name']}] source={source_format}, file={rule_set[source_format]}"
        )
        for fmt in ("loon", "clash"):
            if fmt in formats:
                continue
            target = rule_set[fmt]
            if fmt == "loon":
                write_loon(intermediate, target)
            else:
                write_clash(intermediate, target)
            written.append(target)
            print(f"  -> wrote {target}")
    return written


def main(argv=None):
    parser = argparse.ArgumentParser(description="同步 Loon 与 Clash 的代理规则")
    parser.add_argument("files", nargs="*", help="本次发生变化的规则文件")
    args = parser.parse_args(argv)
    sync_from(args.files or [rule_set["loon"] for rule_set in RULE_SETS])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
