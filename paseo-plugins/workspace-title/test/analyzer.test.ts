import test from "node:test";
import assert from "node:assert/strict";
import { classifyHeuristic, analyzeWorkspaceTask } from "../server/analyzer";

test("classifyHeuristic accurately recognizes all 8 allowed types", () => {
  const cases: Array<{ input: string; expectedType: string; project?: string }> = [
    { input: "实现工作区自动命名插件", expectedType: "功能" },
    { input: "新增用户权限管理模块", expectedType: "功能" },
    { input: "接入第三方支付 SDK", expectedType: "功能" },
    { input: "Figma 移动端界面原型设计", expectedType: "设计" },
    { input: "优化资产卡片排版与视觉配色调优", expectedType: "优化" },
    { input: "修复 AI-Quota 多账号平均与 Grok 跳转报错", expectedType: "修复" },
    { input: "解决登录态失效导致崩溃的 Bug", expectedType: "修复" },
    { input: "发布 v1.0.0 正式版本并部署到生产环境", expectedType: "发布" },
    { input: "排查摘要生成失败原因分析", expectedType: "探索" },
    { input: "调研跨平台框架技术选型", expectedType: "探索" },
    { input: "编写工作区插件接入文档与使用指南", expectedType: "文档" },
    { input: "深入研究 Transformer 注意力机制算法原理", expectedType: "研究" },
  ];

  for (const c of cases) {
    const res = classifyHeuristic(c.input, c.project);
    assert.ok(res, `Expected match for "${c.input}"`);
    assert.equal(res?.type, c.expectedType, `Type mismatch for "${c.input}"`);
  }
});

test("classifyHeuristic strips project names from topic", () => {
  const res = classifyHeuristic("xp-toolkit: 实现工作区自动命名插件", "xp-toolkit");
  assert.ok(res);
  assert.equal(res.type, "功能");
  assert.equal(res.topic, "工作区自动命名插件");
});

test("analyzeWorkspaceTask prioritizes agentTitle and strips project redundancy", async () => {
  const res = await analyzeWorkspaceTask({
    agentTitle: "实现工作区自动命名插件",
    initialPrompt: "这是一段很长很长的用户详细描述，包含很多细节...",
    workspaceName: "talk",
    projectName: "talk",
    enableLlmFallback: false,
  });

  assert.ok(res);
  assert.equal(res.type, "功能");
  assert.equal(res.topic, "工作区自动命名插件");
});

test("analyzeWorkspaceTask returns null if input is completely empty or meaningless", async () => {
  const res = await analyzeWorkspaceTask({
    agentTitle: "",
    initialPrompt: "     ",
    workspaceName: null,
    enableLlmFallback: false,
  });
  assert.equal(res, null);
});
