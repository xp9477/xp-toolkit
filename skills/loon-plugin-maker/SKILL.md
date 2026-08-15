---
name: loon-plugin-maker
description: Create Loon proxy plugins by analyzing mitmproxy traffic and modifying API responses. Use when user wants to modify iOS app behavior through Loon proxy - including unlocking features, removing limitations, spoofing status, bypassing restrictions, or any other API response modification. Includes mitmproxy addon for automatic response capture and comprehensive analysis scripts.
---

# Loon 插件生成器

## 工作流程

### 1. 配置 mitmproxy 自动保存响应

抓包代理是高权限信任边界。请按 mitmproxy 官方说明在一次性隔离环境安装最新修复版，
并在开始前验证版本与依赖审计：

```bash
mitmdump --version
python -m pip-audit
```

不要把 mitmproxy 安装进 xp-toolkit 的青龙运行时；依赖审计失败时停止抓包，不要添加
忽略项。保存脚本采用 mitmdump 的 duck-typed addon 接口，本身不直接导入 mitmproxy。

```bash
MITM_CAPTURE_HOSTS=api.example.com,account.example.com \
MITM_CAPTURE_BODY_MODE=structure \
  mitmdump -s <skill_dir>/scripts/save_responses.py -p 8080
```

脚本只保存白名单 hostname 的响应到 `mitm_responses/`。正文默认为 `metadata`
（不落盘）；分析 JSON 结构时显式设置 `structure`，它保留键和数值/布尔类型（数值
归零），脱敏所有字符串与敏感键，并忽略纯文本/XML。认证头、Cookie 和敏感查询参数始终脱敏，
响应体上限为 1 MiB；未设置白名单时不抓取。新建的抓包叶目录权限为 `0700`，已有
目录权限不会被修改，文件权限为 `0600`。自定义抓包目录的上级目录必须已存在，脚本
不会隐式创建或修改上级目录。

仅在隔离测试账号和可控数据上确需原文时，才显式设置
`MITM_CAPTURE_BODY_MODE=unsafe`。该模式可能把凭据和个人数据写入磁盘；使用后立即
安全删除样本，禁止提交到版本库。

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

分析汇总导出的 `flows.json` 时运行：

```bash
python <skill_dir>/scripts/find_endpoints.py flows.json "vip,user,pay"
```

端点解析器接受 UTF-8、UTF-8-SIG，以及带 BOM 的 UTF-16 LE/BE；没有 BOM 的
UTF-16 不做猜测，先转换成 UTF-8。

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
    "script_url": "https://example.com/response-mapping.js",
    "icon_url": "https://example.com/icon.png"
}
```

## 注意事项

1. **字段路径**：使用 `.` 分隔的 JSON 路径
2. **只改必要字段**：避免修改核心逻辑字段导致闪退
3. **先测试**：确认无异常再扩展修改范围
4. **MITM 配置**：插件需要配置 MITM hostname；`*.example.com` 匹配一个或多个
   子域层级，不匹配根域 `example.com`
5. **防御性编码**：始终检查 body 存在性和 JSON 解析错误
6. **类型保持**：JSON 字符串 `"0"` 与数字 `0` 含义不同，不做隐式转换
7. **远程脚本**：`script_url` 必须明确配置为 HTTPS 地址
