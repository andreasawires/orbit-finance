import { NextRequest, NextResponse } from "next/server";
import { assignCostCenter, createAccount, createCostCenter, createCurrency, createTransaction, createTransactions, deleteAccount, deleteAllData, deleteCostCenter, deleteCurrency, deleteTransaction, getFinanceData, linkTransactionsAsTransfer, savePreferences, updateAccount, updateCurrency, updateTransaction } from "@/lib/db";
import { apiFailure } from "@/lib/api-failure";
import { requireRequestWorkspace } from "@/lib/workspace-request";

export async function GET(request: NextRequest) {
  try {
    const workspace = await requireRequestWorkspace(request);
    return NextResponse.json(await getFinanceData(workspace.id));
  } catch (error) { return apiFailure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const workspace = await requireRequestWorkspace(request);
    const { resource, data } = await request.json();
    if (resource === "account") await createAccount(workspace.id, data);
    else if (resource === "transaction") await createTransaction(workspace.id, data);
    else if (resource === "transactions") await createTransactions(workspace.id, Array.isArray(data?.items) ? data.items : []);
    else if (resource === "costCenter") await createCostCenter(workspace.id, data);
    else if (resource === "currency") await createCurrency(workspace.id, data);
    else return NextResponse.json({ error: "Unknown resource" }, { status: 400 });
    return NextResponse.json(await getFinanceData(workspace.id), { status: 201 });
  } catch (error) { return apiFailure(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const workspace = await requireRequestWorkspace(request);
    const { resource, id, data } = await request.json();
    if (resource === "account") await updateAccount(workspace.id, id, data);
    else if (resource === "transaction") await updateTransaction(workspace.id, id, data);
    else if (resource === "transactionCostCenter") await assignCostCenter(workspace.id, Array.isArray(data?.ids) ? data.ids.map(String) : [], data?.costCenterId ? String(data.costCenterId) : null);
    else if (resource === "transactionTransferLink") await linkTransactionsAsTransfer(workspace.id, String(id ?? ""), String(data.counterpartTransactionId ?? ""));
    else if (resource === "currency") await updateCurrency(workspace.id, id, data);
    else if (resource === "preferences") await savePreferences(workspace.id, data);
    else return NextResponse.json({ error: "Unknown resource" }, { status: 400 });
    return NextResponse.json(await getFinanceData(workspace.id));
  } catch (error) { return apiFailure(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const workspace = await requireRequestWorkspace(request);
    const { resource, id, data } = await request.json();
    if (resource === "account") await deleteAccount(workspace.id, String(id ?? ""), data?.confirmName);
    else if (resource === "transaction") await deleteTransaction(workspace.id, String(id ?? ""), data?.confirmName);
    else if (resource === "costCenter") await deleteCostCenter(workspace.id, id);
    else if (resource === "currency") await deleteCurrency(workspace.id, id);
    else if (resource === "all") await deleteAllData(workspace.id);
    else return NextResponse.json({ error: "Unknown resource" }, { status: 400 });
    return NextResponse.json(await getFinanceData(workspace.id));
  } catch (error) { return apiFailure(error); }
}
