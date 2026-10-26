import "server-only";
import type { PoolClient } from "pg";
import { lockedAccountCurrency } from "@/lib/account-currency";
import { groupCurrencyAmounts, type CurrencyAmount } from "@/lib/currency-summary";
import type { Account, CostCenter, Currency, FinanceData, Preferences, Transaction, Workspace } from "@/lib/data";
import { db } from "@/lib/database";
import { IMPORT_STORAGE_ADVISORY_LOCK } from "@/lib/imports/locks";
import { deleteStoredFile } from "@/lib/imports/storage";
import { isValidTimeZone, requireUtcInstant } from "@/lib/time";
import { transferReceivedAmount } from "@/lib/transfer";

const globalForDb = globalThis as unknown as { orbitSchema?: Promise<void> };

type Row = Record<string, unknown>;

export async function ensureDatabaseSchema() {
  globalForDb.orbitSchema ??= (async () => {
    const result = await db.query<{ accounts: string | null; migrations: string | null; workspaces: string | null }>(
      "SELECT to_regclass('public.accounts')::text AS accounts, to_regclass('public.schema_migrations')::text AS migrations, to_regclass('public.workspaces')::text AS workspaces",
    );
    if (!result.rows[0]?.accounts || !result.rows[0]?.migrations || !result.rows[0]?.workspaces) {
      throw new Error("Database schema is not migrated. Run `npm run db:migrate` first.");
    }
  })();
  await globalForDb.orbitSchema;
}

function currencyInput(input: Record<string, unknown>) {
  const code = String(input.code ?? "").trim().toUpperCase();
  const name = String(input.name ?? "").trim();
  const symbol = String(input.symbol ?? "").trim();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("Currency code must be a three-letter ISO code.");
  if (!name) throw new Error("Currency name is required.");
  if (symbol.length > 8) throw new Error("Currency symbol must be eight characters or fewer.");
  return { code, name, symbol };
}

const accountFromRow = (row: Row): Account => ({
  id: String(row.id),
  name: String(row.name),
  institution: String(row.institution ?? ""),
  number: row.last_four ? `•••• ${row.last_four}` : "",
  openingBalance: Number(row.opening_balance),
  balance: Number(row.balance),
  currency: String(row.currency),
  color: String(row.color),
  kind: String(row.kind),
  transactionCount: Number(row.transaction_count ?? 0),
  transferCount: Number(row.transfer_count ?? 0),
});

const isoInstant = (value: unknown) => (value instanceof Date ? value : new Date(String(value))).toISOString();

export const transactionFromRow = (row: Row): Transaction => {
  const merchant = String(row.description);
  const isTransfer = row.type === "Transfer";
  return {
    id: String(row.id),
    occurredAt: isoInstant(row.occurred_at),
    merchant, detail: String(row.note ?? ""),
    // Transfers never carry a cost center, so they aren't "Uncategorized" either.
    costCenter: isTransfer ? "" : String(row.cost_center ?? "Uncategorized"),
    costCenterId: row.cost_center_id ? String(row.cost_center_id) : null,
    account: String(row.account_name), accountId: String(row.account_id),
    transferId: row.transfer_id ? String(row.transfer_id) : null,
    transferAccountId: row.transfer_account_id ? String(row.transfer_account_id) : null,
    transferAccount: row.transfer_account_name ? String(row.transfer_account_name) : null,
    transferMerchant: row.transfer_description != null ? String(row.transfer_description) : null,
    transferOccurredAt: row.transfer_occurred_at ? isoInstant(row.transfer_occurred_at) : null,
    transferAmount: row.transfer_amount != null ? Number(row.transfer_amount) : null,
    transferCurrency: row.transfer_currency ? String(row.transfer_currency) : null,
    amount: Number(row.amount), currency: String(row.transaction_currency), type: row.type as Transaction["type"],
    icon: merchant.trim().charAt(0).toUpperCase() || "$",
  };
};

// `spendRows` carry each center's own expenses per currency (cost_center_id, currency, amount); every node's
// `spend` is rolled up to include its descendants.
export function buildTree(rows: Row[], spendRows: Row[] = [], mainCurrency = "USD"): CostCenter[] {
  const nodes = new Map<string, CostCenter>();
  for (const row of rows) nodes.set(String(row.id), {
    id: String(row.id), name: String(row.name), parentId: row.parent_id ? String(row.parent_id) : null,
    color: String(row.color), spend: [], children: [],
  });
  const direct = new Map<string, CurrencyAmount[]>();
  for (const row of spendRows) {
    const id = String(row.cost_center_id);
    direct.set(id, [...(direct.get(id) ?? []), { currency: String(row.currency), amount: Number(row.amount) }]);
  }
  const roots: CostCenter[] = [];
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) nodes.get(node.parentId)!.children.push(node);
    else roots.push(node);
  }
  const rollup = (node: CostCenter): CurrencyAmount[] => {
    node.spend = groupCurrencyAmounts([...(direct.get(node.id) ?? []), ...node.children.flatMap(rollup)], mainCurrency);
    return node.spend;
  };
  roots.forEach(rollup);
  return roots;
}

const currencyFromRow = (row: Row): Currency => ({
  code: String(row.code), name: String(row.name), symbol: String(row.symbol ?? ""),
});

const workspaceFromRow = (row: Row): Workspace => ({
  id: String(row.id), name: String(row.name),
  archivedAt: row.archived_at ? (row.archived_at instanceof Date ? row.archived_at.toISOString() : String(row.archived_at)) : null,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
});

export async function getFinanceData(workspaceId: string): Promise<FinanceData> {
  await ensureDatabaseSchema();
  // Transactions are not part of this payload: pages load them filtered and paginated from /api/transactions.
  const [workspaceResult, accountsResult, centersResult, spendResult, currenciesResult, preferencesResult] = await Promise.all([
    db.query("SELECT * FROM workspaces WHERE id = $1 AND archived_at IS NULL", [workspaceId]),
    db.query(`SELECT a.*, a.opening_balance + COALESCE(transaction_totals.amount, 0) AS balance,
        COALESCE(transaction_totals.transaction_count, 0) AS transaction_count, COALESCE(transaction_totals.transfer_count, 0) AS transfer_count
      FROM accounts a
      LEFT JOIN (
        SELECT account_id, SUM(amount) AS amount, COUNT(*)::int AS transaction_count, COUNT(transfer_id)::int AS transfer_count
        FROM transactions WHERE workspace_id = $1 GROUP BY account_id
      ) AS transaction_totals ON transaction_totals.account_id = a.id
      WHERE a.workspace_id = $1 ORDER BY a.created_at, a.name`, [workspaceId]),
    db.query("SELECT * FROM cost_centers WHERE workspace_id = $1 ORDER BY created_at, name", [workspaceId]),
    db.query(`SELECT t.cost_center_id, a.currency, SUM(ABS(t.amount)) AS amount
      FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.workspace_id = t.workspace_id
      WHERE t.workspace_id = $1 AND t.type = 'Expense' AND t.cost_center_id IS NOT NULL
      GROUP BY t.cost_center_id, a.currency`, [workspaceId]),
    db.query("SELECT code, name, symbol FROM currencies WHERE workspace_id = $1 ORDER BY code", [workspaceId]),
    db.query("SELECT currency, timezone, locale, price_format FROM workspace_preferences WHERE workspace_id = $1", [workspaceId]),
  ]);
  if (!workspaceResult.rowCount) throw new Error("Workspace not found.");
  const pref = preferencesResult.rows[0] ?? {};
  return {
    workspace: workspaceFromRow(workspaceResult.rows[0]),
    accounts: accountsResult.rows.map(accountFromRow),
    costCenters: buildTree(centersResult.rows, spendResult.rows, String(pref.currency ?? "USD")),
    currencies: currenciesResult.rows.map(currencyFromRow),
    preferences: {
      currency: String(pref.currency ?? "USD"), timezone: String(pref.timezone ?? "UTC"),
      locale: String(pref.locale ?? "en-US"), priceFormat: String(pref.price_format ?? "symbol"),
    },
  };
}

export async function createCurrency(workspaceId: string, input: Record<string, unknown>) {
  await ensureDatabaseSchema();
  const currency = currencyInput(input);
  await db.query("INSERT INTO currencies (workspace_id, code, name, symbol) VALUES ($1, $2, $3, $4)", [workspaceId, currency.code, currency.name, currency.symbol]);
}

export async function updateCurrency(workspaceId: string, previousCode: string, input: Record<string, unknown>) {
  await ensureDatabaseSchema();
  const currency = currencyInput(input);
  if (currency.code !== previousCode) throw new Error("Currency ISO codes are locked after creation.");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query("UPDATE currencies SET code=$1, name=$2, symbol=$3 WHERE workspace_id=$4 AND code=$5", [currency.code, currency.name, currency.symbol, workspaceId, previousCode]);
    if (!updated.rowCount) throw new Error("Currency not found.");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function deleteCurrency(workspaceId: string, code: string) {
  await ensureDatabaseSchema();
  const [preferencesResult, accountsResult] = await Promise.all([
    db.query("SELECT currency FROM workspace_preferences WHERE workspace_id=$1", [workspaceId]),
    db.query("SELECT count(*)::int AS count FROM accounts WHERE workspace_id=$1 AND currency=$2", [workspaceId, code]),
  ]);
  if (preferencesResult.rows[0]?.currency === code) throw new Error("Choose another main currency before deleting this one.");
  if (Number(accountsResult.rows[0]?.count) > 0) throw new Error("Move or update accounts using this currency before deleting it.");
  await db.query("DELETE FROM currencies WHERE workspace_id=$1 AND code=$2", [workspaceId, code]);
}

export async function createAccount(workspaceId: string, input: Record<string, unknown>) {
  await ensureDatabaseSchema();
  await db.query(`INSERT INTO accounts (workspace_id, name, institution, last_four, opening_balance, currency, color, kind)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [workspaceId, input.name, input.institution ?? "", "", Number(input.startingBalance ?? 0), input.currency ?? "USD", input.color ?? "#573cf0", input.kind ?? "Checking"]);
}

export async function updateAccount(workspaceId: string, id: string, input: Record<string, unknown>) {
  await ensureDatabaseSchema();
  const existing = await db.query<{ currency: string }>("SELECT currency FROM accounts WHERE workspace_id=$1 AND id=$2", [workspaceId, id]);
  if (!existing.rowCount) throw new Error("Account not found.");
  const accountCurrency = lockedAccountCurrency(existing.rows[0].currency, input.currency);
  await db.query(`UPDATE accounts SET name=$1, institution=$2, opening_balance=$3, currency=$4, color=$5, kind=$6, updated_at=now() WHERE workspace_id=$7 AND id=$8`,
    [input.name, input.institution ?? "", Number(input.openingBalance ?? 0), accountCurrency, input.color ?? "#573cf0", input.kind ?? "Checking", workspaceId, id]);
}

// Writes both legs of a transfer: `sent` leaves the source account and the received amount arrives on the destination,
// each in its own account's currency. The exchange rate is never stored; it is received / sent.
async function insertTransferLegs(client: PoolClient, workspaceId: string, transferId: string, input: Record<string, unknown>, occurredAt: string, sent: number) {
  const sourceAccountId = String(input.accountId ?? "");
  const destinationAccountId = String(input.transferAccountId ?? "");
  if (!sourceAccountId || !destinationAccountId) throw new Error("Choose both the source and destination accounts.");
  if (sourceAccountId === destinationAccountId) throw new Error("A transfer must use two different accounts.");
  const accounts = await client.query<{ id: string; currency: string }>("SELECT id, currency FROM accounts WHERE workspace_id=$1 AND id = ANY($2::uuid[])", [workspaceId, [sourceAccountId, destinationAccountId]]);
  if (accounts.rowCount !== 2) throw new Error("Choose both the source and destination accounts.");
  const currencyOf = (id: string) => accounts.rows.find((account) => account.id === id)!.currency;
  const destinationCurrency = currencyOf(destinationAccountId);
  const received = transferReceivedAmount(sent, { currency: destinationCurrency, sameCurrency: currencyOf(sourceAccountId) === destinationCurrency }, input.transferAmount);
  await client.query(`INSERT INTO transactions (workspace_id, occurred_at, description, note, account_id, amount, type, transfer_id, transfer_account_id)
    VALUES ($1, $2, $3, $4, $5, -$6::numeric, 'Transfer', $7, $8)`, [workspaceId, occurredAt, input.description, input.note ?? "", sourceAccountId, sent, transferId, destinationAccountId]);
  await client.query(`INSERT INTO transactions (workspace_id, occurred_at, description, note, account_id, amount, type, transfer_id, transfer_account_id)
    VALUES ($1, $2, $3, $4, $5, $6, 'Transfer', $7, $8)`, [workspaceId, occurredAt, input.description, input.note ?? "", destinationAccountId, received, transferId, sourceAccountId]);
}

// Inserts one transaction (or both sides of a transfer) on a client that is already inside a transaction.
async function insertTransaction(client: PoolClient, workspaceId: string, input: Record<string, unknown>) {
  const type = String(input.type) as Transaction["type"];
  const rawAmount = Math.abs(Number(input.amount));
  if (!Number.isFinite(rawAmount) || rawAmount === 0) throw new Error("Transaction amount must be greater than zero.");
  const occurredAt = requireUtcInstant(input.occurredAt, "Transaction date");
  if (type === "Transfer") {
    const transferId = (await client.query("SELECT gen_random_uuid() AS id")).rows[0].id;
    await insertTransferLegs(client, workspaceId, transferId, input, occurredAt, rawAmount);
    return;
  }
  const amount = type === "Expense" ? -rawAmount : rawAmount;
  await client.query(`INSERT INTO transactions (workspace_id, occurred_at, description, note, account_id, cost_center_id, amount, type)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [workspaceId, occurredAt, input.description, input.note ?? "", input.accountId, input.costCenterId || null, amount, type]);
}

export async function createTransaction(workspaceId: string, input: Record<string, unknown>) {
  await createTransactions(workspaceId, [input], false);
}

// Saves every item or none, so a failed line can be fixed and resubmitted without duplicating the others.
export async function createTransactions(workspaceId: string, items: Record<string, unknown>[], numbered = true) {
  await ensureDatabaseSchema();
  if (!items.length) throw new Error("Add at least one transaction.");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const [index, input] of items.entries()) {
      try { await insertTransaction(client, workspaceId, input); }
      catch (error) { throw numbered && error instanceof Error ? new Error(`Transaction ${index + 1}: ${error.message}`) : error; }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function updateTransaction(workspaceId: string, id: string, input: Record<string, unknown>) {
  await ensureDatabaseSchema();
  const type = String(input.type) as Transaction["type"];
  const rawAmount = Math.abs(Number(input.amount));
  if (!Number.isFinite(rawAmount) || rawAmount === 0) throw new Error("Transaction amount must be greater than zero.");
  const occurredAt = requireUtcInstant(input.occurredAt, "Transaction date");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT transfer_id FROM transactions WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [workspaceId, id]);
    if (!existing.rowCount) throw new Error("Transaction not found.");
    const existingTransferId = existing.rows[0].transfer_id as string | null;
    if (type === "Transfer") {
      const transferId = existingTransferId ?? (await client.query("SELECT gen_random_uuid() AS id")).rows[0].id;
      if (existingTransferId) await client.query("DELETE FROM transactions WHERE workspace_id=$1 AND transfer_id=$2", [workspaceId, transferId]);
      await insertTransferLegs(client, workspaceId, transferId, input, occurredAt, rawAmount);
    } else {
      if (existingTransferId) await client.query("DELETE FROM transactions WHERE workspace_id=$1 AND transfer_id=$2 AND id <> $3", [workspaceId, existingTransferId, id]);
      const amount = type === "Expense" ? -rawAmount : rawAmount;
      await client.query(`UPDATE transactions SET occurred_at=$1, description=$2, note=$3, account_id=$4, cost_center_id=$5, amount=$6, type=$7, transfer_id=NULL, transfer_account_id=NULL, updated_at=now() WHERE workspace_id=$8 AND id=$9`,
        [occurredAt, input.description, input.note ?? "", input.accountId, input.costCenterId || null, amount, type, workspaceId, id]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function assignCostCenter(workspaceId: string, ids: string[], costCenterId: string | null) {
  await ensureDatabaseSchema();
  if (!ids.length) throw new Error("Choose at least one transaction.");
  if (costCenterId && !(await db.query("SELECT 1 FROM cost_centers WHERE workspace_id=$1 AND id=$2", [workspaceId, costCenterId])).rowCount) throw new Error("Cost center not found.");
  // Transfers never carry a cost center, matching linkTransactionsAsTransfer.
  await db.query("UPDATE transactions SET cost_center_id=$1, updated_at=now() WHERE workspace_id=$2 AND id = ANY($3::uuid[]) AND type <> 'Transfer'", [costCenterId, workspaceId, ids]);
}

export async function linkTransactionsAsTransfer(workspaceId: string, transactionId: string, counterpartTransactionId: string) {
  await ensureDatabaseSchema();
  if (!transactionId || !counterpartTransactionId || transactionId === counterpartTransactionId) throw new Error("Choose a different transaction to link.");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const rows = await client.query(`SELECT t.id, t.account_id, t.amount, t.type, t.transfer_id, a.currency
      FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.workspace_id = t.workspace_id
      WHERE t.workspace_id = $1 AND t.id = ANY($2::uuid[]) FOR UPDATE OF t`, [workspaceId, [transactionId, counterpartTransactionId]]);
    if (rows.rowCount !== 2) throw new Error("One of the transactions could not be found.");
    const [first, second] = rows.rows;
    if (first.type === "Transfer" || second.type === "Transfer" || first.transfer_id || second.transfer_id) throw new Error("Only unlinked income and expense transactions can be linked.");
    if (first.account_id === second.account_id) throw new Error("Transfers must link two different accounts.");
    const firstAmount = Number(first.amount);
    const secondAmount = Number(second.amount);
    if (Math.sign(firstAmount) === Math.sign(secondAmount)) throw new Error("Transfers need one outgoing and one incoming transaction.");
    // Across currencies each side keeps what its own statement shows; the rate is whatever they imply.
    if (first.currency === second.currency && Math.abs(firstAmount) !== Math.abs(secondAmount)) throw new Error("Same-currency transfers need equal amounts in opposite directions.");
    const transferId = (await client.query("SELECT gen_random_uuid() AS id")).rows[0].id;
    await client.query(`UPDATE transactions SET type='Transfer', transfer_id=$1,
      transfer_account_id=CASE WHEN id=$2 THEN $3::uuid ELSE $4::uuid END,
      cost_center_id=NULL, updated_at=now()
      WHERE workspace_id = $5 AND id = ANY($6::uuid[])`, [transferId, first.id, second.account_id, first.account_id, workspaceId, [first.id, second.id]]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function createCostCenter(workspaceId: string, input: Record<string, unknown>) {
  await ensureDatabaseSchema();
  await db.query("INSERT INTO cost_centers (workspace_id, name, parent_id, color) VALUES ($1, $2, $3, $4)", [workspaceId, input.name, input.parentId || null, input.color ?? "#573cf0"]);
}

export async function deleteCostCenter(workspaceId: string, id: string) { await ensureDatabaseSchema(); await db.query("DELETE FROM cost_centers WHERE workspace_id=$1 AND id=$2", [workspaceId, id]); }

export async function savePreferences(workspaceId: string, input: Preferences) {
  await ensureDatabaseSchema();
  if (!isValidTimeZone(input.timezone)) throw new Error("Choose a valid timezone.");
  await db.query(`INSERT INTO workspace_preferences (workspace_id, currency, timezone, locale, price_format) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (workspace_id) DO UPDATE SET currency=$2, timezone=$3, locale=$4, price_format=$5, updated_at=now()`,
    [workspaceId, input.currency, input.timezone, input.locale, input.priceFormat]);
}

export async function deleteAccount(workspaceId: string, id: string, confirmationName: unknown) {
  await ensureDatabaseSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [IMPORT_STORAGE_ADVISORY_LOCK]);
    const account = await client.query<{ name: string }>("SELECT name FROM accounts WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [workspaceId, id]);
    if (!account.rowCount) throw new Error("Account not found.");
    if (account.rows[0].name !== confirmationName) throw new Error("Account name confirmation does not match.");
    // Transfers touching this account lose both legs, including the one on the other account.
    await client.query("DELETE FROM transactions WHERE workspace_id=$1 AND (account_id=$2 OR transfer_account_id=$2)", [workspaceId, id]);
    const orphanedDocuments = await client.query<{ id: string; storage_key: string }>(`SELECT d.id, d.storage_key FROM import_documents d
      WHERE d.workspace_id=$1
        AND EXISTS (SELECT 1 FROM import_batches b WHERE b.workspace_id=d.workspace_id AND b.document_id=d.id AND b.account_id=$2)
        AND NOT EXISTS (SELECT 1 FROM import_batches b WHERE b.workspace_id=d.workspace_id AND b.document_id=d.id AND b.account_id<>$2)`, [workspaceId, id]);
    await client.query("DELETE FROM import_batches WHERE workspace_id=$1 AND account_id=$2", [workspaceId, id]);
    const documentIds = orphanedDocuments.rows.map((row) => row.id);
    if (documentIds.length) await client.query("DELETE FROM import_documents WHERE workspace_id=$1 AND id = ANY($2::uuid[])", [workspaceId, documentIds]);
    for (const file of orphanedDocuments.rows) await deleteStoredFile(String(file.storage_key));
    await client.query("DELETE FROM accounts WHERE workspace_id=$1 AND id=$2", [workspaceId, id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteTransaction(workspaceId: string, id: string, confirmationDescription: unknown) {
  await ensureDatabaseSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ description: string; transfer_id: string | null }>("SELECT description, transfer_id FROM transactions WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [workspaceId, id]);
    if (!existing.rowCount) throw new Error("Transaction not found.");
    const { description, transfer_id: transferId } = existing.rows[0];
    if (description.trim() !== String(confirmationDescription ?? "").trim()) throw new Error("Transaction description confirmation does not match.");
    if (transferId) await client.query("DELETE FROM transactions WHERE workspace_id=$1 AND transfer_id=$2", [workspaceId, transferId]);
    else await client.query("DELETE FROM transactions WHERE workspace_id=$1 AND id=$2", [workspaceId, id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteAllData(workspaceId: string) {
  await ensureDatabaseSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [IMPORT_STORAGE_ADVISORY_LOCK]);
    const files = await client.query<{ storage_key: string }>("SELECT storage_key FROM import_documents WHERE workspace_id=$1", [workspaceId]);
    for (const file of files.rows) await deleteStoredFile(String(file.storage_key));
    await client.query("DELETE FROM transactions WHERE workspace_id=$1", [workspaceId]);
    await client.query("DELETE FROM import_documents WHERE workspace_id=$1", [workspaceId]);
    await client.query("DELETE FROM cost_centers WHERE workspace_id=$1", [workspaceId]);
    await client.query("DELETE FROM accounts WHERE workspace_id=$1", [workspaceId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
