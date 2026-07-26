# Scriptable

iOS [Scriptable](https://scriptable.app) 组件与脚本。

## CPA-Quota.js

在桌面显示 CPA（CLI Proxy API）里的 **Anti Gravity** 与 **Grok** 配额。

### 样式

深色紫黑背景、圆环已用百分比、分项进度条、底部 chips，参考 Claude Code Usage 小组件。

### 数据源

1. `GET /v0/management/auth-files` 发现 `antigravity` / `xai` 认证
2. `POST /v0/management/api-call` 代理上游配额接口：
   - Anti Gravity → `retrieveUserQuotaSummary`
   - Grok → `cli-chat-proxy.grok.com/v1/billing?format=credits`

### 安装

1. 用 Scriptable 导入 `CPA-Quota.js`（或复制内容新建脚本）
2. 在 App 内运行一次，填写 Base URL 与 API Key
3. 长按桌面 → 添加 Scriptable 小组件 → 选择本脚本  
   推荐尺寸：**Medium** / **Large**

### 配置

| 方式 | 说明 |
|---|---|
| Keychain | App 内运行脚本写入（推荐） |
| 小组件参数 JSON | `{"baseUrl":"https://host:port","apiKey":"xxx"}` |
| 小组件参数简写 | `https://host:port\|apiKey` 或仅 `apiKey` |

默认 Base URL 可按自己的 CPA 地址修改；**不要把真实 API Key 提交进仓库**。

### 刷新

- 缓存约 5 分钟
- 小组件建议刷新间隔 15 分钟（系统实际刷新不可保证）

### 圆环含义

圆环与进度条均表示 **已用百分比**：

- Anti Gravity：主环默认看 Claude/GPT 组；条为 Gemini / Claude·GPT
- Grok：主环为周 credits；条为 Build / Imagine / Chat
