"""
解析mitmproxy flows.json，智能查找VIP/会员/用户状态相关接口
自动读取响应体内容，分析JSON结构中的VIP字段
"""

import codecs
import json
import os
import re
import sys

# 默认搜索关键词
DEFAULT_KEYWORDS = [
    "vip",
    "member",
    "user",
    "account",
    "profile",
    "auth",
    "login",
    "pay",
    "order",
    "subscription",
    "premium",
    "pro",
    "status",
    "config",
    "info",
    "setting",
    "switch",
    "level",
]

# VIP相关字段模式
VIP_FIELD_PATTERNS = [
    "vip",
    "isVip",
    "is_vip",
    "isVipUser",
    "member",
    "isMember",
    "is_member",
    "premium",
    "isPremium",
    "paid",
    "isPaid",
    "payStatus",
    "pay_status",
    "expire",
    "expireTime",
    "expire_time",
    "expiry",
    "level",
    "userLevel",
    "user_level",
]


def _read_json(filepath):
    """Read JSON exported as UTF-8 or BOM-marked UTF-16."""
    with open(filepath, "rb") as file:
        raw = file.read()
    if raw.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        text = raw.decode("utf-16")
    else:
        text = raw.decode("utf-8-sig")
    return json.loads(text)


def _normalized_field(value):
    return re.sub(r"[^a-z0-9]", "", str(value).casefold())


def _is_vip_field(key):
    normalized_key = _normalized_field(key)
    return any(
        _normalized_field(pattern) in normalized_key for pattern in VIP_FIELD_PATTERNS
    )


def parse_flows(filepath):
    """解析mitmproxy flows文件"""
    data = _read_json(filepath)
    if not isinstance(data, (list, dict)):
        raise ValueError("flows JSON 顶层必须是数组或对象")
    flows = data if isinstance(data, list) else data.get("flows", [])
    if not isinstance(flows, list):
        raise ValueError("flows 必须是数组")
    return flows


def find_vip_fields(obj, path="", results=None):
    """递归查找JSON中的VIP相关字段"""
    if results is None:
        results = []

    if isinstance(obj, dict):
        for key, value in obj.items():
            current_path = f"{path}.{key}" if path else key
            # 检查字段名是否匹配VIP模式
            if _is_vip_field(key):
                results.append(
                    {"path": current_path, "value": value, "type": type(value).__name__}
                )
            # 递归查找
            find_vip_fields(value, current_path, results)
    elif isinstance(obj, list):
        for i, item in enumerate(obj[:5]):  # 只检查前5个元素
            find_vip_fields(item, f"{path}[{i}]", results)

    return results


def analyze_flows(flows, keywords=None):
    """分析flows，查找VIP相关接口并读取响应内容"""
    if keywords is None:
        keywords = DEFAULT_KEYWORDS

    results = []
    for flow in flows:
        if not isinstance(flow, dict):
            continue
        req = flow.get("request", {})
        resp = flow.get("response", {})
        if not isinstance(req, dict) or not isinstance(resp, dict):
            continue
        host = req.get("host", "")
        path = req.get("path", "")
        method = req.get("method", "")
        status = resp.get("status_code", 0)
        clen = resp.get("contentLength") or 0

        # 只关注有响应的小数据量接口
        if clen > 0 and clen < 20000:
            path_lower = path.lower()
            host_lower = host.lower()

            # 关键词匹配
            if any(k in path_lower for k in keywords) or any(
                k in host_lower for k in keywords
            ):
                # 尝试读取响应内容
                content = flow.get("content", "")
                vip_fields = []

                if content:
                    try:
                        if isinstance(content, str):
                            json_content = json.loads(content)
                        else:
                            json_content = content
                        vip_fields = find_vip_fields(json_content)
                    except Exception:
                        pass

                results.append(
                    {
                        "host": host,
                        "path": path,
                        "method": method,
                        "status": status,
                        "contentLength": clen,
                        "headers": req.get("headers", []),
                        "responseHeaders": resp.get("headers", []),
                        "vipFields": vip_fields,
                    }
                )

    # 按VIP字段数量排序，优先显示有VIP字段的接口
    results.sort(key=lambda x: len(x.get("vipFields", [])), reverse=True)

    return results


def main():
    if len(sys.argv) < 2:
        print("用法: python find_endpoints.py <flows.json路径> [关键词1,关键词2,...]")
        print("示例: python find_endpoints.py flows.json 'vip,user,pay'")
        sys.exit(1)

    filepath = sys.argv[1]
    keywords = None

    if len(sys.argv) > 2:
        keywords = sys.argv[2].split(",")

    if not os.path.exists(filepath):
        print(f"错误: 文件不存在 {filepath}")
        sys.exit(1)

    flows = parse_flows(filepath)
    results = analyze_flows(flows, keywords)

    print(f"\n找到 {len(results)} 个可能的VIP相关接口:\n")

    for i, r in enumerate(results, 1):
        print(f"{'=' * 80}")
        print(f"[{i}] {r['method']} {r['host']}{r['path'][:150]}")
        print(f"    Status: {r['status']}, Length: {r['contentLength']}")

        # 显示找到的VIP字段
        if r.get("vipFields"):
            print("    VIP Fields:")
            for f in r["vipFields"][:5]:
                print(f"      {f['path']} = {f['value']} ({f['type']})")

    return results


if __name__ == "__main__":
    main()
