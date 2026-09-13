import type { PluginContext } from "@getpaseo/plugin";
import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";
import { WorkspaceTitleOverview } from "./main.client";

export const getWorkspaceTitleStatusRpc = defineRpc({
  name: "get-workspace-title-status",
  input: z.object({
    workspaceId: z.string(),
  }),
  output: z.object({
    workspaceId: z.string(),
    title: z.string().nullable(),
    isCompliant: z.boolean(),
    status: z.string(),
  }),
});

export const recheckWorkspaceTitleRpc = defineRpc({
  name: "recheck-workspace-title",
  input: z.object({
    workspaceId: z.string(),
  }),
  output: z.object({
    success: z.boolean(),
    title: z.string().nullable(),
  }),
});

let serviceInstance: any = null;

export default function contribute(plugin: PluginContext) {
  // Client UI contributions
  plugin.addWorkspacePanel({
    id: "workspace-title-overview",
    title: "工作区标题规范",
    icon: "Tag",
    context: "workspace",
    locations: ["workspace"],
    Component: WorkspaceTitleOverview,
  });

  plugin.addCommandCenterItem({
    id: "open-workspace-title-overview",
    title: "查看工作区标题规范监控",
    icon: "Tag",
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("workspace-title-overview");
    },
  });

  // Server background service initialization
  if (typeof process !== "undefined" && process.versions?.node) {
    try {
      const { WorkspaceTitleService } = require("./src/service");
      if (!serviceInstance) {
        serviceInstance = new WorkspaceTitleService();
        void serviceInstance.start().catch((err: any) => {
          console.error("[workspace-title] Failed to start service:", err);
        });
      }
    } catch (err) {
      console.error("[workspace-title] Failed to initialize service:", err);
    }
  }

  plugin.handle(getWorkspaceTitleStatusRpc, async ({ workspaceId }, { paseo }) => {
    const handle = paseo.workspaces.ref(workspaceId);
    const ws = await handle.refresh();
    const title = ws?.title ?? ws?.name ?? null;
    const { isFormattedTitle } = require("./src/formatter");
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

  plugin.handle(recheckWorkspaceTitleRpc, async ({ workspaceId }, { paseo }) => {
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
    setTimeout(() => {
      process.exit(0);
    }, 150).unref();
  };
}
