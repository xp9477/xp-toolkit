---
name: loon-plugin-maker
description: Create Loon proxy plugins by analyzing mitmproxy traffic and modifying API responses. Use when user wants to modify iOS app behavior through Loon proxy - including unlocking features, removing limitations, spoofing status, bypassing restrictions, or any other API response modification. Includes mitmproxy addon for automatic response capture and comprehensive analysis scripts.
---

# Loon 插件生成器

## 工作流程

### 1. 配置 mitmproxy 自动保存响应

```bash
mitmdump -s <skill_dir>/scripts/save_responses.py -p 8080
```

脚本自动将所有响应保存到 `mitm_responses/` 目录。

### 2. 抓包并全面分析

手机操作 App 触发请求后，运行分析：

**全面分析所有响应：**
```bash
python <skill_dir>/scripts/analyze_responses.py
```

**按关键词搜索：**
```bash
python <skill_dir>/scripts/analyze_responses.py "vip"
```

### 3. 生成插件

根据分析结果创建配置文件，运行生成脚本：

```bash
python <skill_dir>/scripts/generate_plugin.py config.json
```

## 脚本编写原则

### 防御性编码

```javascript
let body = $response.body;
if (body) {                    // 检查 body 是否存在
    try {
        let obj = JSON.parse(body);
        let target = obj.data || obj;
        // 修改逻辑
        body = JSON.stringify(obj);
    } catch (e) {
        // 解析失败就原样返回，不影响使用
    }
}
$done({ body });
```

### 精准过滤而不是全拒绝

```javascript
// 删除特定广告字段，保留其他功能
const AD_KEYS = ["ad_config", "splash_ad"];
for (let key of AD_KEYS) {
    delete target[key];
}
```

### 拦截策略选择

| 策略 | 安全性 | 适用场景 |
|------|--------|----------|
| `reject-dict` | ⭐⭐⭐ | JSON API，返回 `{}` |
| `script-response-body` | ⭐⭐⭐ | 需要保留部分数据 |
| `reject` | ⭐ | 非必要请求，最激进 |

## 配置文件格式

```json
{
    "app_name": "App名称",
    "url_pattern": "/api/config",
    "field_mappings": {
        "data.user.vip": true,
        "data.payStatus": true
    },
    "mitm_hostnames": ["api.example.com"],
    "script_url": "https://github.com/user/repo/raw/main/script.js",
    "icon_url": "https://example.com/icon.png"
}
```

## 注意事项

1. **字段路径**：使用 `.` 分隔的 JSON 路径
2. **只改必要字段**：避免修改核心逻辑字段导致闪退
3. **先测试**：确认无异常再扩展修改范围
4. **MITM 配置**：插件需要配置 MITM hostname
5. **防御性编码**：始终检查 body 存在性和 JSON 解析错误
