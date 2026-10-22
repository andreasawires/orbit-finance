import { NextRequest, NextResponse } from "next/server";
import { apiFailure } from "@/lib/api-failure";
import { getReport } from "@/lib/finance-queries";
import { parseReportQuery } from "@/lib/transaction-query";
import { requireRequestWorkspace } from "@/lib/workspace-request";

export async function GET(request: NextRequest) {
  try {
    const workspace = await requireRequestWorkspace(request);
    const { range, granularity } = parseReportQuery(request.nextUrl.searchParams);
    return NextResponse.json(await getReport(workspace.id, range, granularity));
  } catch (error) { return apiFailure(error); }
}
