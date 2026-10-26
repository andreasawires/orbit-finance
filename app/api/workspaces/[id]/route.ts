import { NextRequest, NextResponse } from "next/server";
import { archiveWorkspace, permanentlyDeleteWorkspace, renameWorkspace, restoreWorkspace } from "@/lib/workspaces";

type Context = { params: Promise<{ id: string }> };

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Could not manage this workspace.";
  const status = /workspace not found/i.test(message) ? 404
    : /valid workspace id|between 1 and 120/i.test(message) ? 400
      : /last active|confirmation/i.test(message) ? 409 : 503;
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const workspace = body.action === "archive"
      ? await archiveWorkspace(id)
      : body.action === "restore"
        ? await restoreWorkspace(id)
        : await renameWorkspace(id, { name: body.name });
    return NextResponse.json({ workspace });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const workspace = await permanentlyDeleteWorkspace(id, String(body.confirmationName ?? ""));
    return NextResponse.json({ workspace });
  } catch (error) { return failure(error); }
}
