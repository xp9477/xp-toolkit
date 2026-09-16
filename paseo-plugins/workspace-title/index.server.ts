import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  getWorkspaceTitleStatusRpc,
  recheckWorkspaceTitleRpc,
} from "./shared/contracts";
import { isFormattedTitle } from "./shared/formatter";
import { WorkspaceTitleService } from "./server/service";

let serviceInstance: WorkspaceTitleService | null = null;

export default function contribute(server: PluginServerContext) {
  if (!serviceInstance) {
    serviceInstance = new WorkspaceTitleService();
    void serviceInstance.start().catch((err: any) => {
      console.error("[workspace-title] Failed to start service:", err);
    });
  }

  // Register native Paseo 0.8 in-process lifecycle hooks (IPC, zero websocket drop risk)
  if (typeof server.on === "function") {
    // Only trigger when root agent's turn has ended and full first-turn context is available
    server.on("agent.turn_ended", (event, { paseo }) => {
      if (
        serviceInstance &&
        event?.agent?.workspaceId &&
        !event.agent.parentAgentId
      ) {
        serviceInstance
          .processWorkspaceOnTurnEnded(event, paseo)
          .catch((err) => {
            console.error(
              `[workspace-title] Hook error on agent.turn_ended (${event.agent.workspaceId}):`,
              err
            );
          });
      }
    });
  }

  // RPC for UI status
  server.handle(getWorkspaceTitleStatusRpc, async ({ workspaceId }, { paseo }) => {
    const handle = paseo.workspaces.ref(workspaceId);
    const ws = await handle.refresh();
    const title = ws?.title ?? ws?.name ?? null;
    const isCompliant = isFormattedTitle(title);
    const status =
      serviceInstance?.getStore()?.get(workspaceId)?.status ??
      (isCompliant ? "named" : "pending");
    return {
      workspaceId,
      title,
      isCompliant,
      status,
    };
  });

  // RPC for manual recheck trigger
  server.handle(recheckWorkspaceTitleRpc, async ({ workspaceId }, { paseo }) => {
    if (serviceInstance) {
      serviceInstance.getStore().resetWorkspace(workspaceId);
      await serviceInstance.processWorkspaceById(workspaceId, paseo);
    }
    const handle = paseo.workspaces.ref(workspaceId);
    const ws = await handle.refresh();
    return {
      success: true,
      title: ws?.title ?? null,
    };
  });

  return async () => {
    if (serviceInstance) {
      const s = serviceInstance;
      serviceInstance = null;
      await s.stop();
    }
  };
}
