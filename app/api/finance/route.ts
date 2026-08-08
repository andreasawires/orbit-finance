import { NextRequest, NextResponse } from "next/server";
import { createAccount, createCostCenter, createCurrency, createTransaction, deleteAllData, deleteCostCenter, deleteCurrency, getFinanceData, linkTransactionsAsTransfer, savePreferences, updateAccount, updateCurrency, updateTransaction } from "@/lib/db";
import { requireRequestWorkspace, workspaceRequestFailure } from "@/lib/workspace-request";

function failure(error: unknown) {
  console.error(error);
  const message = error instanceof Error ? error.message : "Unknown database error";
  const workspace = workspaceRequestFailure(error);
  if (workspace.status !== 503) return NextResponse.json({ error: workspace.message }, { status: workspace.status });
  if (/not found/i.test(message)) return NextResponse.json({ error: message }, { status: 404 });
  return NextResponse.json({ error: `Database unavailable: ${message}` }, { status: 503 });
}

export async function GET(request: NextRequest) {
  try {
    const workspace = await requireRequestWorkspace(request);
    return NextResponse.json(await getFinanceData(workspace.id));
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const workspace = await requireRequestWorkspace(request);
    const { resource, data } = await request.json();
    if (resource === "account") await createAccount(workspace.id, data);
    else if (resource === "transaction") await createTransaction(workspace.id, data);
    else if (resource === "costCenter") await createCostCenter(workspace.id, data);
    else if (resource === "currency") await createCurrency(workspace.id, data);
    else return NextResponse.json({ error: "Unknown resource" }, { status: 400 });
    return NextResponse.json(await getFinanceData(workspace.id), { status: 201 });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const workspace = await requireRequestWorkspace(request);
    const { resource, id, data } = await request.json();
    if (resource === "account") await updateAccount(workspace.id, id, data);
    else if (resource === "transaction") await updateTransaction(workspace.id, id, data);
    else if (resource === "transactionTransferLink") await linkTransactionsAsTransfer(workspace.id, String(id ?? ""), String(data.counterpartTransactionId ?? ""));
    else if (resource === "currency") await updateCurrency(workspace.id, id, data);
    else if (resource === "preferences") await savePreferences(workspace.id, data);
    else return NextResponse.json({ error: "Unknown resource" }, { status: 400 });
    return NextResponse.json(await getFinanceData(workspace.id));
  } catch (error) { return failure(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const workspace = await requireRequestWorkspace(request);
    const { resource, id } = await request.json();
    if (resource === "costCenter") await deleteCostCenter(workspace.id, id);
    else if (resource === "currency") await deleteCurrency(workspace.id, id);
    else if (resource === "all") await deleteAllData(workspace.id);
    else return NextResponse.json({ error: "Unknown resource" }, { status: 400 });
    return NextResponse.json(await getFinanceData(workspace.id));
  } catch (error) { return failure(error); }
}
