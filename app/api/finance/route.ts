import { NextRequest, NextResponse } from "next/server";
import { createAccount, createCostCenter, createCurrency, createTransaction, deleteAllData, deleteCostCenter, deleteCurrency, getFinanceData, linkTransactionsAsTransfer, savePreferences, updateAccount, updateCurrency, updateTransaction } from "@/lib/db";

function failure(error: unknown) {
  console.error(error);
  const message = error instanceof Error ? error.message : "Unknown database error";
  return NextResponse.json({ error: `Database unavailable: ${message}` }, { status: 503 });
}

export async function GET() {
  try { return NextResponse.json(await getFinanceData()); } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const { resource, data } = await request.json();
    if (resource === "account") await createAccount(data);
    else if (resource === "transaction") await createTransaction(data);
    else if (resource === "costCenter") await createCostCenter(data);
    else if (resource === "currency") await createCurrency(data);
    else return NextResponse.json({ error: "Unknown resource" }, { status: 400 });
    return NextResponse.json(await getFinanceData(), { status: 201 });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const { resource, id, data } = await request.json();
    if (resource === "account") await updateAccount(id, data);
    else if (resource === "transaction") await updateTransaction(id, data);
    else if (resource === "transactionTransferLink") await linkTransactionsAsTransfer(String(id ?? ""), String(data.counterpartTransactionId ?? ""));
    else if (resource === "currency") await updateCurrency(id, data);
    else if (resource === "preferences") await savePreferences(data);
    else return NextResponse.json({ error: "Unknown resource" }, { status: 400 });
    return NextResponse.json(await getFinanceData());
  } catch (error) { return failure(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const { resource, id } = await request.json();
    if (resource === "costCenter") await deleteCostCenter(id);
    else if (resource === "currency") await deleteCurrency(id);
    else if (resource === "all") await deleteAllData();
    else return NextResponse.json({ error: "Unknown resource" }, { status: 400 });
    return NextResponse.json(await getFinanceData());
  } catch (error) { return failure(error); }
}
