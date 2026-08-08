import "server-only";

import { requireActiveWorkspace } from "@/lib/workspaces";

export const WORKSPACE_HEADER = "x-orbit-workspace-id";

export async function requireRequestWorkspace(request: Request) {
  const workspaceId = request.headers.get(WORKSPACE_HEADER)?.trim() ?? "";
  if (!workspaceId) throw new Error("A workspace id is required.");
  return requireActiveWorkspace(workspaceId);
}

export function workspaceRequestFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "Workspace unavailable.";
  if (/workspace id is required|valid workspace id/i.test(message)) return { message, status: 400 };
  if (/workspace not found/i.test(message)) return { message, status: 404 };
  return { message, status: 503 };
}
