import { NextResponse } from "next/server";
import { enqueueImport } from "@/lib/imports/queue";
import { getImportBatch, updateImportBatchStatus } from "@/lib/imports/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    if (!uuid.test(id)) return NextResponse.json({ error: "Invalid import batch id." }, { status: 400 });
    let batch = await getImportBatch(id);
    if (!batch) return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
    if (!["uploaded", "queued", "extracting", "converting", "validating", "failed"].includes(batch.status)) {
      return NextResponse.json({ error: `Import batch cannot be retried while it is ${batch.status}.` }, { status: 409 });
    }
    if (batch.status === "uploaded" || batch.status === "failed" || batch.status === "queued") {
      await enqueueImport(batch.id);
      const latest = await getImportBatch(batch.id);
      if (latest && (latest.status === "uploaded" || latest.status === "failed")) {
        batch = await updateImportBatchStatus(batch.id, "queued", {
          actorType: "user",
          actorId: "local-user",
          details: { reason: "manual-retry" },
        });
      } else if (latest) {
        batch = latest;
      }
    }
    return NextResponse.json({ batch }, { status: 202 });
  } catch (error) {
    console.error("Could not retry import batch", error);
    const message = error instanceof Error ? error.message : "Could not retry import batch.";
    const status = /not found/i.test(message) ? 404 : /cannot/i.test(message) ? 409 : 503;
    return NextResponse.json({ error: message }, { status });
  }
}
