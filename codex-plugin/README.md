# Codex 个人插件

这里是 xp-toolkit 的个人插件市场和独立交付物，不是公共插件商店。当前唯一插件是
[`site-research`](plugins/site-research/README.md)：本机账号桥接、论坛信息和解决方案检索。
目前仅接入 **Linux.do**，其他站点还没有实现。

## 在 Codex 中安装

从仓库根目录运行（要求支持插件命令的 Codex 桌面版 / CLI）：

```bash
codex plugin marketplace add ./codex-plugin
codex plugin add site-research@xp-toolkit-personal
```

如当前客户端不提供 `plugin add`，注册市场后重启桌面应用，在插件目录里选择
**XP Toolkit · 个人插件**，安装 **Site Research · 站点检索**。重启/新开聊天后才会加载新 MCP，
当前对话不保证能热加载。这里只注册本机市场，没有向公共市场提交或发布。

插件独立依赖 Node.js >=22（无第三方运行时依赖，不需要 `npm install`）。
下一步按插件 README 在 Chrome 加载 `extension/` 并手动配对、登录。**安装插件不等于已连接账号。**

## 验证与维护

```bash
npm --prefix codex-plugin/plugins/site-research test
npm --prefix codex-plugin/plugins/site-research run check
npm --prefix codex-plugin/plugins/site-research audit --omit=dev
```

当前测试覆盖离线协议、模拟浏览器链路、权限边界和分段投影；不使用真实 Cookie，也不假装已完成
Linux.do 账号或 Cloudflare 实测。版本来自插件/package/扩展三个清单，完整性检查要求一致。
CI 自动运行这些离线测试和包内语法/目录/权限校验；`package-lock.json` 固定分发依赖图（当前为空）。

新增插件放在 `plugins/<name>/` 并更新 `.agents/plugins/marketplace.json`。
插件是独立运行时，不隐式依赖 `qinglong/`、`skills/` 等顶层组件。
