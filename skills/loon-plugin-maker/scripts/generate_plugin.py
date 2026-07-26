#!/usr/bin/env python3
"""
生成Loon VIP伪装插件 - 通用版本
支持自定义字段映射和多种响应结构
"""
import json
import os
import re
import sys
import urllib.request


def parse_field_path(path):
    """解析字段路径，支持点号和括号语法"""
    parts = []
    for part in path.split('.'):
        # 处理 array[0] 格式
        match = re.match(r'(\w+)\[(\d+)\]', part)
        if match:
            parts.append({'type': 'array', 'name': match.group(1), 'index': int(match.group(2))})
        else:
            parts.append({'type': 'object', 'name': part})
    return parts

def generate_vip_script(field_mappings, url_pattern):
    """根据字段映射生成VIP伪装脚本"""
    
    # 生成字段修改代码
    field_code = ""
    for field_path, target_value in field_mappings.items():
        parts = parse_field_path(field_path)
        
        # 构建访问路径
        accessor = "json"
        checks = []
        for part in parts:
            if part['type'] == 'array':
                checks.append(f'{accessor}["{part["name"]}"]')
                accessor += f'["{part["name"]}"][{part["index"]}]'
            else:
                checks.append(f'{accessor}["{part["name"]}"]')
                accessor += f'["{part["name"]}"]'
        
        # 生成条件检查和赋值
        condition = " && ".join(checks[:-1]) if len(checks) > 1 else checks[0]
        
        if isinstance(target_value, bool):
            value_str = "true" if target_value else "false"
        elif isinstance(target_value, int):
            value_str = str(target_value)
        elif isinstance(target_value, str):
            # 检查是否是特殊值
            if target_value.upper() == "TRUE":
                value_str = "true"
            elif target_value.upper() == "FALSE":
                value_str = "false"
            elif target_value.isdigit():
                value_str = target_value
            else:
                value_str = f'"{target_value}"'
        else:
            value_str = json.dumps(target_value)
        
        field_code += f'        if ({condition}) {accessor} = {value_str};\n'
    
    script = f'''var body = $response.body;

if ($request.url.indexOf('{url_pattern}') !== -1) {{
    try {{
        var json = JSON.parse(body);
{field_code}        body = JSON.stringify(json);
    }} catch(e) {{
        console.log("VIP Spoof Error: " + e.message);
    }}
}}

$done({{ body }});'''
    
    return script

def generate_plugin(app_name, script_url, mitm_hostnames, icon_url=None):
    """生成Loon插件文件"""
    icon_line = f"#!icon={icon_url}" if icon_url else "#!icon="
    
    script_rules = ""
    for hostname in mitm_hostnames:
        # 从hostname提取路径模式
        if '/' in hostname:
            pattern = f'^https?://{re.escape(hostname).replace(chr(92)+"/", "/")}'
        else:
            pattern = f'^https?://{re.escape(hostname)}/'
        
        script_rules += f'''http-response {pattern} script-path={script_url}, requires-body=true, timeout=10
'''
    
    plugin = f'''#!name={app_name}去广告
#!desc=通过伪装VIP会员状态实现免广告。
#!homepage=https://github.com/xp9477/Rules
#!author=xp9477
{icon_line}

[Script]

{script_rules}
[MITM]
hostname = {', '.join(mitm_hostnames)}
'''
    return plugin

def download_icon(url, output_path):
    """下载App图标"""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    urllib.request.urlretrieve(url, output_path)
    return output_path

def main():
    if len(sys.argv) < 4:
        print("""用法: python generate_loon_plugin.py <配置文件>

配置文件格式 (JSON):
{
    "app_name": "App名称",
    "app_bundle_id": "bundle.id",
    "url_pattern": "/config/info",
    "field_mappings": {
        "data.user.vip": true,
        "data.payStatus": true,
        "data.adTypeShow": "",
        "data.adShowTime": "0"
    },
    "mitm_hostnames": ["api.example.com"],
    "icon_url": "https://example.com/icon.png"
}
""")
        sys.exit(1)
    
    config_path = sys.argv[1]
    
    if not os.path.exists(config_path):
        print(f"错误: 配置文件不存在 {config_path}")
        sys.exit(1)
    
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    # 生成脚本
    script_content = generate_vip_script(
        config['field_mappings'],
        config['url_pattern']
    )
    
    # 生成插件
    plugin_content = generate_plugin(
        config['app_name'],
        config.get('script_url', 'https://github.com/xp9477/Rules/raw/main/Loon/script/vip-spoof.js'),
        config['mitm_hostnames'],
        config.get('icon_url')
    )
    
    # 输出到标准输出
    print("===== 脚本内容 =====")
    print(script_content)
    print("\n===== 插件内容 =====")
    print(plugin_content)
    
    # 保存到文件
    output_dir = config.get('output_dir', '.')
    os.makedirs(output_dir, exist_ok=True)
    
    script_path = os.path.join(output_dir, 'vip-spoof.js')
    plugin_path = os.path.join(output_dir, f"{config['app_name']}.plugin")
    
    with open(script_path, 'w', encoding='utf-8') as f:
        f.write(script_content)
    
    with open(plugin_path, 'w', encoding='utf-8') as f:
        f.write(plugin_content)
    
    print("\n文件已保存:")
    print(f"  脚本: {script_path}")
    print(f"  插件: {plugin_path}")

if __name__ == '__main__':
    main()
