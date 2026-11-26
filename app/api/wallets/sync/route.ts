import { NextRequest, NextResponse } from "next/server";
import { apiFailure } from "@/lib/api-failure";
import { syncWorkspaceWallets } from "@/lib/btc/wallet-sync";
import { getFinanceData } from "@/lib/db";
import { requireRequestWorkspace } from "@/lib/workspace-request";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Syncs one wallet ({ accountId }) or all of them. Page loads are throttled server side; `force` skips that.
export async function POST(request: NextRequest) {
  try {
    const workspace = await requireRequestWorkspace(request);
    const body = await request.json().catch(() => ({})) as { accountId?: unknown; force?: unknown };
    const accountId = body.accountId == null ? undefined : String(body.accountId);
    if (accountId !== undefined && !uuid.test(accountId)) return NextResponse.json({ error: "Invalid transaction or account id." }, { status: 400 });
    const results = await syncWorkspaceWallets(workspace.id, { accountId, force: body.force === true });
    return NextResponse.json({ results, finance: await getFinanceData(workspace.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
