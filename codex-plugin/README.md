# Codex 个人插件

xp-toolkit 的本机个人插件市场，不是公开插件商店。当前插件：
[Site Research](plugins/site-research/README.md)，首先支持 Linux.do 的信息和解决方案只读检索。
**0.2.0 起不需要浏览器扩展、不需要配对码。** 首次在插件专用 Chrome 窗口登录，后续复用会话。

## 本机安装

在仓库根目录运行：

```bash
codex plugin marketplace add ./codex-plugin
codex plugin add site-research@xp-toolkit-personal
npm --prefix codex-plugin/plugins/site-research run install-runtime
```

要求支持插件命令的 Codex、Node.js >=22、npm 和已安装的 Google Chrome。
运行时安装只下载锁定版本的 `playwright-core`，不下载浏览器、不执行依赖安装脚本。
缓存位于用户私有状态目录，不提交到仓库。注册市场不会向公开目录发布插件。

重启或新开 Codex 聊天，输入“用 Site Research 打开 Linux.do 登录窗口”。自己在打开的专用窗口
登录/验证即可；后续直接给帖子链接或提出检索问题。浏览器窗口打开不等于账号已登录。

也可在自己的终端运行：

```bash
npm --prefix codex-plugin/plugins/site-research run login
```

这只打开专用窗口，不需要复制任何密钥，也不要求 Chrome 调试端口或加载扩展。

## 验证与维护

```bash
npm --prefix codex-plugin/plugins/site-research ci --ignore-scripts
npm --prefix codex-plugin/plugins/site-research test
npm --prefix codex-plugin/plugins/site-research run check
npm --prefix codex-plugin/plugins/site-research run test:browser
npm --prefix codex-plugin/plugins/site-research audit --omit=dev
```

`test` 是离线协议/安全边界测试；`test:browser` 用临时浏览器配置、本地拦截的站点响应，验证真实
浏览器中持久登录会话重启复用和隔离世界读取，不使用真实账号/站点响应。它需要 Chrome。
Linux CI 在明确准备浏览器后运行冒烟测试；`XP_TEST_BROWSER_PATH` 可指定测试浏览器可执行文件。
`run check` 校验分发路径、版本、市场、锁文件和语法，不把 `node_modules` 算入包摘要。

新增插件放 `plugins/<name>/` 并更新 `.agents/plugins/marketplace.json`；插件之间没有隐式运行时依赖。
