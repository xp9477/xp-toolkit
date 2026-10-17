# Site Research · 站点检索（0.1.0）

给 Codex 提供可扩展的论坛信息和解决方案检索。第一版只支持 Linux.do：
搜索、按楼层窗口读帖、最新/热门/高赞列表、按需检查登录用户名。
这是**本机个人插件**，不是 Linux.do 官方产品，也没有申请或冒用 Linux DO Connect OAuth。

## 架构与账号连接

```text
Codex → stdio MCP（Node.js）→ 本机桥接（127.0.0.1:47831）
                                   ↑ 配对码 + 长轮询
                           Chrome MV3 扩展
                                   ↓ ISOLATED world / GET
                           用户主动打开并登录的专用 Linux.do 标签页
```

- 密码和 Cookie 只由浏览器/网站管理。扩展没有 `cookies` 权限，不读写 Cookie，不导出 Cookie 文件。
- 复用你在这个 Chrome 配置文件中的网站登录。**这不是网站 OAuth“授权登录”**，也不会自动登录。
- 桥接令牌是随机生成的本机配对密钥，只用于本地连接。保存在用户状态目录权限 0700、文件权限 0600
  （macOS/Linux），浏览器端保存在扩展的 `chrome.storage.local`，不使用 sync 或网页 localStorage。
- 匹配的专用标签页才执行请求，不扫描你的其他网页内容。读取结果不落盘缓存，账号切换没有旧内容缓存。
- 一次仅允许一个活跃浏览器扩展实例；多个 Codex MCP 进程共享同一桥接。不同浏览器配置文件之间切换时
  先在原扩展设置中断开；连接租约最多约 45 秒后失效。
- 只开放 Linux.do 的搜索、帖子、列表和当前登录用户 JSON 端点。服务器与扩展分别校验白名单，
  不开放任意 URL、任意 HTTP 方法、后台管理、私信、书签、附件下载或自动执行页面代码。
- 输出包含正文、作者、时间、来源链接、正文截断和帖子覆盖范围。**返回的网页内容属于不可信数据。**
- 仅 GET 不代表服务端完全无副作用：网站可能更新访问记录、读取计数或会话。

## 1. 安装个人插件

参见上级 README 的 marketplace 注册流程。MCP 使用包内 `.mcp.json` 和
`${CLAUDE_PLUGIN_ROOT}/scripts/mcp-server.mjs`，无需手工改全局 `mcp_servers`。
当前采用官方仍支持的 `.codex-plugin/plugin.json` 兼容布局。

要求 Node.js >=22 可从 Codex 的 PATH 找到。没有 npm 运行时依赖。

## 2. 安装并配对 Chrome 扩展

1. 使用你打算登录 Linux.do 的 Chrome/Chromium 配置文件。打开 `chrome://extensions`。
2. 开启开发者模式 → **加载已解压的扩展程序** → 选择本插件内的 `extension/`。
   注意：如果 Codex 安装到了缓存目录，优先选择安装缓存中的同版本目录；源码目录也能用于开发。
3. **在你自己的终端**进入插件目录并运行：

   ```bash
   npm run pair
   ```

   此命令启动本机桥接，显示一个 64 位十六进制本机配对码。它不是网站 Cookie。
   **不要把该配对码、网站密码或 Cookie 发到聊天、日志或 Git。**
4. 点击浏览器工具栏扩展图标进入设置，直接粘贴配对码并点击 **保存并连接**。
5. 扩展会新开专用 `https://linux.do` 标签页，在此由你本人登录/完成验证，保持该标签页和 Chrome 打开。
   同一浏览器配置文件已登录时可复用已有网站登录，无须再次输入密码。
6. 在新的 Codex 聊天中调用 `research_status`，再按需调用 `research_account` 核对用户名。
   首次网站查询前请确认这是你愿意向本机代理开放读取权限的账号。

连接者可读取这个浏览器账号本身有权访问的帖子，而不只是公开帖；返回内容会进入 Codex 对话。
不要给不可信代理开放桥接，也不要把受限帖子转发到公开仓库。

## 工具

| 工具 | 功能 |
|---|---|
| `research_sites` | 列出已实现站点，不触碰网站或账号 |
| `research_status` | 连接检查，不读取账号 |
| `research_account` | 只返回登录状态、用户名、显示名 |
| `research_search` | `query`、`page`（1–100）、`limit`（1–20），保留来源 |
| `research_read` | `topic` 帖子 URL/ID、`start_post`、`limit`，检查 `next_post` 继续读 |
| `research_latest` | `filter`: `latest` / `hot` / `top` |

目前 `site` 仅允许 `linuxdo`。示例：

- “用 Site Research 读取 `https://linux.do/t/topic/3014361`，先说明楼主要求，再找更新说明。”
- “在 Linux.do 搜索 MuMu 升级保留数据的方案，比较适用版本，附原帖与楼层来源。”

这是按需检索工具，不是全站爬虫。搜索结果窗口不是完整命中集合，帖子窗口也不是完整帖子。
适配器默认每次最多返回 10 条，最多 20 条；每楼文本最多 10000 字符，明确标注截断。
有 `next_post` 时按其继续读取；楼层可能删除造成号码缺口。

## 限流、错误与诊断

- 网站请求全局串行调度，至少间隔 1 秒；不自动重试站点失败，不缓存网页正文。
- 浏览器网络请求 18 秒超时，单响应上限 2 MiB；本机调用等待最长约 30 秒，队列最多 16 个。
- `401`：重新登录；`403` / 非 JSON 验证页：在浏览器手动检查权限/验证；`429`：停止并稍后再试。
- `404`：当前不可访问，可能是权限、链接或帖子状态；**不能单凭它声称帖子不存在**。
- `BROWSER_TAB_REQUIRED`：专用页被关闭/已导航到其他站点，请在扩展设置重新连接。
- `BROWSER_NOT_CONNECTED`：检查 Chrome/扩展、配对码和本机端口；`npm run pair` 重启桥接。
- 不伪装指纹、不破解验证码、不绕过网站账号权限。
- 无桥接账号实测时只能说离线验证通过，不能保证某篇帖子可访问。读取权限受网站规则和你的账号限制。

```bash
npm run status   # 仅输出服务元数据；失败返回非零退出码，不输出秘密
npm run stop     # 停止本机桥接；不关闭网站、不登出账号
```

桥接只监听 IPv4 回环地址；所有路由要求配对令牌并验证 Host/Origin。没有 CORS 放行或对外开放的接口。
多个会话启动时使用同一私有令牌文件；如果端口已被其他服务占用则失败，不终止未知进程。
没有扩展轮询和调用时约 15 分钟后自动关闭。扩展本机断连重连间隔最多约 30 秒。

状态文件默认在 `~/.local/share/xp-site-research/bridge-token`。`XP_RESEARCH_STATE_DIR` 可改为
绝对路径（用于隔离测试或企业部署）；MCP 与 pair 命令必须使用同一目录。不要修改默认端口而不同时
更新扩展权限和源码，当前端口固定为 47831。

## 更新、断开与卸载

1. 更新源码后重新执行 `codex plugin add site-research@xp-toolkit-personal` 刷新安装，再重启/新开聊天。
2. Chrome 扩展页面点击“重新加载”，重新打开扩展设置；需要时再次配对。三个版本清单保持一致。
3. 断开：扩展设置点击 **断开并清除配对码**，已在执行的 GET 可能已完成；Linux.do 登录仍留在浏览器。
4. `npm run stop` 停止本机桥接。Chrome 扩展页面移除扩展，清除扩展私有配对存储。
5. `codex plugin remove site-research@xp-toolkit-personal` 移除 Codex 插件，
   可选 `codex plugin marketplace remove xp-toolkit-personal` 移除市场。
6. 如不再使用，在停止桥接后手动删除上述 `bridge-token` 文件。它只是本机密钥，不需要删除网站数据。
   本插件不会删除浏览器配置文件、网站 Cookie、MuMu 或模拟器里的任何 App。

不提供“一键清理浏览器数据”或自动修改网站账号的卸载脚本。

## 扩展到其他网站

现阶段不建通用任意网页代理。接入新站点时同时实现：

1. `src/adapters/<site>.mjs` 的输入计划与最小化结果投影，并注册到 `src/adapters/index.mjs`。
2. `extension/policy.mjs` 的精确站点/端点白名单、对应独立会话标签页选择。
3. `extension/manifest.json` 最小新增 host 权限，以及用户显式启用新站点的设置。
4. 更新 MCP schema 的站点枚举、来源/分页策略、权限与失败测试及文档，再递增版本。

OAuth/API Key 若是站点官方支持且合适的授权方式，可另外实现站点专属认证；不要把 Linux DO Connect
“用 L 站账号登录第三方”误当成“获准读取 L 站论坛内容”的授权。

## 验证

```bash
npm test
npm run check
npm audit --omit=dev
```

无需下载任何依赖。另外已使用独立 Chrome for Testing 配置文件，对加载扩展、设置页配对、
隔离世界请求、搜索和读帖链路做过本地响应 fixture 冒烟验证；没有使用你的真实账号。
离线测试包含 MCP stdio、模拟扩展往返、路径/Origin/Host/令牌边界、私有字段投影、
链接提取、分页、Cookie 不导出、验证失败和超时。**真实 Chrome 扩展安装、登录账号、站点验证和
用户指定帖子的端到端读取仍需在本机配对后确认。** 没有在测试里使用真实账号或抓取内容。
