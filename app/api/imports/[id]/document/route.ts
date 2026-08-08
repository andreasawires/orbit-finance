import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getImportWork } from "@/lib/imports/repository";
import { streamStoredFile } from "@/lib/imports/storage";
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
    const work = await getImportWork(workspace.id, id);
    if (!work) return NextResponse.json({ error: "Import batch not found." }, { status: 404 });

    const fallbackName = work.document.originalFilename.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "source-document";
    const stream = streamStoredFile(work.document.storageKey);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": work.document.mediaType,
        "Content-Length": work.document.sizeBytes,
        "Content-Disposition": `inline; filename="${fallbackName.replaceAll('"', "_")}"; filename*=UTF-8''${encodeURIComponent(work.document.originalFilename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Could not stream import source", error);
    const workspace = workspaceRequestFailure(error);
    const code = (error as NodeJS.ErrnoException)?.code;
    return NextResponse.json({ error: code === "ENOENT" ? "Source document is missing." : "Could not load source document." }, {
      status: workspace.status !== 503 ? workspace.status : code === "ENOENT" ? 404 : 503,
    });
  }
}
