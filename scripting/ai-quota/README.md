# AI Quota (iOS Scripting)

面向 iOS [Scripting](https://scripting.fun) 的原生 TypeScript / TSX 小组件工程，实时监控 **SuperGrok**、**ChatGPT Plus / Pro** 和 **Google AI Pro (Gemini)** 的剩余配额与重置时间。

## 核心特性

- **系统级走字相对时间**：顶部右上角集成 `<DateLabel date={...} style="relative" />`，无需后台脚本运行即可由 iOS 系统自动实时走字（如 "3分钟前"）。
- **新鲜度指示灯**：在线最新数据标 🟢，网络异常回退本地缓存时标 🟡，状态一目了然。
- **桌面原地一键刷新**：通过 `AppIntentManager` 注册 `ReloadQuotaIntent`，小组件顶部集成静默刷新按钮，点击即在后台静默拉取并刷新小组件，无需跳进 App。
- **分列直达官方 App**：三列卡片各自包裹 `<Link url="...">`，点击 Grok 跳转 `grok://`，点击 ChatGPT 跳转 `com.openai.chat://`，点击 Gemini 跳转 `googlegemini://`。
- **锁屏小组件全支持**：提供 `accessoryRectangular`（矩形三列指示）与 `accessoryInline`（单行紧凑文本），平衡展示 3 个服务，无需繁琐筛选。
- **原生 SwiftUI 胶囊进度条与 iOS 18 染色**：采用原生平滑胶囊条，适配 iOS 18 accented 强调色与深浅色模式自适应。
- **多账号自动合并**：支持 CPA 配置多份账号认证，主数字呈现算术平均剩余配额，大号小组件提供各子账号详细明细列表。

## 目录结构

```text
scripting/ai-quota/
├── types.ts          # 核心 TypeScript 接口定义 (Config, ServiceQuota, QuotaData 等)
├── theme.ts          # 主题与配色 (UI 动态颜色、accentFor、状态色)
├── api.ts            # CPA 交互、数据解析、缓存与均值计算核心业务逻辑
├── app_intents.tsx   # 注册 ReloadQuotaIntent 意图 (原地刷新)
├── widget.tsx        # 小组件 UI 呈现 (支持 small/medium/large/accessory)
├── index.tsx         # 前台交互界面 (配置保存、连接测试、组件预览)
└── README.md         # 项目文档
```

## 数据源与算法说明

| 服务 | 数据来源 | 主数字 | 辅助指标 |
|---|---|---|---|
| **SuperGrok** | 读取 CPA 中启用的 xAI 认证，请求 `billing?format=credits` | 周额度剩余百分比 | 账单周期重置倒计时 |
| **ChatGPT Plus/Pro** | 读取 CPA 中启用的 OpenAI/Codex 认证，请求 `backend-api/wham/usage` | 主窗口剩余百分比（通常 7 天） | 5小时短窗口剩余及重置提示 |
| **Google AI Pro** | 读取 CPA 中启用的 Anti Gravity / Gemini 认证，请求 `retrieveUserQuotaSummary` | 周/模型额度桶剩余 | 5小时短窗口额度 |

## 安装与配置

### 1. 导入项目
在 Scripting App 内新建或导入 `ai-quota` 目录项目。

### 2. 配置 CPA 凭据（任选一种）
- **方式一：App 内交互配置（推荐）**
  在 Scripting App 内打开并运行 `index.tsx`：
  - 输入 CPA 管理端地址（如 `https://cpa.example:50442` 或 `http://192.168.1.10:50442`）
  - 输入 CPA 管理端 API Key
  - 点击“保存配置”，凭据将安全存入 iOS 系统 Keychain 及本地 Storage
  - 点击“测试连接并拉取配额”验证网络与数据
  - 点击“预览小组件”查看各尺寸渲染效果
- **方式二：小组件参数 JSON（降级备选）**
  长按桌面小组件 → 编辑小组件 → 在参数中填入：
  ```json
  {"cpaBaseUrl":"https://cpa.example:50442","cpaApiKey":"YOUR_API_KEY"}
  ```

### 3. 添加桌面或锁屏小组件
- 桌面：长按主屏幕空白处 → 点击左上角 `+` → 选择 **Scripting** → 找到 **AI Quota** → 选择 **中尺寸 (systemMedium)**、**小尺寸 (systemSmall)** 或 **大尺寸 (systemLarge)**。
- 锁屏：自定义锁屏 → 添加小组件 → 选择 **Scripting** → 添加矩形或单行小组件。

## 安全与隐私约束

- **严禁提交真实密钥**：不要将真实的 Token、Cookie 或 CPA 管理 Key 提交进 Git 仓库。
- **地址白名单与校验**：CPA 地址经 `normalizeCpaBaseUrl` 严格校验，仅允许纯主机与端口地址，拒绝 userinfo、路径、查询与片段，防止密钥被意外转发。
- **Keychain 沙盒隔离**：凭据默认采用 iOS Keychain 安全存储，脚本卸载后系统自动回收。
