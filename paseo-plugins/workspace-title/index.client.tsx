import type { PluginClientContext } from "@getpaseo/plugin/client";
import { WorkspaceTitleOverview } from "./client/main";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "workspace-title-overview",
    title: "工作区标题规范",
    icon: "Tag",
    context: "workspace",
    locations: ["workspace"],
    Component: WorkspaceTitleOverview,
  });

  client.addCommandCenterItem({
    id: "open-workspace-title-overview",
    title: "查看工作区标题规范监控",
    icon: "Tag",
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("workspace-title-overview");
    },
  });

  return () => {};
}
