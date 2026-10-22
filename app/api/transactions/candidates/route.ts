import { NextRequest, NextResponse } from "next/server";
import { apiFailure } from "@/lib/api-failure";
import { transferCandidates } from "@/lib/finance-queries";
import { requireRequestWorkspace } from "@/lib/workspace-request";

export async function GET(request: NextRequest) {
  try {
    const workspace = await requireRequestWorkspace(request);
    const params = request.nextUrl.searchParams;
    return NextResponse.json(await transferCandidates(workspace.id, params.get("transactionId") ?? "", params.get("accountId") ?? ""));
  } catch (error) { return apiFailure(error); }
}
