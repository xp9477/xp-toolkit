import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_TYPES,
  type ClassificationResult,
  type FirstTurnContext,
  type WorkspaceTaskType,
} from "../shared/types";
import { cleanTopic, isValidType } from "../shared/formatter";

/**
 * Extracts the complete first-turn conversation context from an agent's timeline.
 * Returns null if the first turn has not concluded yet or has no substantive content
 * (e.g. no user instruction, or user instruction exists but assistant has not replied or executed tools yet).
 */
export function extractFirstTurnContext(
  timeline: readonly any[] | null | undefined
): FirstTurnContext | null {
  if (!timeline || !Array.isArray(timeline) || timeline.length === 0) {
    return null;
  }

  // Normalize entries: entry may be an AgentTimelineItem or { item: AgentTimelineItem }
  const items = timeline.map((e) => e?.item || e).filter(Boolean);

  // 1. Locate the first user message
  const firstUserIdx = items.findIndex(
    (it: any) =>
      (it.type === "user_message" || it.type === "prompt") &&
      typeof it.text === "string" &&
      it.text.trim().length > 0
  );

  if (firstUserIdx === -1) {
    return null;
  }

  const userInstruction = items[firstUserIdx].text.trim();

  // 2. Find the boundary of the first turn (ends before the next user message, or at end of timeline)
  const nextUserIdx = items.findIndex(
    (it: any, idx: number) =>
      idx > firstUserIdx &&
      (it.type === "user_message" || it.type === "prompt") &&
      typeof it.text === "string" &&
      it.text.trim().length > 0
  );

  const firstTurnItems =
    nextUserIdx === -1
      ? items.slice(firstUserIdx + 1)
      : items.slice(firstUserIdx + 1, nextUserIdx);

  // 3. If there are no items after user message, the first turn has NOT produced any response yet!
  if (firstTurnItems.length === 0) {
    return null;
  }

  const assistantTexts: string[] = [];
  const toolSummaries: string[] = [];
  const reasoningTexts: string[] = [];

  for (const it of firstTurnItems) {
    if (
      it.type === "assistant_message" &&
      typeof it.text === "string" &&
      it.text.trim().length > 0
    ) {
      assistantTexts.push(it.text.trim());
    } else if (it.type === "tool_call") {
      let summary = it.name || "tool";
      const detail = it.detail;
      if (detail && typeof detail === "object") {
        if (detail.command && typeof detail.command === "string") {
          summary += `: ${detail.command}`;
        } else if (detail.type === "shell" && detail.command) {
          summary += `: ${detail.command}`;
        } else if (detail.input && typeof detail.input === "string") {
          summary += `: ${detail.input}`;
        }
      }
      toolSummaries.push(summary);
    } else if (
      it.type === "reasoning" &&
      typeof it.text === "string" &&
      it.text.trim().length > 0
    ) {
      reasoningTexts.push(it.text.trim());
    }
  }

  // Check if there is substantive content from the assistant or tools
  if (
    assistantTexts.length === 0 &&
    toolSummaries.length === 0 &&
    reasoningTexts.length === 0
  ) {
    return null;
  }

  let assistantReply = "";
  if (assistantTexts.length > 0) {
    assistantReply = assistantTexts.join("\n\n");
  } else if (toolSummaries.length > 0) {
    assistantReply = `已执行工具操作：\n${toolSummaries.slice(0, 10).join("\n")}`;
  } else {
    assistantReply = reasoningTexts.join("\n\n");
  }

  const toolSection =
    toolSummaries.length > 0 && assistantTexts.length > 0
      ? `\n\n【调用工具及结果】\n${toolSummaries.slice(0, 10).join("\n")}`
      : "";

  const fullContextText = [
    "【用户指令】",
    userInstruction,
    "",
    "【助手回复/执行结果】",
    assistantReply,
    toolSection,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    userInstruction,
    assistantReply,
    toolSummaries: toolSummaries.length > 0 ? toolSummaries : undefined,
    fullContextText,
  };
}

/**
 * Builds the LLM prompt for task type and topic classification.
 */
export function buildClassificationPrompt(input: {
  context: FirstTurnContext;
  projectName?: string | null;
  workspaceName?: string | null;
  agentTitle?: string | null;
}): string {
  const { context, projectName, agentTitle } = input;
  const projectLabel = projectName || "无";
  const agentTitleLabel = agentTitle ? `【Agent 初始标题】${agentTitle}\n` : "";

  return [
    "你是一个工作区任务分类与命名助手。请根据以下根 Agent 首轮对话的完整上下文（包含用户指令及助手回复与执行结果），提炼该任务的类型与中文简洁主题。",
    "",
    "【类型分类定义】必须严格是以下8个中文词之一，不得返回其他词汇：",
    "- 功能：新增功能、新模块、新能力接入、开发新特性",
    "- 设计：UI/UX 设计、界面原型、视觉排版、样式配色、Figma 稿",
    "- 修复：Bug 修复、解决报错、异常处理、故障排查修复",
    "- 优化：代码重构、性能调优、架构改进、清理精简、规则升级",
    "- 发布：发版部署、上线发布、打包构建、CI/CD 流程",
    "- 探索：根因排查、技术调研、方案选型、问题诊断、日志审计分析",
    "- 文档：编写文档、更新 README、API 接口文档、技术报告、说明书",
    "- 研究：算法原理推导、学术论文、前沿机制研究、理论验证",
    "",
    "【主题命名要求】",
    "1. 必须是极其简洁的中文短语（4 到 18 个字），精准概括该任务的核心目标与实质内容。",
    "2. 严禁包含项目名称（如 " + projectLabel + "），避免冗余。",
    "3. 严禁包含标点符号、引号、书名号或特殊字符。",
    "",
    "【输出格式要求】",
    "必须仅返回一个严格合法的单一 JSON 对象，不要输出任何额外的说明文字、前缀或 Markdown 标记。格式如下：",
    '{"type": "优化", "topic": "工作区标题重构优化"}',
    "",
    `项目名称：${projectLabel}`,
    agentTitleLabel ? agentTitleLabel : "",
    "首轮对话完整上下文：",
    context.fullContextText.slice(0, 3000),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Parses LLM classification response JSON from stdout.
 */
export function parseLlmClassificationJson(
  stdout: string,
  projectName?: string | null
): ClassificationResult | null {
  if (!stdout || typeof stdout !== "string") {
    return null;
  }

  // 1. Try finding json inside ```json ... ``` markdown block
  const codeBlockMatch = stdout.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      const res = validateAndCleanResult(parsed, projectName);
      if (res) return res;
    } catch {}
  }

  // 2. Try regex match for JSON object with "type" and "topic"
  const jsonMatch = stdout.match(/\{[\s\S]*?"type"[\s\S]*?"topic"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const res = validateAndCleanResult(parsed, projectName);
      if (res) return res;
    } catch {}
  }

  // 3. Fallback: try finding any JSON object in text
  const anyJsonMatch = stdout.match(/\{[\s\S]*?\}/);
  if (anyJsonMatch) {
    try {
      const parsed = JSON.parse(anyJsonMatch[0]);
      const res = validateAndCleanResult(parsed, projectName);
      if (res) return res;
    } catch {}
  }

  return null;
}

function validateAndCleanResult(
  parsed: any,
  projectName?: string | null
): ClassificationResult | null {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const rawType = typeof parsed.type === "string" ? parsed.type.trim() : "";
  const rawTopic = typeof parsed.topic === "string" ? parsed.topic.trim() : "";
  if (!isValidType(rawType)) {
    return null;
  }
  const topic = cleanTopic(rawTopic, projectName);
  if (!topic) {
    return null;
  }
  return { type: rawType, topic };
}

/**
 * Reads Paseo config to resolve the configured metadata generation provider/model.
 */
export function getResolvedModelConfig(): {
  provider: string;
  model: string;
  source: string;
} {
  const candidateConfigPaths: string[] = [];
  const paseoHome = process.env.PASEO_HOME || path.join(os.homedir(), ".paseo");
  candidateConfigPaths.push(path.join(paseoHome, "workspace-title.config.json"));
  candidateConfigPaths.push(
    path.join(paseoHome, "plugins", "workspace-title", "config.json")
  );
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    candidateConfigPaths.push(
      path.resolve(currentDir, "../workspace-title.config.json")
    );
  } catch {}

  for (const configPath of candidateConfigPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, "utf-8");
        try {
          const cfg = JSON.parse(raw);
          if (cfg && typeof cfg.model === "string" && cfg.model.trim()) {
            return {
              provider: "codex",
              model: cfg.model.trim(),
              source: configPath,
            };
          }
        } catch (jsonErr) {
          console.error(
            `[workspace-title] Failed to parse model config JSON at ${configPath}:`,
            jsonErr
          );
        }
      }
    } catch {}
  }

  // Default strictly to gemini-3.5-flash-lite
  return { provider: "codex", model: "gemini-3.5-flash-lite", source: "default" };
}

/**
 * Classification via LLM (gemini-3.5-flash-lite) using the Codex CLI.
 */
export async function classifyWithLlm(
  prompt: string,
  projectName?: string | null,
  timeoutMs = 60000
): Promise<ClassificationResult | null> {
  const meta = getResolvedModelConfig();
  const model = meta.model;
  console.log(`[workspace-title] LLM classifying via ${model} (source: ${meta.source})`);

  return new Promise((resolve) => {
    const args = [
      "exec",
      "--ephemeral",
      "-m",
      model,
      "-c",
      'model_reasoning_effort="none"',
      "-s",
      "read-only",
      "--skip-git-repo-check",
      prompt,
    ];

    const child = spawn("codex", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {}
      resolve(null);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout) {
        return resolve(null);
      }

      const res = parseLlmClassificationJson(stdout, projectName);
      resolve(res);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      console.error("[workspace-title] LLM process spawn error:", err);
      resolve(null);
    });
  });
}

/**
 * Main task analyzer: extracts full first-turn context and uses LLM (gemini-3.5-flash-lite)
 * to summarize the task type and topic. All heuristic keyword matching is removed.
 */
export async function analyzeWorkspaceTask(input: {
  firstTurn?: FirstTurnContext | null;
  timeline?: readonly any[] | null;
  agentTitle?: string | null;
  initialPrompt?: string | null;
  workspaceName?: string | null;
  projectName?: string | null;
  classifyFn?: (
    prompt: string,
    projectName?: string | null
  ) => Promise<ClassificationResult | null>;
}): Promise<ClassificationResult | null> {
  const {
    agentTitle,
    workspaceName,
    projectName,
    classifyFn = classifyWithLlm,
  } = input;

  let firstTurn = input.firstTurn;

  // If firstTurn wasn't passed directly, extract from timeline if present
  if (
    !firstTurn &&
    input.timeline &&
    Array.isArray(input.timeline) &&
    input.timeline.length > 0
  ) {
    firstTurn = extractFirstTurnContext(input.timeline);
  }

  // Fallback for initialPrompt if provided with assistant/agent info
  if (
    !firstTurn &&
    input.initialPrompt &&
    typeof input.initialPrompt === "string" &&
    input.initialPrompt.trim().length > 0
  ) {
    const promptText = input.initialPrompt.trim();
    firstTurn = {
      userInstruction: promptText,
      assistantReply: agentTitle || "（已完成首轮交互）",
      fullContextText: `【用户指令】\n${promptText}\n\n【助手回复/执行结果】\n${
        agentTitle || "（已完成首轮交互）"
      }`,
    };
  }

  // If there is no substantive first turn context, do NOT classify!
  // "不要在刚建工作区/无首轮实质内容时过早命名。"
  if (!firstTurn || !firstTurn.userInstruction) {
    return null;
  }

  const prompt = buildClassificationPrompt({
    context: firstTurn,
    projectName,
    workspaceName,
    agentTitle,
  });

  return await classifyFn(prompt, projectName);
}
