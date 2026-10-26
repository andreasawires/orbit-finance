import { NextRequest, NextResponse } from "next/server";
import { apiFailure } from "@/lib/api-failure";
import { listTransactions } from "@/lib/finance-queries";
import { parseTransactionQuery } from "@/lib/transaction-query";
import { requireRequestWorkspace } from "@/lib/workspace-request";

export async function GET(request: NextRequest) {
  try {
    const workspace = await requireRequestWorkspace(request);
    return NextResponse.json(await listTransactions(workspace.id, parseTransactionQuery(request.nextUrl.searchParams)));
  } catch (error) { return apiFailure(error); }
}
