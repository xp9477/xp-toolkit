"""
跨格式规则同步脚本
支持从 Loon / Clash / QuanX 中的一种格式解析，并生成其余两种格式。
中间态：[(type, value)]，其中 type 为 comment / domain / domain-suffix。
"""
import os
import sys

# 脚本位于 .github/scripts/，向上两级即仓库根目录
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(REPO_ROOT)


def parse_loon(path):
    """解析 Loon .list -> 中间态列表"""
    result = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\r\n").strip()
            if not line:
                continue
            if line.startswith("#"):
                result.append(("comment", line))
            elif line.startswith("DOMAIN-SUFFIX,"):
                result.append(("domain-suffix", line.split(",")[1]))
            elif line.startswith("DOMAIN,"):
                result.append(("domain", line.split(",")[1]))
    return result


def parse_clash(path):
    """解析 Clash .yaml -> 中间态列表"""
    result = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\r\n").strip()
            if not line or line == "payload:":
                continue
            if line.startswith("#"):
                result.append(("comment", line))
            elif line.startswith("- DOMAIN-SUFFIX,"):
                result.append(("domain-suffix", line[len("- DOMAIN-SUFFIX,"):]))
            elif line.startswith("- DOMAIN,"):
                result.append(("domain", line[len("- DOMAIN,"):]))
    return result


def parse_quanx(path):
    """解析 QuanX .list -> 中间态列表"""
    result = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\r\n").strip()
            if not line:
                continue
            if line.startswith("#"):
                result.append(("comment", line))
            elif line.startswith("HOST-SUFFIX,"):
                parts = line.split(",")
                result.append(("domain-suffix", parts[1]))
            elif line.startswith("HOST,"):
                parts = line.split(",")
                result.append(("domain", parts[1]))
    return result


def write_loon(intermediate, path):
    lines = []
    for typ, val in intermediate:
        if typ == "comment":
            lines.append(val)
        elif typ == "domain-suffix":
            lines.append(f"DOMAIN-SUFFIX,{val}")
        elif typ == "domain":
            lines.append(f"DOMAIN,{val}")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def write_clash(intermediate, path):
    lines = ["payload:"]
    for typ, val in intermediate:
        if typ == "comment":
            lines.append(val)
        elif typ == "domain-suffix":
            lines.append(f"  - DOMAIN-SUFFIX,{val}")
        elif typ == "domain":
            lines.append(f"  - DOMAIN,{val}")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def write_quanx(intermediate, path, policy):
    lines = []
    for typ, val in intermediate:
        if typ == "comment":
            lines.append(val)
        elif typ == "domain-suffix":
            lines.append(f"HOST-SUFFIX,{val},{policy}")
        elif typ == "domain":
            lines.append(f"HOST,{val},{policy}")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def parse(fmt, path):
    if fmt == "loon":
        return parse_loon(path)
    if fmt == "clash":
        return parse_clash(path)
    if fmt == "quanx":
        return parse_quanx(path)
    raise ValueError(f"unknown format: {fmt}")


RULE_SETS = [
    {
        "name": "Self-Direct",
        "policy": "Self-Direct",
        "loon": "proxy/loon/Self-Direct.list",
        "clash": "proxy/clash/Self-Direct.yaml",
        "quanx": "proxy/quanx/Self-Direct.list",
    },
    {
        "name": "Self-Proxy",
        "policy": "Self-Proxy",
        "loon": "proxy/loon/Self-Proxy.list",
        "clash": "proxy/clash/Self-Proxy.yaml",
        "quanx": "proxy/quanx/Self-Proxy.list",
    },
]


def sync_from(changed_files):
    """
    根据一组已变更文件路径，找出对应规则集和格式，
    以变更文件为唯一数据源，更新同一规则集的其余两种格式。
    """
    changed_norm = {p.replace("\\", "/") for p in changed_files}

    for rs in RULE_SETS:
        source_fmt = None
        for fmt in ("loon", "clash", "quanx"):
            norm = rs[fmt].replace("\\", "/")
            if norm in changed_norm or any(
                norm.endswith(c.replace("\\", "/").lstrip("/")) for c in changed_norm
            ):
                source_fmt = fmt
                break

        if source_fmt is None:
            continue

        source_path = rs[source_fmt]
        print(f"[{rs['name']}] source={source_fmt}, file={source_path}")
        intermediate = parse(source_fmt, source_path)

        for fmt in ("loon", "clash", "quanx"):
            if fmt == source_fmt:
                continue
            target = rs[fmt]
            os.makedirs(os.path.dirname(target), exist_ok=True)
            if fmt == "loon":
                write_loon(intermediate, target)
            elif fmt == "clash":
                write_clash(intermediate, target)
            else:
                write_quanx(intermediate, target, rs["policy"])
            print(f"  -> wrote {target}")


def main():
    if len(sys.argv) > 1:
        changed = sys.argv[1:]
        sync_from(changed)
    else:
        all_loon = [rs["loon"] for rs in RULE_SETS]
        sync_from(all_loon)


if __name__ == "__main__":
    main()
