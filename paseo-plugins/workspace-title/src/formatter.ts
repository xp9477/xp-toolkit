import { ALLOWED_TYPES, type WorkspaceTaskType } from "./types";

export const FORMATTED_TITLE_REGEX =
  /^(\d{4}) \| (功能|设计|修复|优化|发布|探索|文档|研究) \| (.+)$/;

/**
 * Format an ISO date string into MMDD using Asia/Shanghai timezone.
 * Returns null if createdAt is missing, invalid, or empty.
 */
export function formatMMDD(
  createdAt: string | null | undefined,
  timeZone = "Asia/Shanghai",
): string | null {
  if (!createdAt || typeof createdAt !== "string") {
    return null;
  }
  const date = new Date(createdAt.trim());
  if (isNaN(date.getTime())) {
    return null;
  }
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(date);
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    if (!month || !day) {
      return null;
    }
    return `${month}${day}`;
  } catch {
    return null;
  }
}

/**
 * Check if the provided string is one of the 8 allowed types.
 */
export function isValidType(type: string): type is WorkspaceTaskType {
  return (ALLOWED_TYPES as readonly string[]).includes(type);
}

/**
 * Clean and normalize the topic:
 * - Remove redundant project name mentions
 * - Strip quotes, markdown, and extra whitespace
 * - Ensure reasonable length
 */
export function cleanTopic(
  rawTopic: string,
  projectName?: string | null,
): string {
  if (!rawTopic || typeof rawTopic !== "string") {
    return "";
  }

  let topic = rawTopic.trim();

  // Strip markdown formatting & backticks
  topic = topic.replace(/[`*_~#]/g, "").trim();

  // Strip project name if provided
  if (projectName && typeof projectName === "string") {
    const pName = projectName.trim();
    const shortName = pName.includes("/") ? pName.split("/").pop()! : pName;

    const namesToStrip = Array.from(new Set([pName, shortName])).filter(Boolean);
    for (const name of namesToStrip) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const prefixRegexes = [
        new RegExp(`^【${escaped}】\\s*`, "i"),
        new RegExp(`^\\[${escaped}\\]\\s*`, "i"),
        new RegExp(`^\\(${escaped}\\)\\s*`, "i"),
        new RegExp(`^${escaped}\\s*[:：\\-\\|]\\s*`, "i"),
        new RegExp(`^在\\s*${escaped}\\s*(中|里|下)?\\s*`, "i"),
        new RegExp(`^${escaped}\\s+`, "i"),
      ];
      for (const rx of prefixRegexes) {
        topic = topic.replace(rx, "").trim();
      }
    }
  }

  // Strip surrounding quotes or brackets left over
  topic = topic
    .replace(/^[“"‘'\[(【「]+/, "")
    .replace(/[”"’'\])】」]+$/, "")
    .trim();

  // Normalize all whitespaces / newlines to single space
  topic = topic.replace(/\s+/g, " ").trim();

  // If topic ends with trailing punctuation like colon or hyphen, clean it
  topic = topic.replace(/[:：\\-\\|]+$/, "").trim();

  // Cap topic length to 40 characters for sidebar readability
  if (topic.length > 40) {
    topic = topic.slice(0, 40).trim();
  }

  return topic;
}

/**
 * Checks if a title already strictly matches `MMDD | 类型 | 主题` format.
 */
export function isFormattedTitle(title: string | null | undefined): boolean {
  if (!title || typeof title !== "string") {
    return false;
  }
  return FORMATTED_TITLE_REGEX.test(title.trim());
}

/**
 * Parse an already-formatted title into its components.
 */
export function parseFormattedTitle(
  title: string | null | undefined,
): { mmdd: string; type: WorkspaceTaskType; topic: string } | null {
  if (!title || typeof title !== "string") {
    return null;
  }
  const match = title.trim().match(FORMATTED_TITLE_REGEX);
  if (!match) {
    return null;
  }
  const [, mmdd, type, topic] = match;
  if (!isValidType(type)) {
    return null;
  }
  return { mmdd, type, topic: topic.trim() };
}

/**
 * Build the full standardized title: `MMDD | 类型 | 主题`.
 * Returns null if any parameter is invalid.
 */
export function buildTitle(
  createdAt: string | null | undefined,
  type: string,
  rawTopic: string,
  projectName?: string | null,
): string | null {
  const mmdd = formatMMDD(createdAt);
  if (!mmdd) {
    return null;
  }
  if (!isValidType(type)) {
    return null;
  }
  const topic = cleanTopic(rawTopic, projectName);
  if (!topic) {
    return null;
  }
  return `${mmdd} | ${type} | ${topic}`;
}
