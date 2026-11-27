# AI Quota · Scriptable

[AI-Quota.js](./AI-Quota.js) 是可直接安装的单文件版本，无需导入 `.scripting` 压缩包。仍使用同一个 CPA 管理端，展示 ChatGPT 和 Gemini 的剩余额度、数据源提供的 5 小时窗口和重置时间。原 [Scripting 版](../scripting/ai-quota/) 保留。

## 安装

1. 将 Scriptable 更新至 **1.8.4 或更新版本**。在 App 中新建名为 **AI-Quota** 的脚本，粘贴 `AI-Quota.js` 全部内容并保存。
2. 在编辑器点运行，输入原来的 **CPA 管理地址**和 **管理 API Key**。管理地址只填协议、主机和端口，例如 `https://cpa.example:50442`；不要加管理路径。保存后再运行一次，选「测试连接并刷新」，或先预览中号卡片。
3. 在主屏幕添加 **Scriptable** 小组件，编辑组件并将 **Script** 选为 **AI-Quota**，常规 **Parameter** 留空。建议先用中号。日常点卡片中的 `↻` 或内容区域原地刷新；如果要改 CPA 配置，在 App 内运行脚本。若点击脚本只打开编辑器，在编辑器点运行即可。
4. 锁屏可选矩形、单行或圆形，仅展示。圆形默认显示剩余百分比最低的服务；只想盯一家，可将 **Parameter** 设为 `chatgpt` 或 `gemini`。锁屏上的 `*` 表示该服务仍在显示上一次成功的数据。

## 尺寸和刷新

- **小号**：按行显示两家主额度和紧凑的时间信息。**中号**：双列显示主额度进度条、重置和可用的 5 小时窗口。**大号／超大号**：额外显示各服务的账号明细；超大号取决于系统与机型。
- 手动刷新动作绕过 10 分钟的请求缓存，保存结果后由 Scriptable 重绘；不依赖打开 App。旧宿主没有整块点击能力时，回退为按钮；两种交互 API 都没有时，点击打开 App，手动选择「测试连接并刷新」。没有移植原 Scripting 的自定义「正在刷新」过渡画面。
- 自动刷新最早安排在渲染后 15 分钟；iOS 决定实际时间。单服务失败时，仅该服务显示上次成功数据并标记「缓存」；没有缓存就显示 `—`，不显示为 0%。部分账号失败时，平均值只包含本次成功的账号，并标记「部分」。下次可手动重试。
- Scriptable 的相对时间会自行更新，但时间走字不等于重新拉取了额度。

## 凭据、缓存与卸载

Scripting 的配置不会跟着迁移。CPA Key 和地址只通过 App 对话框写入 Scriptable Keychain，不接受旧版带密钥的 JSON 小组件参数，也不要把密钥放进脚本、快捷指令或提交。公网地址请使用 HTTPS；脚本拒绝跟随管理端重定向，不降低证书校验。百分比和大号明细中的账号标签缓存在 Scriptable 本机目录，不写入脚本或 iCloud；不要把大号卡片截图公开发出，除非这些标签可以公开。

卸载前在 App 内运行脚本，选择「清除配置和缓存」，再移除小组件及脚本。确认 Scriptable 版工作后，原 Scripting 小组件可独立移除。

## 维护

`AI-Quota.js` 是生成物。宿主代码在 `src/host.mjs`，CPA 请求体和两家数据源的解析／聚合来自 `scripting/ai-quota/api.ts`。改代码后先递增 `src/header.txt` 的发布标识，再从仓库根运行（Node.js 24）：

```bash
node scriptable/build-ai-quota.mjs
node scriptable/build-ai-quota.mjs --check
node --test tests/js/ai_quota.test.mjs tests/js/scriptable_ai_quota.test.mjs
```
