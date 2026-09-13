import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getWorkspaceTitleStatusRpc, recheckWorkspaceTitleRpc } from "./shared/contracts";
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

  server.handle(recheckWorkspaceTitleRpc, async ({ workspaceId }, { paseo }) => {
    if (serviceInstance) {
      await serviceInstance.processWorkspaceById(workspaceId);
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
