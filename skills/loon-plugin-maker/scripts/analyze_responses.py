#!/usr/bin/env python3
"""
全面分析 mitm_responses 目录中的所有响应
展示完整的 JSON 结构和所有字段
"""
import json
import os
import sys

SAVE_DIR = "mitm_responses"

def analyze_all():
    if not os.path.exists(SAVE_DIR):
        print(f"错误：目录 {SAVE_DIR} 不存在")
        sys.exit(1)
    
    files = sorted([f for f in os.listdir(SAVE_DIR) if f.endswith('.json')])
    print(f"共 {len(files)} 个响应文件\n")
    
    for filename in files:
        filepath = os.path.join(SAVE_DIR, filename)
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        host = data.get('host', '')
        path = data.get('path', '')
        method = data.get('method', '')
        status = data.get('status_code')
        length = data.get('content_length')
        body = data.get('body')
        
        print(f"{'='*80}")
        print(f"[{filename}]")
        print(f"{method} {host}{path}")
        print(f"Status: {status}, Length: {length}")
        
        if isinstance(body, dict):
            print("\nJSON 结构:")
            print_json_tree(body, indent=2)
        elif isinstance(body, str) and len(body) > 0:
            print(f"\nBody (text): {body[:200]}")
        
        print()

def print_json_tree(obj, indent=2, max_depth=4, current_depth=0):
    """递归打印 JSON 树结构"""
    if current_depth >= max_depth:
        print(" " * indent + "...")
        return
    
    if isinstance(obj, dict):
        for key, value in obj.items():
            if isinstance(value, (dict, list)):
                print(" " * indent + f"{key}:")
                print_json_tree(value, indent + 2, max_depth, current_depth + 1)
            else:
                value_str = format_value(value)
                print(" " * indent + f"{key}: {value_str}")
    elif isinstance(obj, list):
        if len(obj) == 0:
            print(" " * indent + "[]")
        else:
            print(" " * indent + f"[{len(obj)} items]")
            for i, item in enumerate(obj[:3]):
                if isinstance(item, (dict, list)):
                    print(" " * indent + f"  [{i}]:")
                    print_json_tree(item, indent + 4, max_depth, current_depth + 1)
                else:
                    print(" " * indent + f"  [{i}]: {format_value(item)}")
            if len(obj) > 3:
                print(" " * indent + f"  ... ({len(obj) - 3} more)")

def format_value(value):
    """格式化值的显示"""
    if value is None:
        return "null"
    elif isinstance(value, bool):
        return f"{value} (bool)"
    elif isinstance(value, int):
        return f"{value} (int)"
    elif isinstance(value, float):
        return f"{value} (float)"
    elif isinstance(value, str):
        if len(value) > 50:
            return f'"{value[:50]}..." (str, len={len(value)})'
        else:
            return f'"{value}" (str)'
    else:
        return str(value)

def extract_all_fields(obj, path="", results=None):
    """提取所有字段路径和值"""
    if results is None:
        results = []
    
    if isinstance(obj, dict):
        for key, value in obj.items():
            current_path = f"{path}.{key}" if path else key
            if isinstance(value, (dict, list)):
                extract_all_fields(value, current_path, results)
            else:
                results.append({
                    'path': current_path,
                    'value': value,
                    'type': type(value).__name__
                })
    elif isinstance(obj, list):
        for i, item in enumerate(obj[:5]):
            extract_all_fields(item, f"{path}[{i}]", results)
    
    return results

def search_by_keyword(keyword):
    """按关键词搜索所有字段"""
    if not os.path.exists(SAVE_DIR):
        print(f"错误：目录 {SAVE_DIR} 不存在")
        sys.exit(1)
    
    files = sorted([f for f in os.listdir(SAVE_DIR) if f.endswith('.json')])
    results = []
    
    for filename in files:
        filepath = os.path.join(SAVE_DIR, filename)
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        body = data.get('body')
        if not isinstance(body, dict):
            continue
        
        fields = extract_all_fields(body)
        matched = [f for f in fields if keyword.lower() in f['path'].lower() or 
                   (isinstance(f['value'], str) and keyword.lower() in f['value'].lower())]
        
        if matched:
            results.append({
                'host': data.get('host'),
                'path': data.get('path'),
                'fields': matched,
                'filename': filename
            })
    
    print(f"\n搜索 '{keyword}' 的结果:\n")
    for r in results:
        print(f"{'='*60}")
        print(f"{r['host']}{r['path']}")
        print(f"File: {r['filename']}")
        for f in r['fields']:
            print(f"  {f['path']} = {f['value']} ({f['type']})")
        print()

def main():
    if len(sys.argv) > 1:
        # 搜索模式
        keyword = sys.argv[1]
        search_by_keyword(keyword)
    else:
        # 全面分析模式
        analyze_all()

if __name__ == '__main__':
    main()
