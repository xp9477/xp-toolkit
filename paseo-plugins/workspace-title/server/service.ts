import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ChildProcess } from "node:child_process";
import { formatMMDD, isFormattedTitle, parseFormattedTitle, buildTitle } from "../shared/formatter";
import { analyzeWorkspaceTask } from "./analyzer";
import { WorkspaceTitleStore } from "./store";
import type { WorkspaceTitlePluginConfig } from "../shared/types";

export class WorkspaceTitleService {
  private store: WorkspaceTitleStore;
  private config: Required<WorkspaceTitlePluginConfig>;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private processingLocks = new Set<string>();
  private activeProcesses = new Set<ChildProcess>();
  private unsubscribeWorkspaceUpdates: (() => void) | null = null;
  private unsubscribeAgentUpdates: (() => void) | null = null;
  private daemonClient: any = null;
  private paseo: any = null;

  constructor(options?: WorkspaceTitlePluginConfig, store?: WorkspaceTitleStore) {
    this.config = {
      maxRetries: options?.maxRetries ?? 3,
      scanIntervalMs: options?.scanIntervalMs ?? 5000,
      timezone: options?.timezone ?? "Asia/Shanghai",
      enableLlmFallback: options?.enableLlmFallback ?? true,
    };
    this.store = store || new WorkspaceTitleStore();
  }

  public getStore(): WorkspaceTitleStore {
    return this.store;
  }

  /**
   * Start the background service: connects to daemon, sets up subscriptions and polling.
   */
  public async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    console.log("[workspace-title] Service starting...");

    try {
      await this.initDaemonConnection();
      console.log("[workspace-title] Daemon connection established.");

      // Run initial check on all workspaces
      await this.checkAllWorkspaces().catch((err) => {
        console.error("[workspace-title] Initial scan error:", err);
      });

      // Start periodic background sweep timer
      this.timer = setInterval(() => {
        if (!this.running) return;
        this.checkAllWorkspaces().catch((err) => {
          console.error("[workspace-title] Background sweep error:", err);
        });
      }, this.config.scanIntervalMs);
    } catch (err) {
      console.error("[workspace-title] Failed to start daemon connection:", err);
      // Retry connection on timer
      this.timer = setInterval(() => {
        if (!this.running) return;
        if (!this.daemonClient) {
          this.initDaemonConnection().catch(() => {});
        } else {
          this.checkAllWorkspaces().catch(() => {});
        }
      }, this.config.scanIntervalMs);
    }
  }

  /**
   * Stop background service and cleanly teardown resources.
   */
  public async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const cp of this.activeProcesses) {
      try {
        cp.kill("SIGTERM");
      } catch {}
    }
    this.activeProcesses.clear();

    if (this.unsubscribeWorkspaceUpdates) {
      this.unsubscribeWorkspaceUpdates();
      this.unsubscribeWorkspaceUpdates = null;
    }
    if (this.unsubscribeAgentUpdates) {
      this.unsubscribeAgentUpdates();
      this.unsubscribeAgentUpdates = null;
    }
    if (this.daemonClient) {
      await this.daemonClient.close().catch(() => {});
      this.daemonClient = null;
      this.paseo = null;
    }
    this.store.destroy();
    console.log("[workspace-title] Service stopped cleanly.");
  }

  /**
   * Connect to daemon and register real-time event listeners.
   */
  private async initDaemonConnection(): Promise<void> {
    const nodeReq = eval("require");
    const { connectToDaemon } = nodeReq(
      "/home/parker/.npm-global/lib/node_modules/@getpaseo/cli/dist/utils/client.js"
    );
    const { createPaseoApi } = nodeReq(
      "/home/parker/.npm-global/lib/node_modules/@getpaseo/cli/node_modules/@getpaseo/client/dist/index.js"
    );

    this.daemonClient = await connectToDaemon();
    this.paseo = createPaseoApi(this.daemonClient);

    // Subscribe to workspace updates
    this.unsubscribeWorkspaceUpdates = this.paseo.workspaces.subscribe(
      (update: any) => {
        if (!this.running) return;
        if (update && update.kind === "upsert" && update.workspace) {
          this.processWorkspace(update.workspace).catch((err) => {
            console.error(`[workspace-title] Error processing workspace update ${update.workspace.id}:`, err);
          });
        }
      }
    );

    // Subscribe to agent updates (to catch when a primary agent starts or updates its title)
    this.unsubscribeAgentUpdates = this.paseo.agents.subscribe(
      (update: any) => {
        if (!this.running) return;
        if (update && update.kind === "upsert" && update.agent) {
          const agent = update.agent;
          // Ignore sub-agents
          if (agent.parentAgentId || agent.labels?.["paseo.parent-agent-id"]) {
            return;
          }
          if (agent.workspaceId) {
            this.processWorkspaceById(agent.workspaceId).catch((err) => {
              console.error(`[workspace-title] Error processing workspace from agent update ${agent.workspaceId}:`, err);
            });
          }
        }
      }
    );

    // Request stream subscription for workspaces and agents
    await this.paseo.workspaces.list({ subscribe: {} }).catch(() => {});
    await this.paseo.agents.list({ subscribe: {} }).catch(() => {});
  }

  /**
   * Sweep all workspaces.
   */
  public async checkAllWorkspaces(): Promise<void> {
    if (!this.running || !this.paseo) return;
    const res = await this.paseo.workspaces.list({ page: { limit: 200 } });
    if (!res || !Array.isArray(res.entries)) return;

    for (const workspace of res.entries) {
      if (!this.running) break;
      await this.processWorkspace(workspace).catch((err) => {
        console.error(`[workspace-title] Error in sweep for ${workspace.id}:`, err);
      });
    }
  }

  public async processWorkspaceById(workspaceId: string): Promise<void> {
    if (!this.running || !this.paseo) return;
    const handle = this.paseo.workspaces.ref(workspaceId);
    const workspace = await handle.refresh();
    if (workspace) {
      await this.processWorkspace(workspace);
    }
  }

  /**
   * Process a single workspace: validation, manual protection, task analysis, renaming.
   */
  public async processWorkspace(workspace: any): Promise<boolean> {
    if (!this.running) return false;
    const workspaceId = workspace.id || workspace.workspaceId;
    if (!workspaceId) return false;

    // Mutex: Avoid concurrent runs for the same workspace
    if (this.processingLocks.has(workspaceId)) {
      return false;
    }

    this.processingLocks.add(workspaceId);
    try {
      return await this.doProcessWorkspace(workspace);
    } finally {
      this.processingLocks.delete(workspaceId);
    }
  }

  private async doProcessWorkspace(workspace: any): Promise<boolean> {
    if (!this.running) return false;
    const workspaceId = workspace.id || workspace.workspaceId;
    const currentTitle = workspace.title ?? null;

    // 1. Check archive protection
    if (
      workspace.archivingAt ||
      workspace.archivedAt ||
      workspace.status === "archived"
    ) {
      this.store.recordSkipped(workspaceId, "Archived workspace protected");
      return false;
    }

    // 2. Resolve root/primary agent for the workspace first
    const rootAgent = await this.resolveRootAgent(workspaceId);

    // 3. Check if already formatted (Idempotency)
    const parsed = parseFormattedTitle(currentTitle);
    if (parsed) {
      // Check if user context is Chinese but existing title topic was in English
      const hasChineseContext =
        (rootAgent && /[\u4e00-\u9fa5]/.test(rootAgent.title || "")) ||
        /[\u4e00-\u9fa5]/.test(workspace.name || "");
      const isEnglishTopic = !/[\u4e00-\u9fa5]/.test(parsed.topic);

      if (!(hasChineseContext && isEnglishTopic)) {
        this.store.recordNamed(workspaceId, currentTitle!);
        return false;
      }
    }

    // 4. Check user manual rename protection
    const state = this.store.get(workspaceId);
    if (state?.status === "manual") {
      return false;
    }

    if (
      state?.status === "named" &&
      state.assignedTitle &&
      currentTitle &&
      currentTitle !== state.assignedTitle
    ) {
      console.log(
        `[workspace-title] User manual title detected on ${workspaceId}: "${currentTitle}". Protecting.`
      );
      this.store.recordManual(workspaceId, currentTitle);
      return false;
    }

    // 5. Check retry limit
    if (!this.store.canAttempt(workspaceId, this.config.maxRetries)) {
      return false;
    }

    if (!rootAgent) {
      // Workspace has no agents yet. Do not penalize or exhaust retries.
      return false;
    }

    // Record attempt now that an agent is present
    this.store.recordAttempt(workspaceId, currentTitle || undefined);

    // 6. Fetch actual createdAt of workspace
    const createdAt = await this.resolveWorkspaceCreatedAt(workspaceId);
    if (!createdAt) {
      console.warn(
        `[workspace-title] Could not find createdAt for workspace ${workspaceId}. Retaining original name.`
      );
      this.store.recordFailed(workspaceId, "Missing workspace createdAt");
      return false;
    }

    let agentTitle: string | null = rootAgent.title || null;
    let initialPrompt: string | null = await this.fetchAgentFirstPrompt(rootAgent.id);

    if (!this.running) return false;

    // 7. Analyze task to get type and topic
    const classification = await analyzeWorkspaceTask({
      agentTitle,
      initialPrompt,
      workspaceName: workspace.name,
      projectName: workspace.projectDisplayName || workspace.name,
      enableLlmFallback: this.config.enableLlmFallback,
    });

    if (!this.running) return false;

    if (!classification) {
      console.warn(
        `[workspace-title] Information insufficient to classify task for workspace ${workspaceId}. Retaining original name.`
      );
      this.store.recordFailed(workspaceId, "Task classification insufficient");
      return false;
    }

    // 8. Build target standardized title
    const newTitle = buildTitle(
      createdAt,
      classification.type,
      classification.topic,
      workspace.projectDisplayName || workspace.name
    );

    if (!newTitle) {
      console.warn(
        `[workspace-title] Failed to build title for workspace ${workspaceId}. Retaining original name.`
      );
      this.store.recordFailed(workspaceId, "Title build failed");
      return false;
    }

    // 9. Check if current title is already this exact title
    if (currentTitle === newTitle) {
      this.store.recordNamed(workspaceId, newTitle);
      return false;
    }

    // 10. Perform the rename via official SDK
    console.log(
      `[workspace-title] Renaming workspace ${workspaceId} to "${newTitle}"`
    );
    const handle = this.paseo.workspaces.ref(workspaceId);
    await handle.setTitle(newTitle);

    // Record success in store
    this.store.recordNamed(workspaceId, newTitle);
    console.log(
      `[workspace-title] Successfully renamed workspace ${workspaceId} -> "${newTitle}"`
    );
    return true;
  }

  /**
   * Resolves workspace createdAt from ~/.paseo/projects/workspaces.json
   */
  public async resolveWorkspaceCreatedAt(
    workspaceId: string,
    retries = 3,
    delayMs = 400
  ): Promise<string | null> {
    const paseoHome =
      process.env.PASEO_HOME || path.join(os.homedir(), ".paseo");
    const workspacesJsonPath = path.join(
      paseoHome,
      "projects",
      "workspaces.json"
    );

    for (let i = 0; i < retries; i++) {
      if (!this.running) return null;
      try {
        if (fs.existsSync(workspacesJsonPath)) {
          const content = fs.readFileSync(workspacesJsonPath, "utf-8");
          const list = JSON.parse(content);
          if (Array.isArray(list)) {
            const found = list.find((w) => w.workspaceId === workspaceId);
            if (found && typeof found.createdAt === "string") {
              return found.createdAt;
            }
          }
        }
      } catch {
        // Ignore read/parse error on concurrent file write
      }

      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return null;
  }

  /**
   * Finds the root/primary agent for the workspace (ignoring sub-agents).
   */
  public async resolveRootAgent(workspaceId: string): Promise<any | null> {
    if (!this.paseo) return null;
    try {
      const res = await this.paseo.agents.list({
        page: { limit: 100 },
      });
      if (!res || !Array.isArray(res.entries)) return null;

      // Filter agents belonging to this workspace and exclude sub-agents
      const rootAgents = res.entries
        .map((e: any) => e.agent || e)
        .filter((agent: any) => {
          if (!agent || agent.workspaceId !== workspaceId) return false;
          // Ignore sub-agents
          if (agent.parentAgentId || agent.labels?.["paseo.parent-agent-id"]) {
            return false;
          }
          return true;
        });

      if (rootAgents.length === 0) return null;

      // Sort by createdAt ascending: the FIRST root agent is the workspace's primary creator/task
      rootAgents.sort((a: any, b: any) => {
        const timeA = a.createdAt ? Date.parse(a.createdAt) : 0;
        const timeB = b.createdAt ? Date.parse(b.createdAt) : 0;
        return timeA - timeB;
      });

      return rootAgents[0];
    } catch {
      return null;
    }
  }

  /**
   * Fetch the first user prompt from the agent's timeline.
   */
  public async fetchAgentFirstPrompt(agentId: string): Promise<string | null> {
    if (!this.daemonClient) return null;
    try {
      const timeline = await this.daemonClient.fetchAgentTimeline(agentId, {
        page: { limit: 20 },
      });
      if (!timeline || !Array.isArray(timeline.entries)) return null;

      for (const entry of timeline.entries) {
        if (
          entry &&
          entry.item &&
          (entry.item.type === "user_message" || entry.item.type === "prompt")
        ) {
          if (typeof entry.item.text === "string" && entry.item.text.trim()) {
            return entry.item.text.trim();
          }
        }
      }
    } catch {
      // Ignore timeline fetch errors
    }
    return null;
  }
}
