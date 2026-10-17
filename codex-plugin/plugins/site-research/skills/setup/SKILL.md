---
name: setup
description: 打开或诊断 Site Research 的专用 Chrome 登录窗口。首次接入 Linux.do、登录失效或需要重新验证时使用；不需要浏览器扩展或配对码。
---

本插件使用独立的持久化 Chrome 配置，不读取用户日常浏览器配置、不导出 Cookie、不索取密码。

1. 调用 `research_status` 查看专用窗口状态；它只检查本机服务，不读账号、不开浏览器。首次接入调用 `research_open_browser` 打开窗口。
2. 让用户**在这个专用窗口里自行登录 Linux.do / 完成站点验证**。不要求扩展、配对码、Cookie、Chrome 调试端口或把密码交给代理。
3. 用户确认登录完成后，调用 `research_account` 检查用户名，再读取用户指定帖子。`browser_open=true` 只代表窗口打开，不代表已登录或网站验证已通过。
4. 运行时缺失时，在本技能所属插件根目录执行 `npm run install-runtime`（一次性安装锁定的 Playwright Core 包，不下载浏览器）。要求 Node.js >=22、npm 和 Google Chrome。不要静默下载/安装 Chrome，不要接管日常 Chrome 配置。
5. 用 `research_close_browser` 或用户手动关闭专用窗口结束；会话仍保存在专用配置。下次会重新打开并复用登录。需要停止本机服务时在插件目录运行 `npm run stop`。

网站要求重新登录或验证时仍需用户本人完成，不能声称“永久登录”或绕过账号权限。只测试过模拟响应时要明确说明，不能称为目标帖子已读成功。

从 0.1.x 升级无需安装扩展：旧扩展可由用户自行禁用/移除，不删除浏览器网站数据。旧 47831 扩展桥接与新版 47832 服务相互独立，不为清理而终止未知进程；迁移详情见插件 README。
