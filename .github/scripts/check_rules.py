"""
规则校验脚本
1. 同一域名不得同时出现在 Self-Direct 与 Self-Proxy
2. 三端（loon/clash/quanx）解析后的中间态必须完全一致
3. OpenClash config 中的 rule-provider URL 可访问（--offline 可跳过）
"""
import argparse
import sys
import urllib.error
import urllib.request

from sync_rules import RULE_SETS, parse

RAW_BASE = "https://raw.githubusercontent.com/xp9477/xp-toolkit/main/proxy/clash"


def domains_of(intermediate):
    return {value for typ, value in intermediate if typ != "comment"}


def check_consistency(errors):
    """三端解析结果必须一致"""
    for rule_set in RULE_SETS:
        parsed = {fmt: parse(fmt, rule_set[fmt]) for fmt in ("loon", "clash", "quanx")}
        baseline = parsed["loon"]
        for fmt in ("clash", "quanx"):
            if parsed[fmt] != baseline:
                errors.append(
                    f"[{rule_set['name']}] {fmt} 与 loon 不一致，请运行 sync_rules.py"
                )
    return {rule_set["name"]: parse("loon", rule_set["loon"]) for rule_set in RULE_SETS}


def check_conflicts(parsed_sets, errors):
    """同一域名不得同时出现在 Direct 与 Proxy"""
    direct = domains_of(parsed_sets["Self-Direct"])
    proxy = domains_of(parsed_sets["Self-Proxy"])
    for domain in sorted(direct & proxy):
        errors.append(f"域名冲突：{domain} 同时存在于 Self-Direct 与 Self-Proxy")


def check_urls(errors):
    """rule-provider URL 必须可访问"""
    for rule_set in RULE_SETS:
        name = rule_set["name"]
        url = f"{RAW_BASE}/{name}.yaml"
        request = urllib.request.Request(url, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                if response.status != 200:
                    errors.append(f"[{name}] HTTP {response.status}: {url}")
                    continue
                first_line = response.readline().decode("utf-8").strip()
                if first_line != "payload:":
                    errors.append(f"[{name}] 响应首行不是 payload:，实际为 {first_line!r}")
                else:
                    print(f"  {name}: 200 OK")
        except (urllib.error.URLError, TimeoutError) as exc:
            errors.append(f"[{name}] 无法访问 {url}: {exc}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true", help="跳过 URL 可访问性检查")
    args = parser.parse_args()

    errors = []
    parsed_sets = check_consistency(errors)
    check_conflicts(parsed_sets, errors)
    if not args.offline:
        check_urls(errors)

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
    print("规则校验通过")


if __name__ == "__main__":
    main()
