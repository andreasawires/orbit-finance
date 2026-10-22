import { NextResponse } from "next/server";
import { CANCELLABLE_IMPORT_BATCH_STATUSES, getImportBatch, updateImportBatchStatus } from "@/lib/imports/repository";
import { requireRequestWorkspace, workspaceRequestFailure } from "@/lib/workspace-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: Context) {
  try {
    const workspace = await requireRequestWorkspace(request);
    const { id } = await context.params;
    if (!uuid.test(id)) return NextResponse.json({ error: "Invalid import batch id." }, { status: 400 });
    const batch = await getImportBatch(workspace.id, id);
    if (!batch) return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
    if (!CANCELLABLE_IMPORT_BATCH_STATUSES.includes(batch.status)) {
      return NextResponse.json({ error: `Import batch cannot be stopped while it is ${batch.status}.` }, { status: 409 });
    }
    // The worker notices the status change and aborts its in-flight work within a few seconds.
    const cancelled = await updateImportBatchStatus(workspace.id, batch.id, "cancelled", {
      actorType: "user",
      actorId: "local-user",
      details: { reason: "manual-cancel" },
    });
    return NextResponse.json({ batch: cancelled });
  } catch (error) {
    console.error("Could not cancel import batch", error);
    const message = error instanceof Error ? error.message : "Could not cancel import batch.";
    const workspace = workspaceRequestFailure(error);
    const status = workspace.status !== 503 ? workspace.status : /not found/i.test(message) ? 404 : /cannot/i.test(message) ? 409 : 503;
    return NextResponse.json({ error: workspace.status === 503 ? message : workspace.message }, { status });
  }
}
