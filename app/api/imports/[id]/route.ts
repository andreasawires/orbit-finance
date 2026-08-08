import { NextResponse } from "next/server";
import { presentImportDetail } from "@/lib/imports/presentation";
import { getImportBatchDetail, listImportTransactionMappings } from "@/lib/imports/repository";
import { requireRequestWorkspace, workspaceRequestFailure } from "@/lib/workspace-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, context: Context) {
  try {
    const workspace = await requireRequestWorkspace(request);
    const { id } = await context.params;
    if (!uuid.test(id)) return NextResponse.json({ error: "Invalid import batch id." }, { status: 400 });
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "100");
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
      return NextResponse.json({ error: "Invalid pagination parameters." }, { status: 400 });
    }
    const detail = await getImportBatchDetail(workspace.id, id, { page, pageSize });
    if (!detail) return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
    const mappings = await listImportTransactionMappings(workspace.id, id, detail.items.map((item) => item.id));
    return NextResponse.json(presentImportDetail(detail, mappings));
  } catch (error) {
    console.error("Could not load import batch", error);
    const workspace = workspaceRequestFailure(error);
    const message = error instanceof Error ? error.message : "Could not load import batch.";
    return NextResponse.json({ error: workspace.status === 503 ? message : workspace.message }, { status: workspace.status });
  }
}
