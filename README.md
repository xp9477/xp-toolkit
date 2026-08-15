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
| `.github/` | 规则跨端同步 CI |

## 代理规则同步

修改任一端的 `Self-Direct` / `Self-Proxy` 后，GitHub Actions 会同步到其他两端：

- Loon: `proxy/loon/*.list`
- Clash: `proxy/clash/*.yaml`
- QuanX: `proxy/quanx/*.list`

本地也可手动同步（默认以 Loon 为源）：

```bash
python .github/scripts/sync_rules.py
```

或指定变更文件：

```bash
python .github/scripts/sync_rules.py proxy/loon/Self-Direct.list
```

同步后校验（冲突检测 + 三端一致性）：

```bash
python .github/scripts/check_rules.py --offline
```

## 规则分发

本仓库为公开仓库，OpenClash 可直接订阅 raw 链接（无需 token）：

```
https://raw.githubusercontent.com/xp9477/xp-toolkit/main/proxy/clash/Self-Direct.yaml
https://raw.githubusercontent.com/xp9477/xp-toolkit/main/proxy/clash/Self-Proxy.yaml
```

校验线上链接可用性：

```bash
python .github/scripts/check_rules.py
```

## 来源

合并自：

- `qlScripts`
- `Rules`
- `Skills`

## 注意

- 不要提交 cookie、token、`.env` 等敏感信息
- 抓包产物 `mitm_responses/` 默认忽略，不入库
