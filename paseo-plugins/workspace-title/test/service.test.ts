import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkspaceTitleService } from "../server/service";
import { WorkspaceTitleStore } from "../server/store";

function createMockService(options?: {
  workspacesJson?: any[];
  agents?: any[];
  timelineMap?: Record<string, any>;
}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-test-"));
  const stateFile = path.join(tmpDir, "state.json");
  const projectsDir = path.join(tmpDir, "projects");
  fs.mkdirSync(projectsDir, { recursive: true });
  const workspacesFile = path.join(projectsDir, "workspaces.json");

  if (options?.workspacesJson) {
    fs.writeFileSync(workspacesFile, JSON.stringify(options.workspacesJson));
  }

  // Set PASEO_HOME for this test
  process.env.PASEO_HOME = tmpDir;

  const store = new WorkspaceTitleStore(stateFile);
  const service = new WorkspaceTitleService({ enableLlmFallback: false }, store);
  (service as any).running = true;

  const setTitleCalls: Array<{ id: string; title: string }> = [];

  // Mock paseo API
  const mockPaseo = {
    workspaces: {
      ref: (id: string) => ({
        setTitle: async (title: string) => {
          setTitleCalls.push({ id, title });
          return { title };
        },
        refresh: async () => null,
      }),
      list: async () => ({ entries: [] }),
    },
    agents: {
      list: async () => ({
        entries: (options?.agents || []).map((a) => ({ agent: a })),
      }),
    },
  };

  const mockDaemonClient = {
    fetchAgentTimeline: async (agentId: string) => {
      return options?.timelineMap?.[agentId] || { entries: [] };
    },
    close: async () => {},
  };

  (service as any).paseo = mockPaseo;
  (service as any).daemonClient = mockDaemonClient;

  const cleanup = () => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  };

  return { service, store, setTitleCalls, cleanup, tmpDir };
}

test("Idempotency: already formatted title is never renamed", async () => {
  const { service, setTitleCalls, cleanup } = createMockService();
  try {
    const workspace = {
      id: "wks_test_1",
      title: "0913 | 功能 | 实现工作区自动命名插件",
      name: "talk",
      projectDisplayName: "talk",
    };

    const renamed = await service.processWorkspace(workspace);
    assert.equal(renamed, false);
    assert.equal(setTitleCalls.length, 0);
  } finally {
    cleanup();
  }
});

test("Archived protection: archived workspaces are never renamed", async () => {
  const { service, setTitleCalls, cleanup } = createMockService();
  try {
    const workspace1 = {
      id: "wks_archived_1",
      title: "talk",
      name: "talk",
      archivedAt: "2026-09-13T01:00:00Z",
    };
    const workspace2 = {
      id: "wks_archived_2",
      title: "talk",
      name: "talk",
      archivingAt: "2026-09-13T01:00:00Z",
    };

    assert.equal(await service.processWorkspace(workspace1), false);
    assert.equal(await service.processWorkspace(workspace2), false);
    assert.equal(setTitleCalls.length, 0);
  } finally {
    cleanup();
  }
});

test("Missing createdAt: retains original title and does not rename", async () => {
  const { service, setTitleCalls, cleanup } = createMockService({
    workspacesJson: [], // empty: no createdAt found
    agents: [
      {
        id: "ag_missing_date",
        workspaceId: "wks_missing_date",
        title: "实现任务",
      },
    ],
  });
  try {
    const workspace = {
      id: "wks_missing_date",
      title: "unnamed workspace",
      name: "unnamed",
    };

    const renamed = await service.processWorkspace(workspace);
    assert.equal(renamed, false);
    assert.equal(setTitleCalls.length, 0);
  } finally {
    cleanup();
  }
});

test("Manual rename protection: user edit after plugin naming is preserved", async () => {
  const { service, store, setTitleCalls, cleanup } = createMockService({
    workspacesJson: [
      {
        workspaceId: "wks_manual_test",
        createdAt: "2026-09-13T04:00:00.000Z",
      },
    ],
    agents: [
      {
        id: "ag_root",
        workspaceId: "wks_manual_test",
        title: "实现自动命名功能",
        createdAt: "2026-09-13T04:01:00.000Z",
      },
    ],
  });

  try {
    const ws = {
      id: "wks_manual_test",
      title: null,
      name: "test",
      projectDisplayName: "test",
    };

    // Step 1: Plugin names it first time
    const renamed1 = await service.processWorkspace(ws);
    assert.equal(renamed1, true);
    assert.equal(setTitleCalls.length, 1);
    assert.equal(setTitleCalls[0].title, "0913 | 功能 | 自动命名功能");

    // Step 2: User manually changes title in Paseo UI to "My Custom Name"
    const userModifiedWs = {
      ...ws,
      title: "My Custom Name",
    };

    const renamed2 = await service.processWorkspace(userModifiedWs);
    assert.equal(renamed2, false);
    assert.equal(setTitleCalls.length, 1); // No new setTitle call!
    assert.equal(store.get("wks_manual_test")?.status, "manual");
  } finally {
    cleanup();
  }
});

test("Sub-agent protection: sub-agent task does not override root agent task", async () => {
  const { service, setTitleCalls, cleanup } = createMockService({
    workspacesJson: [
      {
        workspaceId: "wks_subagent_test",
        createdAt: "2026-09-13T04:00:00.000Z",
      },
    ],
    agents: [
      {
        id: "ag_root",
        workspaceId: "wks_subagent_test",
        title: "开发新系统架构",
        createdAt: "2026-09-13T04:00:10.000Z",
      },
      {
        id: "ag_sub_1",
        workspaceId: "wks_subagent_test",
        parentAgentId: "ag_root",
        title: "子任务：运行单元测试",
        createdAt: "2026-09-13T04:05:00.000Z",
      },
      {
        id: "ag_sub_2",
        workspaceId: "wks_subagent_test",
        labels: { "paseo.parent-agent-id": "ag_root" },
        title: "审计代码规范",
        createdAt: "2026-09-13T04:06:00.000Z",
      },
    ],
  });

  try {
    const ws = {
      id: "wks_subagent_test",
      title: null,
      name: "proj",
      projectDisplayName: "proj",
    };

    const renamed = await service.processWorkspace(ws);
    assert.equal(renamed, true);
    assert.equal(setTitleCalls.length, 1);
    // Verified: It named based on root agent ("开发新系统架构"), NOT subagent ("运行单元测试")!
    assert.equal(setTitleCalls[0].title, "0913 | 功能 | 新系统架构");
  } finally {
    cleanup();
  }
});

test("Native auto-name race condition: replaces unformatted native title", async () => {
  const { service, setTitleCalls, cleanup } = createMockService({
    workspacesJson: [
      {
        workspaceId: "wks_race_test",
        createdAt: "2026-09-13T04:00:00.000Z",
      },
    ],
    agents: [
      {
        id: "ag_root",
        workspaceId: "wks_race_test",
        title: "修复网络连接超时异常",
        createdAt: "2026-09-13T04:00:10.000Z",
      },
    ],
  });

  try {
    // Native auto-name arrived and set a generic title: "Fix network timeout"
    const ws = {
      id: "wks_race_test",
      title: "Fix network timeout",
      name: "app",
      projectDisplayName: "app",
    };

    const renamed = await service.processWorkspace(ws);
    assert.equal(renamed, true);
    assert.equal(setTitleCalls.length, 1);
    assert.equal(setTitleCalls[0].title, "0913 | 修复 | 网络连接超时异常");
  } finally {
    cleanup();
  }
});

test("Concurrency: simultaneous processing of same workspace is serialized", async () => {
  const { service, setTitleCalls, cleanup } = createMockService({
    workspacesJson: [
      {
        workspaceId: "wks_concurrent",
        createdAt: "2026-09-13T04:00:00.000Z",
      },
    ],
    agents: [
      {
        id: "ag_root",
        workspaceId: "wks_concurrent",
        title: "优化数据库查询性能",
        createdAt: "2026-09-13T04:00:10.000Z",
      },
    ],
  });

  try {
    const ws = {
      id: "wks_concurrent",
      title: null,
      name: "db",
      projectDisplayName: "db",
    };

    // Fire 5 concurrent processWorkspace calls
    const results = await Promise.all([
      service.processWorkspace(ws),
      service.processWorkspace(ws),
      service.processWorkspace(ws),
      service.processWorkspace(ws),
      service.processWorkspace(ws),
    ]);

    // Exactly one call should perform the rename
    const successfulRenames = results.filter(Boolean);
    assert.equal(successfulRenames.length, 1);
    assert.equal(setTitleCalls.length, 1);
    assert.equal(setTitleCalls[0].title, "0913 | 优化 | 数据库查询性能");
  } finally {
    cleanup();
  }
});
