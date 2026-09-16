export const ALLOWED_TYPES = [
  "功能",
  "设计",
  "修复",
  "优化",
  "发布",
  "探索",
  "文档",
  "研究",
] as const;

export type WorkspaceTaskType = (typeof ALLOWED_TYPES)[number];

export interface ClassificationResult {
  type: WorkspaceTaskType;
  topic: string;
}

export interface FirstTurnContext {
  userInstruction: string;
  assistantReply: string;
  toolSummaries?: string[];
  fullContextText: string;
}

export type WorkspaceStateStatus =
  | "pending"
  | "named"
  | "manual"
  | "skipped"
  | "failed";

export interface WorkspaceRecordState {
  workspaceId: string;
  status: WorkspaceStateStatus;
  assignedTitle?: string;
  originalTitle?: string;
  attempts: number;
  lastAttemptAt: number;
  reason?: string;
}

export interface WorkspaceTitlePluginConfig {
  maxRetries?: number;
  scanIntervalMs?: number;
  timezone?: string;
  enableLlmFallback?: boolean;
}

export interface WorkspaceTitleServiceOptions extends WorkspaceTitlePluginConfig {
  analyzeTask?: (input: {
    firstTurn?: FirstTurnContext | null;
    timeline?: readonly any[] | null;
    agentTitle?: string | null;
    initialPrompt?: string | null;
    workspaceName?: string | null;
    projectName?: string | null;
  }) => Promise<ClassificationResult | null>;
}
