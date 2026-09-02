"""校验三端代理规则的一致性、重复项、语义冲突和公开链接。"""

from __future__ import annotations

import argparse
import sys
import urllib.error
import urllib.request

from sync_rules import RULE_SETS, RuleFormatError, parse

RAW_BASE = "https://raw.githubusercontent.com/xp9477/xp-toolkit/main/proxy/clash"


def rules_of(intermediate):
    return [(kind, value) for kind, value in intermediate if kind != "comment"]


def _normalized(value):
    return value.casefold().rstrip(".")


def rules_overlap(left, right):
    """判断精确域名和域名后缀在解析语义上是否有交集。"""
    left_kind, left_value = left
    right_kind, right_value = right
    left_domain = _normalized(left_value)
    right_domain = _normalized(right_value)
    if left_kind == right_kind == "domain":
        return left_domain == right_domain
    if left_kind == "domain":
        return left_domain == right_domain or left_domain.endswith(f".{right_domain}")
    if right_kind == "domain":
        return right_domain == left_domain or right_domain.endswith(f".{left_domain}")
    return (
        left_domain == right_domain
        or left_domain.endswith(f".{right_domain}")
        or right_domain.endswith(f".{left_domain}")
    )


def check_consistency(errors):
    parsed_sets = {}
    for rule_set in RULE_SETS:
        parsed = {
            fmt: parse(fmt, rule_set[fmt], policy=rule_set["policy"])
            for fmt in ("loon", "clash")
        }
        baseline = parsed["loon"]
        for fmt in ("clash",):
            if parsed[fmt] != baseline:
                errors.append(
                    f"[{rule_set['name']}] {fmt} 与 loon 不一致，请运行 sync_rules.py"
                )
        parsed_sets[rule_set["name"]] = baseline
    return parsed_sets


def check_duplicates(parsed_sets, errors):
    for name, intermediate in parsed_sets.items():
        seen = set()
        for kind, value in rules_of(intermediate):
            key = (kind, _normalized(value))
            if key in seen:
                errors.append(f"[{name}] 重复规则：{kind},{value}")
            seen.add(key)


def check_conflicts(parsed_sets, errors):
    direct = rules_of(parsed_sets["Self-Direct"])
    proxy = rules_of(parsed_sets["Self-Proxy"])
    for direct_rule in direct:
        for proxy_rule in proxy:
            if rules_overlap(direct_rule, proxy_rule):
                errors.append(
                    "域名冲突："
                    f"Direct {direct_rule[0]},{direct_rule[1]} 与 "
                    f"Proxy {proxy_rule[0]},{proxy_rule[1]} 覆盖范围重叠"
                )


def check_urls(errors):
    for rule_set in RULE_SETS:
        name = rule_set["name"]
        url = f"{RAW_BASE}/{name}.yaml"
        request = urllib.request.Request(url, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                if response.status != 200:
                    errors.append(f"[{name}] HTTP {response.status}: {url}")
                    continue
                first_line = response.readline().decode("utf-8-sig").strip()
                if first_line != "payload:":
                    errors.append(
                        f"[{name}] 响应首行不是 payload:，实际为 {first_line!r}"
                    )
                else:
                    print(f"  {name}: 200 OK")
        except (urllib.error.URLError, TimeoutError, UnicodeError) as exc:
            errors.append(f"[{name}] 无法访问 {url}: {exc}")


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true", help="跳过 URL 可访问性检查")
    args = parser.parse_args(argv)
    errors = []
    try:
        parsed_sets = check_consistency(errors)
        check_duplicates(parsed_sets, errors)
        check_conflicts(parsed_sets, errors)
    except (OSError, RuleFormatError) as exc:
        errors.append(str(exc))
    if not args.offline:
        check_urls(errors)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print("规则校验通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
