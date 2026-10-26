import { NextRequest, NextResponse } from "next/server";
import { apiFailure } from "@/lib/api-failure";
import { getWorkspaceExport } from "@/lib/finance-queries";
import { requireRequestWorkspace } from "@/lib/workspace-request";

export async function GET(request: NextRequest) {
  try {
    const workspace = await requireRequestWorkspace(request);
    return NextResponse.json(await getWorkspaceExport(workspace.id));
  } catch (error) { return apiFailure(error); }
}
