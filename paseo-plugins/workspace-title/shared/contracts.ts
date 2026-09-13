import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

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
