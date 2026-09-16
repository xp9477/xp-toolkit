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
  analyzeTask?: (input: any) => Promise<any>;
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
  const service = new WorkspaceTitleService(
    {
      enableLlmFallback: false,
      analyzeTask:
        options?.analyzeTask ||
        (async (input) => {
          const userText = input.firstTurn?.userInstruction || input.agentTitle || "";
          if (userText.includes("修复") || userText.includes("解决")) {
            const topic = userText.replace(/^(?:修复|解决)\s*/, "").trim();
            return { type: "修复", topic };
          }
          if (userText.includes("优化")) {
            const topic = userText.replace(/^优化\s*/, "").trim();
            return { type: "优化", topic };
          }
          if (userText.includes("新系统架构") || userText.includes("开发") || userText.includes("实现")) {
            let topic = userText.replace(/^(?:开发|实现)\s*/, "").trim();
            return { type: "功能", topic };
          }
          return { type: "功能", topic: userText.slice(0, 15) || "测试任务" };
        }),
    },
    store
  );
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
        refresh: async () => {
          const ws = options?.workspacesJson?.find((w) => w.workspaceId === id);
          return ws
            ? { id, title: ws.title || null, name: ws.name || "test", projectDisplayName: "test" }
            : { id, title: null, name: "test", projectDisplayName: "test" };
        },
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
      if (options?.timelineMap && options.timelineMap[agentId]) {
        return options.timelineMap[agentId];
      }
      const agent = (options?.agents || []).find((a) => a.id === agentId);
      if (agent) {
        return {
          entries: [
            {
              item: {
                type: "user_message",
                text: agent.title || "实现测试任务",
              },
            },
            {
              item: {
                type: "assistant_message",
                text: "好的，已完成首轮交互与执行。",
              },
            },
          ],
        };
      }
      return { entries: [] };
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

  return { service, store, setTitleCalls, cleanup, tmpDir, mockPaseo };
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

test("Premature naming prevention: does not rename when first turn is not finished", async () => {
  // Case A: Completely empty timeline
  const { service: serviceA, setTitleCalls: callsA, cleanup: cleanupA } = createMockService({
    workspacesJson: [
      {
        workspaceId: "wks_empty_timeline",
        createdAt: "2026-09-13T04:00:00.000Z",
      },
    ],
    agents: [
      {
        id: "ag_empty",
        workspaceId: "wks_empty_timeline",
        title: "新创建的代理",
        createdAt: "2026-09-13T04:00:01.000Z",
      },
    ],
    timelineMap: {
      ag_empty: { entries: [] },
    },
  });

  try {
    const wsA = {
      id: "wks_empty_timeline",
      title: null,
      name: "test",
    };
    const resA = await serviceA.processWorkspace(wsA);
    assert.equal(resA, false);
    assert.equal(callsA.length, 0);
  } finally {
    cleanupA();
  }

  // Case B: User prompt sent, but assistant has not replied or executed tools yet
  const { service: serviceB, setTitleCalls: callsB, cleanup: cleanupB } = createMockService({
    workspacesJson: [
      {
        workspaceId: "wks_in_progress",
        createdAt: "2026-09-13T04:00:00.000Z",
      },
    ],
    agents: [
      {
        id: "ag_in_progress",
        workspaceId: "wks_in_progress",
        title: "代理正在执行中",
        createdAt: "2026-09-13T04:00:01.000Z",
      },
    ],
    timelineMap: {
      ag_in_progress: {
        entries: [
          { item: { type: "user_message", text: "请帮我重构一下工作区命名" } },
        ],
      },
    },
  });

  try {
    const wsB = {
      id: "wks_in_progress",
      title: null,
      name: "test",
    };
    const resB = await serviceB.processWorkspace(wsB);
    assert.equal(resB, false);
    assert.equal(callsB.length, 0);
  } finally {
    cleanupB();
  }
});

test("agent.turn_ended hook: renames workspace after root agent first turn concludes", async () => {
  const { service, setTitleCalls, cleanup, mockPaseo } = createMockService({
    workspacesJson: [
      {
        workspaceId: "wks_turn_ended_test",
        createdAt: "2026-09-13T04:00:00.000Z",
      },
    ],
    agents: [
      {
        id: "ag_root_turn",
        workspaceId: "wks_turn_ended_test",
        title: "开发新系统架构",
        createdAt: "2026-09-13T04:00:01.000Z",
      },
    ],
  });

  try {
    const event = {
      agent: {
        id: "ag_root_turn",
        workspaceId: "wks_turn_ended_test",
        parentAgentId: null,
        title: "开发新系统架构",
      },
      turnId: "turn-0",
      outcome: { kind: "completed" },
      timeline: [
        { type: "user_message", text: "开发新系统架构" },
        { type: "tool_call", name: "shell", detail: { command: "mkdir src" } },
        { type: "assistant_message", text: "已创建 src 目录并完成系统架构设计。" },
      ],
    };

    const renamed = await service.processWorkspaceOnTurnEnded(event, mockPaseo);
    assert.equal(renamed, true);
    assert.equal(setTitleCalls.length, 1);
    assert.equal(setTitleCalls[0].title, "0913 | 功能 | 新系统架构");
  } finally {
    cleanup();
  }
});

test("Sub-agent turn_ended: ignored and does not rename workspace", async () => {
  const { service, setTitleCalls, cleanup, mockPaseo } = createMockService({
    workspacesJson: [
      {
        workspaceId: "wks_sub_ended_test",
        createdAt: "2026-09-13T04:00:00.000Z",
      },
    ],
    agents: [
      {
        id: "ag_root",
        workspaceId: "wks_sub_ended_test",
        title: "主任务：重构代码",
      },
    ],
  });

  try {
    const subEvent = {
      agent: {
        id: "ag_sub",
        workspaceId: "wks_sub_ended_test",
        parentAgentId: "ag_root",
        title: "子代理任务",
      },
      turnId: "turn-0",
      outcome: { kind: "completed" },
      timeline: [
        { type: "user_message", text: "子代理执行搜索" },
        { type: "assistant_message", text: "搜索完毕" },
      ],
    };

    const renamed = await service.processWorkspaceOnTurnEnded(subEvent, mockPaseo);
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
    analyzeTask: async () => ({ type: "功能", topic: "自动命名功能" }),
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
    analyzeTask: async (input) => {
      if (input.firstTurn?.userInstruction?.includes("新系统架构") || input.agentTitle?.includes("新系统架构")) {
        return { type: "功能", topic: "新系统架构" };
      }
      return { type: "功能", topic: "子代理任务" };
    },
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

test("Self-healing connection: recovers from disconnected transport status", async () => {
  const { service, cleanup } = createMockService();
  try {
    let connectCalled = false;
    (service as any).daemonClient = {
      getConnectionState: () => ({ status: "disconnected" }),
      close: async () => {},
    };
    (service as any).initDaemonConnection = async () => {
      connectCalled = true;
      (service as any).daemonClient = {
        getConnectionState: () => ({ status: "connected" }),
      };
      (service as any).paseo = {};
    };

    const isConnected = await (service as any).ensureConnection();
    assert.equal(isConnected, true);
    assert.equal(connectCalled, true);
  } finally {
    cleanup();
  }
});

test("Single-flight connection: does not reconnect if already connected", async () => {
  const { service, cleanup } = createMockService();
  try {
    let connectCount = 0;
    (service as any).daemonClient = {
      getConnectionState: () => ({ status: "connected" }),
      close: async () => {},
    };
    (service as any).initDaemonConnection = async () => {
      connectCount++;
    };

    const isConnected = await (service as any).ensureConnection();
    assert.equal(isConnected, true);
    assert.equal(connectCount, 0); // No reconnection performed
  } finally {
    cleanup();
  }
});

test("Single-flight connection: concurrent ensureConnection calls only connect once", async () => {
  const { service, cleanup } = createMockService();
  try {
    let connectCount = 0;
    (service as any).daemonClient = null;
    (service as any).initDaemonConnection = async () => {
      connectCount++;
      await new Promise((r) => setTimeout(r, 20));
      (service as any).daemonClient = {
        getConnectionState: () => ({ status: "connected" }),
      };
      (service as any).paseo = {};
    };

    const [c1, c2, c3] = await Promise.all([
      (service as any).ensureConnection(),
      (service as any).ensureConnection(),
      (service as any).ensureConnection(),
    ]);

    assert.equal(c1, true);
    assert.equal(c2, true);
    assert.equal(c3, true);
    assert.equal(connectCount, 1); // Only connected once despite 3 concurrent calls
  } finally {
    cleanup();
  }
});
