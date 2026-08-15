# 2026-08-15 安全与架构审计

## 结论

本轮将仓库从“多个可用脚本的集合”推进到了“具备统一安全默认值和自动门禁的 monorepo”。已修复会导致
规则静默损坏、凭据外泄、未授权命令执行、误删下载文件和跨账号缓存污染的高风险问题；同时建立了 Python
与 JavaScript 回归测试、依赖审计和确定性规则生成链路。

审计不是“零风险”证明。浏览器任意页面上的 secrets 输入、mitmproxy 上游依赖、超大 PDF 内存占用、浏览器
端到端覆盖和仓库许可证仍需后续决策或工程投入。残余风险在下文明确列出。

## 范围与方法

审计范围包括：

- 青龙配置、通知、Webhook、外部服务客户端和 qBittorrent 删除任务。
- Loon、Clash、Quantumult X 规则源、生成器、插件分发链接和 CI 自动同步。
- Scriptable AI 配额组件的凭据、缓存和并发请求。
- Userscripts 的 DOM、页面存储、跨域凭据和全局 API 修改。
- Loon plugin maker 的输入校验、抓包输出、文件权限和可选依赖。
- GitHub Actions、Dependabot、Python 依赖与测试发现。

采用的判断顺序是：资产与副作用 → 信任边界 → 失败语义 → 默认行为 → 可验证不变量。除静态审阅外，
高风险路径均尽量增加可执行测试；网络依赖通过 mock 或离线校验隔离。

## 已关闭的主要风险

| 等级 | 原问题 | 处理结果 | 关联提交 |
|---|---|---|---|
| 严重 | qBittorrent API/解析失败可被当成空列表，删除行为默认过宽 | 默认 dry-run、默认保留文件、失败即中止、tracker 精确匹配、文件删除三重授权 | `4f831ce` |
| 严重 | Webhook 可执行路径越界、并发触发任务、弱公网令牌 | 限定脚本根目录、精确 Bearer、任务互斥、冷却与公网长令牌要求 | `91fe6f7` |
| 高 | 规则三端来源不明确，CI 自动写回存在覆盖和竞争 | Loon 成为 canonical source，PR 重生成检查，main 从最新源全量生成并有界重试 | `43a3bdc`, `7a25676` |
| 高 | Direct/Proxy 规则可语义覆盖但校验仍通过 | 加入 exact/suffix 交集检测与单测 | `db2d9fa` |
| 高 | 已发布 Loon 插件指向退役仓库，线上加载内容与本仓库不一致 | 全部链接切换到 xp-toolkit 并加入分发完整性测试 | `98df691` |
| 高 | Scriptable 管理 Key 可发往 HTTP/异常 URL，缓存跨凭据复用 | HTTPS/loopback 约束、端点规范化、非明文缓存作用域、并行隔离请求 | `c5297b0`, `679274d` |
| 高 | Bark/Supabase/TP-Link 凭据传输和 TLS 默认值宽松 | POST-only 默认、严格服务 origin、TLS 默认验证、自签名 CA 显式配置 | `9879074` |
| 高 | 抓包工具默认保存响应明文，脱敏不完整，并可改变既有目录权限 | metadata-only 默认、结构全量脱敏、unsafe 显式、仅保护新目录 | `b7e8a70`, `00f8f74` |
| 高 | 生成的 Loon regex 可错误匹配 apex/userinfo，输入编码和字段扫描不稳 | 合法 hostname regex、编码识别、共享 VIP 字段模式、确定性生成 | `60dd8bb`, `00f8f74` |
| 高 | 验证码脚本把已保存 secrets 回填到任意页面 DOM，远端可换 URL 保留本地 Key | secrets 不预填、URL/Key 原子迁移、HTTPS 校验、导出默认移除 Key | `1671be3` |
| 高 | 4KHD 会话在 GM 存储失败时降级到页面 `localStorage` | 安全存储失败即拒绝降级，并加入静态回归测试 | `1671be3` |
| 中 | Synapse 修改全局 `JSON.parse`，并复制未充分清理的页面标记 | 仅拦截已知 fetch 端点，标签/属性白名单清理 | `1671be3` |
| 中 | A 股脚本直接把远端页面 HTML 复制到新面板 | 改为文本和白名单表格节点重建 | `1671be3` |
| 中 | 无统一质量门禁、格式和依赖检查 | 固定直接依赖，Ruff、单测、JS 语法/测试、pip-audit、Dependabot | `2d77bf7`, `02a7bd6` |

## 验证证据

在隔离 Python 3.12 环境与本机 Node.js 上完成：

- 62 个 Python 单元测试通过。
- 17 个 JavaScript 单元测试通过。
- 34 个 Python 文件通过 Ruff lint 与格式检查。
- 所有 Scriptable、userscript 和 Loon JavaScript 文件通过语法检查。
- 代理规则离线一致性、重复和冲突校验通过。
- `loon-plugin-maker` 通过 Skill 结构校验。
- `qinglong/requirements.txt` 经 pip-audit 检查无已知漏洞。
- 每一批代码或配置修改均单独提交并推送到 `main`。

这些结果证明当前测试覆盖的不变量成立，不代表未覆盖的真实网站、第三方 API 或浏览器版本都已完成兼容测试。

## 残余风险与优先级

### P1：需要近期处理

1. **任意页面上的 secrets 输入仍可被恶意页面观察。** 验证码脚本已不再回填已有 Key/密码，但用户新输入的
   键盘事件发生在页面上下文。短期应只在可信页面配置；长期应迁移到扩展自有 options 页面或独立本地配置页。
2. **验证码脚本权限面仍大。** 功能目标要求广泛 `@match` 和动态后端导致 `@connect *`。长期应由生成器按用户
   站点/后端生成窄权限版本，或改为浏览器扩展的运行时权限申请。
3. **曲谱 PDF 对图片数量和尺寸没有总预算。** 极端页面可能造成浏览器内存耗尽。应限制单图字节、总像素、
   总页数和最终估算内存，并允许分批导出。
4. **青龙外部账号客户端覆盖仍不均衡。** 高风险公共组件已有测试，但部分站点任务仍依赖第三方真实响应结构。
   应为每个客户端补齐超时、HTTP 失败、无效 JSON 和业务失败 fixture。

### P2：纳入下一阶段治理

1. **mitmproxy 的当前稳定依赖图存在上游漏洞阻塞。** Skill 已解除测试时的硬导入，并要求在独立、最新且经过
   审计的环境运行；仓库不应为了“固定版本”而锁定一个已知有漏洞的依赖组合。持续跟踪上游并在可用版本发布后
   增加独立 requirements/lock。
2. **只固定了直接 Python 依赖。** 尚无带 hashes 的传递依赖锁；构建仍受 PyPI 当时解析结果影响。建议用
   `pip-tools` 或 `uv lock` 生成按 Python 版本维护的锁，并保留 Dependabot 更新入口。
3. **浏览器测试主要是核心函数和静态安全不变量。** 尚无 Playwright/Tampermonkey 真实页面夹具，DOM 生命周期、
   跨域和 UI 交互回归仍可能漏检。先覆盖验证码、4KHD 和 PDF 三个高权限脚本。
4. **CI 仍是单个综合 job。** 项目扩大后会拖慢反馈。新增 npm/Raycast 等生态时，拆成 Python、browser、proxy、
   supply-chain 独立 job，并用一个 aggregate required check 汇总。
5. **规则拓扑仍在 Python 和 workflow paths 中重复。** 当前两组规则可控；增加第三组前应引入 manifest 统一驱动
   路径、策略、生成和校验。
6. **Webhook 只提供应用层 Bearer，不负责公网 TLS。** 默认保持 loopback；若公开访问，必须放在有 HTTPS、访问
   控制、速率限制和审计日志的反向代理之后。

### 需要维护者决策

1. **根许可证与来源声明缺失。** 仓库由多个旧仓库合并，不能替维护者猜测许可。应确认各来源权利后选择根
   `LICENSE`，必要时添加 `NOTICE` 和文件级来源说明。
2. **Secrets 管理目标。** 若项目继续加入需要长期密钥的浏览器功能，应决定采用 userscript 便携性，还是采用
   扩展自有 UI 和权限隔离；两者无法同时最大化。
3. **兼容性政策。** 建议明确支持的 Python、Node、iOS/Scriptable 和 userscript manager 最低版本，再将版本矩阵
   写入 CI，避免隐式依赖开发机环境。

## 推荐演进顺序

1. 为剩余青龙客户端建立统一 HTTP adapter 或轻量协议测试，关闭假成功和无限等待。
2. 给 PDF 导出增加资源预算，并引入首个真实浏览器夹具。
3. 决定许可证和 provenance，随后建立依赖 license/SBOM 门禁。
4. 在出现第三个规则集或第二个生成器时引入 manifest，不提前构建万能插件系统。
5. 当 browser/Raycast 形成独立依赖图时拆分 CI job 和各自 lockfile。

## 审计边界

本轮没有使用真实生产 cookie、删除真实 torrent、向外部服务发送通知或执行真实浏览器登录。在线检查仅用于
公开分发链接和官方依赖信息；破坏性路径均通过 mock、dry-run 和静态分析验证。
