import { NextResponse } from "next/server";
import { z } from "zod";
import { approveImportBatch } from "@/lib/imports/repository";
import { isValidTimeZone } from "@/lib/time";
import { requireRequestWorkspace, workspaceRequestFailure } from "@/lib/workspace-request";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const approveSchema = z.object({
  reviewRevision: z.string().regex(/^\d+$/),
  statementTimezone: z.string().refine(isValidTimeZone, "Choose a valid statement timezone.").optional(),
}).strict();

export async function POST(request: Request, context: Context) {
  try {
    const workspace = await requireRequestWorkspace(request);
    const { id } = await context.params;
    if (!uuid.test(id)) return NextResponse.json({ error: "Invalid import batch id." }, { status: 400 });
    const parsed = approveSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.some((issue) => issue.path[0] === "statementTimezone") ? "Choose a valid statement timezone." : "A valid review revision is required." }, { status: 400 });
    }
    const result = await approveImportBatch({
      workspaceId: workspace.id,
      batchId: id,
      reviewRevision: parsed.data.reviewRevision,
      statementTimezone: parsed.data.statementTimezone,
      approvedBy: "local-user",
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Could not approve import batch", error);
    const message = error instanceof Error ? error.message : "Could not approve import batch.";
    const workspace = workspaceRequestFailure(error);
    const status = workspace.status !== 503 ? workspace.status : /not found/i.test(message) ? 404
      : /cannot|must|missing|invalid|differs|timezone|duplicate|already|review changed|review every/i.test(message) ? 409 : 503;
    return NextResponse.json({ error: workspace.status === 503 ? message : workspace.message }, { status });
  }
}
