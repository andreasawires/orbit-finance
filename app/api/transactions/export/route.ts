import { NextRequest } from "next/server";
import { apiFailure } from "@/lib/api-failure";
import { exportTransactionsCsv } from "@/lib/finance-queries";
import { parseTransactionFilters, parseTransactionSort } from "@/lib/transaction-query";
import { requireRequestWorkspace } from "@/lib/workspace-request";

export async function GET(request: NextRequest) {
  try {
    const workspace = await requireRequestWorkspace(request);
    const params = request.nextUrl.searchParams;
    const { sort, dir } = parseTransactionSort(params);
    const csv = await exportTransactionsCsv(workspace.id, parseTransactionFilters(params), sort, dir);
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="orbit-transactions.csv"' } });
  } catch (error) { return apiFailure(error); }
}
