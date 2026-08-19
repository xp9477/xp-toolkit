# xp-toolkit

个人工具 monorepo：青龙脚本、代理规则、Skills，以及后续的 Raycast 插件。

## 目录

| 路径 | 说明 |
|---|---|
| `qinglong/` | 青龙面板运行脚本（原 `qlScripts`） |
| `proxy/clash/` | Clash 规则 |
| `proxy/loon/` | Loon 规则、插件、脚本 |
| `proxy/quanx/` | Quantumult X 规则 |
| `skills/` | 自建 Codex / Agent Skills |
| `raycast/` | 预留：Raycast 插件 |
| `scriptable/` | iOS Scriptable 组件与脚本（AI 套餐用量） |
| `userscripts/` | 浏览器油猴脚本 |
| `.github/` | 质量门禁、依赖更新与规则跨端同步 CI |

## 维护入口

- [架构与扩展边界](docs/architecture.md)
- [贡献与本地验证](CONTRIBUTING.md)
- [2026-08-15 安全与架构审计](docs/2026-08-15-security-and-architecture-audit.md)

## 代理规则同步

`proxy/loon/Self-Direct.list` 与 `Self-Proxy.list` 是唯一人工维护的数据源；
Clash 和 QuanX 文件由脚本生成：

- Loon: `proxy/loon/*.list`
- Clash: `proxy/clash/*.yaml`
- QuanX: `proxy/quanx/*.list`

修改 Loon 源后，在提交前运行：

```bash
python3 .github/scripts/sync_rules.py
```

同步后校验（冲突检测 + 三端一致性）：

```bash
python3 .github/scripts/check_rules.py --offline
```

PR 会拒绝未提交或被手工修改的生成文件。直接推送到 `main` 时，GitHub Actions
也会从最新 Loon 源重新生成，避免多端同时编辑造成静默覆盖。

## 规则分发

本仓库为公开仓库，OpenClash 可直接订阅 raw 链接（无需 token）：

```
https://raw.githubusercontent.com/xp9477/xp-toolkit/main/proxy/clash/Self-Direct.yaml
https://raw.githubusercontent.com/xp9477/xp-toolkit/main/proxy/clash/Self-Proxy.yaml
```

校验线上链接可用性：

```bash
python3 .github/scripts/check_rules.py
```

## 来源

合并自：

- `qlScripts`
- `Rules`
- `Skills`

## 注意

- 不要提交 cookie、token、`.env` 等敏感信息
- 抓包产物 `mitm_responses/` 默认忽略，不入库
- 公网凭据端点建议使用 HTTPS；用户明确配置的 HTTP 端点保持兼容
- 删除类任务默认 dry-run，并把数据删除和文件删除分开授权
