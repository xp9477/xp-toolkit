# 贡献指南

本仓库包含多个独立运行时。提交的首要目标是保持交付物可独立安装，并让失败可见、秘密不外泄。

## 本地验证

需要 Python 3.12+ 和当前 Node.js LTS。推荐使用隔离环境：

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt -r qinglong/requirements.txt
```

运行与 CI 等价的检查：

```bash
ruff check .
ruff format --check .
python -m compileall -q .github/scripts qinglong skills/loon-plugin-maker/scripts
python -m unittest discover -s tests -p 'test_*.py' -v
python .github/scripts/check_rules.py --offline
node --test tests/js/*.test.mjs
pip-audit -r qinglong/requirements.txt --progress-spinner=off
```

检查全部 JavaScript 语法：

```bash
while IFS= read -r -d '' file; do
  node --input-type=module --check < "$file"
done < <(find scriptable userscripts proxy/loon/script -type f -name '*.js' -print0)
```

## 变更约束

### 所有变更

- 不提交 cookie、token、密码、真实账号配置、抓包正文或 `.env`。
- 网络请求必须设置有限超时并校验 HTTP 与业务响应。
- 失败路径返回非零退出码或明确失败值，不能用空集合掩盖错误。
- 错误日志只包含定位所需字段；不打印整个请求、响应或账号对象。
- 新依赖必须是直接需要的依赖，固定版本并通过漏洞审计。
- 修复缺陷时添加能够在修复前失败的回归测试。

### 青龙脚本

- 从 `template.py` 和 `common.py` 的入口模式开始，不自行实现另一套账号配置协议。
- 用严格布尔解析；不要使用 `bool("false")` 一类隐式真值。
- 公网凭据端点建议 HTTPS；用户明确配置的 HTTP 端点可保持兼容。服务根地址不允许 userinfo、路径、查询或片段。
- `run()` 仅在业务成功已得到证实时返回 `True`。
- 删除、覆盖或批量变更默认 dry-run，并将“执行动作”和“删除关联数据”拆成独立授权。

### 代理规则

只编辑 `proxy/loon/Self-Direct.list` 或 `Self-Proxy.list`，然后运行：

```bash
python .github/scripts/sync_rules.py
python .github/scripts/check_rules.py --offline
```

把生成的 Clash 与 Quantumult X 文件一同提交。不要手工编辑生成物，也不要忽略语义冲突。

### Userscripts

- 每次可执行代码变化都递增头部 `@version` 的补丁版本。
- 保持单文件安装，不导入仓库内未随文件发布的模块。
- 页面 DOM 和站点 API 都是不可信输入；优先 `textContent`，需要标记时使用标签/属性白名单。
- 不把令牌降级存入页面 `localStorage`，不默认复制到剪贴板，不在页面 DOM 回填已保存秘密。
- 避免修改全局浏览器 API。必须拦截时仅处理精确端点并添加回归测试。
- 审查 `@match`、`@connect` 和 `@grant`，只保留功能真正需要的权限。

### Scriptable

- 每次可执行代码变化都递增版本注释或发布标识。
- 凭据使用 Keychain；小组件参数含秘密时在文档中明确风险。
- 缓存按端点和凭据身份隔离，键中不能出现原始秘密。
- 独立数据源并行获取；任何一个失败都不得污染其他数据源缓存。

### Skills

- 修改 Skill 前后运行当前 `skill-creator` 的 `quick_validate.py`。
- `SKILL.md` 的默认行为必须与脚本默认值一致。
- 可选大型依赖在运行时检查，核心模块保持可导入、可单测。
- 抓包或诊断输出默认 metadata-only；提高敏感度必须显式 opt-in。

## 新增顶层组件

新增运行时或产品域时，同一提交应包含：

1. 目录 README：安装、配置、秘密存储、失败语义和卸载方式。
2. 至少一个行为测试，以及 CI 对应的发现命令。
3. 包管理器清单和 Dependabot 配置（如适用）。
4. 分发链接或生成物的完整性测试。
5. 在根 README 和 `docs/architecture.md` 中登记边界。

若这些内容暂时无法提供，把目录保持为占位符，不要提交不可验证的半成品运行时。

## 提交前检查

- `git diff --check` 无空白错误。
- 工作树中没有生成缓存、真实配置或抓包数据。
- userscript 版本已递增。
- 规则生成物已同步。
- 定向测试与全仓测试均通过。
- 文档说明默认值、破坏性动作和迁移影响。
