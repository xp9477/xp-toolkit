import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { WorkspaceRecordState, WorkspaceStateStatus } from "../shared/types";

export class WorkspaceTitleStore {
  private states = new Map<string, WorkspaceRecordState>();
  private filePath: string | null = null;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(filePath?: string) {
    if (filePath) {
      this.filePath = filePath;
    } else {
      const paseoHome =
        process.env.PASEO_HOME || path.join(os.homedir(), ".paseo");
      this.filePath = path.join(paseoHome, "workspace-title-state.json");
    }
    this.load();
  }

  public get(workspaceId: string): WorkspaceRecordState | undefined {
    return this.states.get(workspaceId);
  }

  public canAttempt(workspaceId: string, maxRetries = 3): boolean {
    const existing = this.states.get(workspaceId);
    if (!existing) return true;
    if (
      existing.status === "named" ||
      existing.status === "manual" ||
      existing.status === "skipped"
    ) {
      return false;
    }
    return existing.attempts < maxRetries;
  }

  public recordAttempt(workspaceId: string, originalTitle?: string): number {
    const existing: WorkspaceRecordState = this.states.get(workspaceId) || {
      workspaceId,
      status: "pending",
      attempts: 0,
      lastAttemptAt: Date.now(),
      originalTitle,
    };
    existing.attempts += 1;
    existing.lastAttemptAt = Date.now();
    if (originalTitle && !existing.originalTitle) {
      existing.originalTitle = originalTitle;
    }
    this.states.set(workspaceId, existing);
    this.scheduleSave();
    return existing.attempts;
  }

  public recordNamed(workspaceId: string, assignedTitle: string): void {
    const state: WorkspaceRecordState = this.states.get(workspaceId) || {
      workspaceId,
      status: "pending",
      attempts: 1,
      lastAttemptAt: Date.now(),
    };
    state.status = "named";
    state.assignedTitle = assignedTitle;
    state.lastAttemptAt = Date.now();
    delete state.reason;
    this.states.set(workspaceId, state);
    this.scheduleSave();
  }

  public recordManual(workspaceId: string, customTitle: string): void {
    const state: WorkspaceRecordState = this.states.get(workspaceId) || {
      workspaceId,
      status: "pending",
      attempts: 0,
      lastAttemptAt: Date.now(),
    };
    state.status = "manual";
    state.assignedTitle = customTitle;
    state.lastAttemptAt = Date.now();
    state.reason = "User manual rename";
    this.states.set(workspaceId, state);
    this.scheduleSave();
  }

  public recordSkipped(workspaceId: string, reason: string): void {
    const state: WorkspaceRecordState = this.states.get(workspaceId) || {
      workspaceId,
      status: "pending",
      attempts: 0,
      lastAttemptAt: Date.now(),
    };
    state.status = "skipped";
    state.reason = reason;
    state.lastAttemptAt = Date.now();
    this.states.set(workspaceId, state);
    this.scheduleSave();
  }

  public recordFailed(workspaceId: string, reason: string): void {
    const state: WorkspaceRecordState = this.states.get(workspaceId) || {
      workspaceId,
      status: "pending",
      attempts: 1,
      lastAttemptAt: Date.now(),
    };
    state.status = "failed";
    state.reason = reason;
    state.lastAttemptAt = Date.now();
    this.states.set(workspaceId, state);
    this.scheduleSave();
  }

  public getAllStates(): WorkspaceRecordState[] {
    return Array.from(this.states.values());
  }

  private load(): void {
    if (!this.filePath) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && typeof item.workspaceId === "string") {
              this.states.set(item.workspaceId, item);
            }
          }
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  private scheduleSave(): void {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.save();
    }, 200);
  }

  public save(): void {
    if (!this.filePath) return;
    try {
      const data = JSON.stringify(this.getAllStates(), null, 2);
      const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, data, "utf-8");
      fs.renameSync(tmpPath, this.filePath);
    } catch {
      // Ignore write errors
    }
  }

  public destroy(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
      this.save();
    }
  }
}
