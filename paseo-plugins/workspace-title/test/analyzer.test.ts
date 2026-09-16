import test from "node:test";
import assert from "node:assert/strict";
import {
  extractFirstTurnContext,
  buildClassificationPrompt,
  parseLlmClassificationJson,
  analyzeWorkspaceTask,
  getResolvedModelConfig,
} from "../server/analyzer";

test("extractFirstTurnContext extracts user instruction and assistant reply", () => {
  const timeline = [
    { type: "user_message", text: "实现工作区自动命名插件" },
    { type: "assistant_message", text: "好的，我已经分析了需求，正在编写代码。" },
  ];

  const ctx = extractFirstTurnContext(timeline);
  assert.ok(ctx);
  assert.equal(ctx.userInstruction, "实现工作区自动命名插件");
  assert.equal(ctx.assistantReply, "好的，我已经分析了需求，正在编写代码。");
  assert.match(ctx.fullContextText, /【用户指令】\n实现工作区自动命名插件/);
  assert.match(ctx.fullContextText, /【助手回复\/执行结果】\n好的，我已经分析了需求/);
});

test("extractFirstTurnContext extracts tool call summaries when assistant executes tools", () => {
  const timeline = [
    {
      item: {
        type: "user_message",
        text: "请优化卡片排版并检查样式",
      },
    },
    {
      item: {
        type: "tool_call",
        name: "shell",
        detail: { command: "git status" },
      },
    },
    {
      item: {
        type: "tool_call",
        name: "read_file",
        detail: { input: "src/card.tsx" },
      },
    },
    {
      item: {
        type: "assistant_message",
        text: "已完成排版优化与样式检查。",
      },
    },
  ];

  const ctx = extractFirstTurnContext(timeline);
  assert.ok(ctx);
  assert.equal(ctx.userInstruction, "请优化卡片排版并检查样式");
  assert.equal(ctx.assistantReply, "已完成排版优化与样式检查。");
  assert.ok(ctx.toolSummaries && ctx.toolSummaries.length === 2);
  assert.equal(ctx.toolSummaries[0], "shell: git status");
  assert.equal(ctx.toolSummaries[1], "read_file: src/card.tsx");
  assert.match(ctx.fullContextText, /【调用工具及结果】/);
});

test("extractFirstTurnContext returns null if timeline is empty or missing user message", () => {
  assert.equal(extractFirstTurnContext(null), null);
  assert.equal(extractFirstTurnContext([]), null);
  assert.equal(
    extractFirstTurnContext([
      { type: "notification", level: "info", message: "session started" },
    ]),
    null
  );
});

test("extractFirstTurnContext returns null if user message exists but no assistant reply or tool calls (turn in progress)", () => {
  const timeline = [
    { type: "user_message", text: "刚发送的任务，助手还没回复" },
  ];
  // Must NOT prematurely extract before assistant replies or tool calls occur
  assert.equal(extractFirstTurnContext(timeline), null);
});

test("extractFirstTurnContext isolates first turn when subsequent turns exist", () => {
  const timeline = [
    { type: "user_message", text: "第一轮任务：重构工作区标题" },
    { type: "assistant_message", text: "第一轮已完成重构。" },
    { type: "user_message", text: "第二轮任务：完全不同的无关任务" },
    { type: "assistant_message", text: "第二轮也完成了。" },
  ];

  const ctx = extractFirstTurnContext(timeline);
  assert.ok(ctx);
  assert.equal(ctx.userInstruction, "第一轮任务：重构工作区标题");
  assert.equal(ctx.assistantReply, "第一轮已完成重构。");
  assert.doesNotMatch(ctx.fullContextText, /第二轮任务/);
});

test("buildClassificationPrompt contains all 8 allowed types, definitions, and project constraints", () => {
  const prompt = buildClassificationPrompt({
    context: {
      userInstruction: "解决数据库连接池泄漏导致的崩溃",
      assistantReply: "排查了连接释放逻辑，修复了泄漏 Bug。",
      fullContextText: "【用户指令】\n解决数据库连接池泄漏导致的崩溃\n\n【助手回复/执行结果】\n排查了连接释放逻辑，修复了泄漏 Bug。",
    },
    projectName: "my-service",
    agentTitle: "修复数据库崩溃",
  });

  const expectedTypes = ["功能", "设计", "修复", "优化", "发布", "探索", "文档", "研究"];
  for (const t of expectedTypes) {
    assert.ok(prompt.includes(t), `Prompt missing type: ${t}`);
  }

  assert.ok(prompt.includes("my-service"));
  assert.ok(prompt.includes("修复数据库崩溃"));
  assert.ok(prompt.includes("解决数据库连接池泄漏导致的崩溃"));
  assert.ok(prompt.includes("排查了连接释放逻辑"));
});

test("parseLlmClassificationJson correctly parses raw JSON, markdown code fence, and removes project names", () => {
  // Case 1: Pure JSON
  const r1 = parseLlmClassificationJson(
    '{"type": "优化", "topic": "xp-toolkit: 工作区标题重构优化"}',
    "xp-toolkit"
  );
  assert.deepEqual(r1, {
    type: "优化",
    topic: "工作区标题重构优化",
  });

  // Case 2: Markdown block
  const r2 = parseLlmClassificationJson(
    "```json\n{\n  \"type\": \"修复\",\n  \"topic\": \"【app】修复连接池泄漏报错\"\n}\n```",
    "app"
  );
  assert.deepEqual(r2, {
    type: "修复",
    topic: "修复连接池泄漏报错",
  });

  // Case 3: Output with Codex CLI log noise
  const r3 = parseLlmClassificationJson(
    "OpenAI Codex v0.147.0\n--------\nuser\n...\ncodex\n{\"type\": \"功能\", \"topic\": \"工作区自动命名插件\"}\ntokens used 100",
    "talk"
  );
  assert.deepEqual(r3, {
    type: "功能",
    topic: "工作区自动命名插件",
  });
});

test("parseLlmClassificationJson rejects invalid types or empty topics", () => {
  assert.equal(
    parseLlmClassificationJson('{"type": "feature", "topic": "新功能"}'),
    null
  );
  assert.equal(
    parseLlmClassificationJson('{"type": "开发", "topic": "新模块"}'),
    null
  );
  assert.equal(
    parseLlmClassificationJson('{"type": "功能", "topic": "   "}'),
    null
  );
  assert.equal(parseLlmClassificationJson("non-json output"), null);
});

test("analyzeWorkspaceTask returns null when first turn context is incomplete", async () => {
  // Empty input
  const res1 = await analyzeWorkspaceTask({
    timeline: [],
    classifyFn: async () => ({ type: "功能", topic: "不会被调用" }),
  });
  assert.equal(res1, null);

  // User prompt exists but no assistant reply yet (turn not completed)
  const res2 = await analyzeWorkspaceTask({
    timeline: [{ type: "user_message", text: "刚发起" }],
    classifyFn: async () => ({ type: "功能", topic: "不会被调用" }),
  });
  assert.equal(res2, null);
});

test("analyzeWorkspaceTask calls classifyFn with generated prompt and returns ClassificationResult", async () => {
  let receivedPrompt = "";
  const mockClassify = async (prompt: string, project?: string | null) => {
    receivedPrompt = prompt;
    return { type: "优化" as const, topic: "重构工作区命名规则" };
  };

  const res = await analyzeWorkspaceTask({
    timeline: [
      { type: "user_message", text: "重构工作区命名规则为LLM全量总结" },
      { type: "assistant_message", text: "正在分析代码并进行重构。" },
    ],
    projectName: "xp-toolkit",
    classifyFn: mockClassify,
  });

  assert.ok(res);
  assert.equal(res.type, "优化");
  assert.equal(res.topic, "重构工作区命名规则");
  assert.ok(receivedPrompt.includes("重构工作区命名规则为LLM全量总结"));
  assert.ok(receivedPrompt.includes("正在分析代码并进行重构。"));
});

test("getResolvedModelConfig strictly resolves gemini-3.5-flash-lite and never falls back to unauthorized models", () => {
  const meta = getResolvedModelConfig();
  assert.equal(meta.model, "gemini-3.5-flash-lite");
  assert.notEqual(meta.model, "gemini-3.8-flash-high");
});
