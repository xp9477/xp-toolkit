import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ALLOWED_TYPES, type ClassificationResult, type WorkspaceTaskType } from "../shared/types";
import { cleanTopic, isValidType } from "../shared/formatter";

interface HeuristicRule {
  type: WorkspaceTaskType;
  leadingRegex?: RegExp;
  patterns: RegExp[];
  leadingVerbRegex?: RegExp;
}

// Ordered rules: leading intent is checked first, then pattern matches
const HEURISTIC_RULES: HeuristicRule[] = [
  {
    type: "优化",
    leadingRegex: /^(?:优化|调优|重构|提升|提速|精简|清理|加速|减负|refactor|optimize)\s*/i,
    patterns: [
      /性能优化|体验优化|代码重构|代码整理|调优|提速|精简|减负/i,
      /(?:优化|重构|提升|清理|加速)/i,
      /(?:refactor|optimize|tuning|perf|cleanup)/i,
    ],
    leadingVerbRegex: /^(?:优化|调优|重构|提升|清理)?\s*/,
  },
  {
    type: "修复",
    leadingRegex: /^(?:修复|解决|处理|修一下|fix|patch|resolve)\s*/i,
    patterns: [
      /修复|解决|报错|异常|崩溃|缺陷|故障|失灵|修一下|修复问题|解决报错|修复bug/i,
      /(?:fix|bug|crash|error|panic|fault|patch|resolve)/i,
    ],
    leadingVerbRegex: /^(?:修复|解决|处理|修一下)?\s*/,
  },
  {
    type: "探索",
    leadingRegex: /^(?:排查|分析|探索|调研|核查|核验|诊断|定位|investigate|diagnose|explore|troubleshoot|audit)\s*/i,
    patterns: [
      /排查|分析|调研|诊断|定位|探测|审查|评估|探索|核查|核验|查明|原因/i,
      /为什么|为何|怎么搞的|失败原因|根因/i,
      /(?:investigate|diagnose|explore|audit|inspect|troubleshoot|root cause)/i,
    ],
    leadingVerbRegex: /^(?:排查|探索|调研|核查|核验|诊断|定位|分析)\s*/,
  },
  {
    type: "发布",
    leadingRegex: /^(?:发布|发版|上线|部署|release|deploy|publish)\s*/i,
    patterns: [
      /发布|发版|上线|部署|打包发布/i,
      /(?:release|deploy|publish|ship|distribution)/i,
      /(?:ci\/cd|github actions|workflow release)/i,
    ],
    leadingVerbRegex: /^(?:发布|发版|上线|部署)\s*/,
  },
  {
    type: "文档",
    leadingRegex: /^(?:(?:编写|更新|补充|修改|完善)?\s*(?:接口|API|技术|使用|开发)?文档|readme|docs?|changelog|manual|specification|写文档|写报告|出报告|writeup|说明书)/i,
    patterns: [
      /(?:编写|更新|补充|修改|完善)?(?:接口|API|技术|使用|开发)?文档/i,
      /(?:readme|docs?|changelog|manual|specification|注释规范)/i,
      /写文档|写报告|出报告|writeup|技术文档|说明书/i,
    ],
    leadingVerbRegex: /^(?:编写|更新|补充|完善|修改)?\s*(?:关于)?\s*/,
  },
  {
    type: "研究",
    leadingRegex: /^(?:(?:深入)?研究|理论推导|算法原理|survey|research)\s*/i,
    patterns: [
      /学术|论文|理论|算法原理|机制研究|深入研究|理论推导|前沿调研|算法对比/i,
      /(?:survey|academic|deep research)/i,
    ],
    leadingVerbRegex: /^(?:深入)?研究\s*/,
  },
  {
    type: "设计",
    leadingRegex: /^(?:设计|制作|配色|排版|样式|figma|ui|ux|design|styling)\s*/i,
    patterns: [
      /视觉设计|界面原型|配色|设计稿|组件样式|美化/i,
      /(?:设计|界面|ui|ux|样式|排版|原型|figma|css|layout|theme|visual|styling)/i,
    ],
    leadingVerbRegex: /^(?:设计|制作)?\s*/,
  },
  {
    type: "功能",
    leadingRegex: /^(?:新增|添加|实现|接入|支持|集成|创建|开发|写一个|做个|add|implement|feature|create|build|develop|enable|setup)\s*/i,
    patterns: [
      /新增|添加|实现|接入|支持|集成|创建|开发|写一个|做个/i,
      /功能|插件|模块|服务|组件|工具/i,
      /(?:不需要.*(?:人工|手动).*参与|后台.*(?:自己|自动)?跑|无人值守|后台运行|全自动运行)/i,
      /(?:add|implement|feature|create|build|develop|enable|automate|unattended)/i,
    ],
    leadingVerbRegex: /^(?:实现|新增|添加|接入|支持|集成|创建|开发|写一个|做个)?\s*/,
  },
];

/**
 * Fast zero-token heuristic classification based on title/prompt keywords.
 */
export function classifyHeuristic(
  text: string,
  projectName?: string | null,
): ClassificationResult | null {
  if (!text || typeof text !== "string") {
    return null;
  }

  let cleaned = cleanTopic(text, projectName);
  if (!cleaned) {
    return null;
  }

  // Check specific high-intent semantic phrases first
  if (/(?:不需要.*(?:人工|手动).*参与|后台.*(?:自己|自动)?跑|无人值守|后台运行|全自动运行|unattended background)/i.test(cleaned)) {
    return {
      type: "功能",
      topic: "后台无人值守自动运行",
    };
  }

  // Clean conversational prefixes
  cleaned = cleaned.replace(/^(?:请|帮我|麻烦|需要|我想|开始|正在)\s*/, "");

  let matchedRule: HeuristicRule | null = null;

  // Phase 1: Check leading intent prefix (highest confidence)
  for (const rule of HEURISTIC_RULES) {
    if (rule.leadingRegex && rule.leadingRegex.test(cleaned)) {
      matchedRule = rule;
      break;
    }
  }

  // Phase 2: Check pattern matches in order
  if (!matchedRule) {
    for (const rule of HEURISTIC_RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(cleaned)) {
          matchedRule = rule;
          break;
        }
      }
      if (matchedRule) break;
    }
  }

  if (!matchedRule) {
    return null;
  }

  // Derive a concise topic
  let topic = cleaned;

  // Strip leading redundant verb corresponding to the matched type
  if (matchedRule.leadingVerbRegex) {
    const stripped = topic.replace(matchedRule.leadingVerbRegex, "").trim();
    if (stripped.length >= 2) {
      topic = stripped;
    }
  }

  // If topic is too long (e.g. a multi-sentence prompt), take the first sentence/clause
  const firstClause = topic.split(/[\n\r，。！？；;!?,]/)[0]?.trim();
  if (firstClause && firstClause.length >= 4 && firstClause.length <= 25) {
    topic = firstClause;
  }

  topic = cleanTopic(topic, projectName);
  if (!topic) {
    return null;
  }

  return {
    type: matchedRule.type,
    topic,
  };
}

/**
 * Reads Paseo config to resolve the configured metadata generation provider/model.
 */
export function getPaseoMetadataProvider(): { provider: string; model?: string } {
  try {
    const paseoHome =
      process.env.PASEO_HOME || path.join(os.homedir(), ".paseo");
    const configPath = path.join(paseoHome, "config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const mg = config.agents?.metadataGeneration?.providers?.[0];
      if (mg && typeof mg.provider === "string") {
        return { provider: mg.provider, model: mg.model };
      }
    }
  } catch {
    // Ignore read errors
  }
  return { provider: "codex", model: "gemini-3.8-flash-high" };
}

/**
 * Fallback LLM-based classification using the configured CLI provider.
 */
export async function classifyWithLlm(
  content: string,
  projectName?: string | null,
  timeoutMs = 60000,
): Promise<ClassificationResult | null> {
  const meta = getPaseoMetadataProvider();
  const model = meta.model || "gemini-3.8-flash-high";

  const prompt = [
    "你是一个任务分类助手。根据以下用户任务内容，提取任务类型与中文简洁主题。",
    "要求：",
    "1. 类型必须严格是以下8个中文词之一：功能、设计、修复、优化、发布、探索、文档、研究。",
    "2. 主题必须是极其简洁的中文短语（4到18个字），概括任务核心目标，不得包含项目名称，不要有标点符号或引号。",
    "3. 只能返回一个严格合法的 JSON 对象，不要输出任何额外文本或 Markdown 标记。格式如下：",
    '{"type": "功能", "topic": "工作区自动命名插件"}',
    `项目名称：${projectName || "无"}`,
    `任务内容：${content.slice(0, 1500)}`,
  ].join("\n");

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

    // Important: stdio[0] must be 'ignore' so codex does not wait on stdin!
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

      const jsonMatch = stdout.match(/\{[\s\S]*?"type"[\s\S]*?"topic"[\s\S]*?\}/);
      if (!jsonMatch) {
        return resolve(null);
      }

      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (
          parsed &&
          typeof parsed.type === "string" &&
          typeof parsed.topic === "string"
        ) {
          const type = parsed.type.trim();
          const topic = cleanTopic(parsed.topic, projectName);
          if (isValidType(type) && topic) {
            return resolve({ type, topic });
          }
        }
      } catch {
        // Parse error
      }
      resolve(null);
    });

    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

/**
 * Combined analyzer: tries heuristic first for zero tokens / instant response,
 * falls back to LLM if heuristic cannot determine type or topic in Chinese.
 */
export async function analyzeWorkspaceTask(input: {
  agentTitle?: string | null;
  initialPrompt?: string | null;
  workspaceName?: string | null;
  projectName?: string | null;
  enableLlmFallback?: boolean;
}): Promise<ClassificationResult | null> {
  const {
    agentTitle,
    initialPrompt,
    workspaceName,
    projectName,
    enableLlmFallback = true,
  } = input;

  const cleanWsName = cleanTopic(workspaceName || "", projectName);
  const cleanAgentTitle = cleanTopic(agentTitle || "", projectName);
  const cleanPrompt = cleanTopic(initialPrompt || "", projectName);

  const hasChineseInContext =
    /[\u4e00-\u9fa5]/.test(cleanPrompt) ||
    /[\u4e00-\u9fa5]/.test(cleanAgentTitle);

  // Helper to ensure topic is Chinese when user context is in Chinese
  const isAcceptableResult = (res: ClassificationResult | null) => {
    if (!res) return false;
    const cleanT = cleanTopic(res.topic, projectName);
    if (!cleanT) return false;
    if (hasChineseInContext && !/[\u4e00-\u9fa5]/.test(cleanT)) {
      return false; // Reject English topic if user prompt was in Chinese
    }
    return true;
  };

  // 1. Try heuristic on initialPrompt
  if (cleanPrompt) {
    const res = classifyHeuristic(cleanPrompt, projectName);
    if (isAcceptableResult(res)) {
      return res;
    }
  }

  // 2. Try heuristic on agentTitle (if concise)
  if (cleanAgentTitle && cleanAgentTitle.length <= 30) {
    const res = classifyHeuristic(cleanAgentTitle, projectName);
    if (isAcceptableResult(res)) {
      return res;
    }
  }

  // 3. Try heuristic on workspaceName (only if acceptable)
  if (cleanWsName && cleanWsName !== "main" && cleanWsName !== "master") {
    const res = classifyHeuristic(cleanWsName, projectName);
    if (isAcceptableResult(res)) {
      return res;
    }
  }

  // 4. If heuristic didn't match or topic was not in Chinese, call LLM with user prompt
  if (enableLlmFallback) {
    const targetText = cleanPrompt || cleanAgentTitle || cleanWsName;
    if (targetText && targetText.length > 0) {
      const llmResult = await classifyWithLlm(targetText, projectName);
      if (llmResult) {
        return llmResult;
      }
    }
  }

  return null;
}
