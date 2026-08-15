# Scriptable

iOS [Scriptable](https://scriptable.app) 组件与脚本。

## AI-Quota.js

支持小号、中号、大号和超大号组件，监控 **SuperGrok**、**ChatGPT Plus**、**Google AI Pro** 的剩余用量。

背景不着色，跟随 iOS 小组件系统浅色 / 深色。排版按 Notion / Instapaper：单色 logo、发丝分割线、New York 剩余百分比。

### 数据源

| 套餐 | 怎么取 | 主数字 |
|---|---|---|
| SuperGrok | 本脚本读 CPA 的 xAI 认证，再请求 `billing?format=credits` | 周额度剩余 |
| ChatGPT Plus | 本脚本读 CPA 的 OpenAI / Codex 认证，再请求 `backend-api/wham/usage` | 按窗口时长判断，现在多为 7 天 |
| Google AI Pro | 本脚本读 CPA 的 Anti Gravity 认证，再请求 `retrieveUserQuotaSummary` | 本周 / Gemini 桶 |

ChatGPT 不要按 `primary_window = 5 小时` 硬套。2026 年 7 月起 Plus / Pro 常把 5 小时窗口拿掉，`primary_window` 直接是 `604800`（7 天），`secondary_window` 为 `null`。TokenYou、CodexBar、CodeBurn 都是用窗口时长打标签，不是用字段位置。

这些是各产品网页用量页自己的接口，非官方公开 API，字段可能变。脚本只读配额。

### 安装

1. 用 Scriptable 导入 `AI-Quota.js`（或复制内容新建脚本）
2. 在 App 内运行一次，填写 CPA 地址和 API Key
3. 长按桌面 → 添加 Scriptable → 选本脚本 → 选择需要的尺寸

以前配过 CPA 的话，地址和 Key 还在 Keychain 里，不用重填。CPA 里需要有 xAI、OpenAI/Codex、Anti Gravity 三份认证。

### 配置

| 方式 | 说明 |
|---|---|
| Keychain | App 内运行写入（推荐） |
| 小组件参数 JSON | `{"cpaBaseUrl":"https://host:port","cpaApiKey":"..."}` |

**不要把真实 Token / Cookie 提交进仓库。**

CPA 地址默认只接受 HTTPS；仅 `localhost`、`127.0.0.1` 和 `::1` 可显式使用 HTTP。地址不能包含
用户名、密码、路径、查询或片段，避免管理 Key 被转发到非预期目标。小组件参数会包含明文 Key，只有在
设备与 Scriptable 配置可信时才使用；优先选择 Keychain。

### 刷新

组件请求 15 分钟后再刷新，本地缓存 10 分钟。

桌面小组件实际间隔由 iOS 决定，常见 15–30 分钟，锁屏或省电时更久。`refreshAfterDate` 只是最早可刷新时间，不是定时器。

别人怎么做：浏览器插件（TokenYou）5 分钟拉一次；菜单栏应用（Codex Rate Watcher）60 秒一次，因为要算消耗速度。周额度变化慢，Scriptable 再快也刷不动，15 分钟够用，也少打非官方接口。

点某一行会打开对应网站。数字是 **剩余百分比**；低于约 22% 进度条改为琥珀色。
