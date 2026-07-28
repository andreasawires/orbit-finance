import "server-only";
import { Pool } from "pg";
import type { Account, CostCenter, Currency, FinanceData, Preferences, Transaction } from "@/lib/data";

const globalForDb = globalThis as unknown as { orbitPool?: Pool; orbitSchema?: Promise<void> };

export const db = globalForDb.orbitPool ?? new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://orbit:orbit@localhost:5433/orbit_finance",
  max: 10,
});

if (process.env.NODE_ENV !== "production") globalForDb.orbitPool = db;

type Row = Record<string, unknown>;

async function ensureDatabaseSchema() {
  globalForDb.orbitSchema ??= (async () => {
    // Accounts created before ledger balances existed stored a mutable
    // `balance`. Preserve that value as their opening balance once.
    await db.query("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS opening_balance numeric(16, 2)");
    await db.query("UPDATE accounts SET opening_balance = balance WHERE opening_balance IS NULL");
    await db.query("ALTER TABLE accounts ALTER COLUMN opening_balance SET DEFAULT 0");
    await db.query("ALTER TABLE accounts ALTER COLUMN opening_balance SET NOT NULL");
    await db.query("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_id uuid");
    await db.query("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_account_id uuid REFERENCES accounts(id) ON DELETE CASCADE");
    await db.query("CREATE INDEX IF NOT EXISTS transactions_transfer_id_idx ON transactions (transfer_id)");
    await db.query(`CREATE TABLE IF NOT EXISTS currencies (
      code varchar(3) PRIMARY KEY CHECK (code = upper(code)),
      name text NOT NULL,
      symbol varchar(8) NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await db.query("INSERT INTO currencies (code, name, symbol) VALUES ('USD', 'US Dollar', '$') ON CONFLICT (code) DO NOTHING");
    await db.query(`INSERT INTO currencies (code, name)
      SELECT DISTINCT currency, currency FROM accounts
      ON CONFLICT (code) DO NOTHING`);
    await db.query(`INSERT INTO currencies (code, name)
      SELECT currency, currency FROM preferences WHERE id = 1
      ON CONFLICT (code) DO NOTHING`);
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
});

const transactionFromRow = (row: Row): Transaction => {
  const occurredOn = row.occurred_on instanceof Date
    ? row.occurred_on.toISOString().slice(0, 10)
    : String(row.occurred_on).slice(0, 10);
  const merchant = String(row.description);
  return {
    id: String(row.id), occurredOn,
    date: new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${occurredOn}T00:00:00Z`)),
    merchant, detail: String(row.note ?? ""),
    costCenter: String(row.cost_center ?? "Uncategorized"),
    costCenterId: row.cost_center_id ? String(row.cost_center_id) : null,
    account: String(row.account_name), accountId: String(row.account_id),
    transferId: row.transfer_id ? String(row.transfer_id) : null,
    transferAccountId: row.transfer_account_id ? String(row.transfer_account_id) : null,
    amount: Number(row.amount), type: row.type as Transaction["type"],
    icon: merchant.trim().charAt(0).toUpperCase() || "$",
  };
};

function buildTree(rows: Row[]): CostCenter[] {
  const nodes = new Map<string, CostCenter>();
  for (const row of rows) nodes.set(String(row.id), {
    id: String(row.id), name: String(row.name), parentId: row.parent_id ? String(row.parent_id) : null,
    color: String(row.color), amount: Number(row.amount ?? 0), children: [],
  });
  const roots: CostCenter[] = [];
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) nodes.get(node.parentId)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}

const currencyFromRow = (row: Row): Currency => ({
  code: String(row.code), name: String(row.name), symbol: String(row.symbol ?? ""),
});

export async function getFinanceData(): Promise<FinanceData> {
  await ensureDatabaseSchema();
  const [accountsResult, transactionsResult, centersResult, currenciesResult, preferencesResult] = await Promise.all([
    db.query(`SELECT a.*, a.opening_balance + COALESCE(transaction_totals.amount, 0) AS balance
      FROM accounts a
      LEFT JOIN (
        SELECT account_id, SUM(amount) AS amount FROM transactions GROUP BY account_id
      ) AS transaction_totals ON transaction_totals.account_id = a.id
      ORDER BY a.created_at, a.name`),
    db.query(`SELECT t.*, a.name AS account_name, c.name AS cost_center
      FROM transactions t JOIN accounts a ON a.id = t.account_id
      LEFT JOIN cost_centers c ON c.id = t.cost_center_id
      ORDER BY t.occurred_on DESC, t.created_at DESC`),
    db.query(`SELECT c.*, COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN ABS(t.amount) ELSE 0 END), 0) AS amount
      FROM cost_centers c LEFT JOIN transactions t ON t.cost_center_id = c.id
      GROUP BY c.id ORDER BY c.created_at, c.name`),
    db.query("SELECT code, name, symbol FROM currencies ORDER BY code"),
    db.query("SELECT currency, timezone, locale, price_format FROM preferences WHERE id = 1"),
  ]);
  const pref = preferencesResult.rows[0] ?? {};
  return {
    accounts: accountsResult.rows.map(accountFromRow),
    transactions: transactionsResult.rows.map(transactionFromRow),
    costCenters: buildTree(centersResult.rows),
    currencies: currenciesResult.rows.map(currencyFromRow),
    preferences: {
      currency: String(pref.currency ?? "USD"), timezone: String(pref.timezone ?? "UTC"),
      locale: String(pref.locale ?? "en-US"), priceFormat: String(pref.price_format ?? "symbol"),
    },
  };
}

export async function createCurrency(input: Record<string, unknown>) {
  await ensureDatabaseSchema();
  const currency = currencyInput(input);
  await db.query("INSERT INTO currencies (code, name, symbol) VALUES ($1, $2, $3)", [currency.code, currency.name, currency.symbol]);
}

export async function updateCurrency(previousCode: string, input: Record<string, unknown>) {
  await ensureDatabaseSchema();
  const currency = currencyInput(input);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query("UPDATE currencies SET code=$1, name=$2, symbol=$3 WHERE code=$4", [currency.code, currency.name, currency.symbol, previousCode]);
    if (!updated.rowCount) throw new Error("Currency not found.");
    if (currency.code !== previousCode) {
      await client.query("UPDATE accounts SET currency=$1, updated_at=now() WHERE currency=$2", [currency.code, previousCode]);
      await client.query("UPDATE preferences SET currency=$1, updated_at=now() WHERE currency=$2", [currency.code, previousCode]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function deleteCurrency(code: string) {
  await ensureDatabaseSchema();
  const [preferencesResult, accountsResult] = await Promise.all([
    db.query("SELECT currency FROM preferences WHERE id=1"),
    db.query("SELECT count(*)::int AS count FROM accounts WHERE currency=$1", [code]),
  ]);
  if (preferencesResult.rows[0]?.currency === code) throw new Error("Choose another main currency before deleting this one.");
  if (Number(accountsResult.rows[0]?.count) > 0) throw new Error("Move or update accounts using this currency before deleting it.");
  await db.query("DELETE FROM currencies WHERE code=$1", [code]);
}

export async function createAccount(input: Record<string, unknown>) {
  await ensureDatabaseSchema();
  await db.query(`INSERT INTO accounts (name, institution, last_four, opening_balance, currency, color, kind)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`, [input.name, input.institution ?? "", "", Number(input.startingBalance ?? 0), input.currency ?? "USD", input.color ?? "#573cf0", input.kind ?? "Checking"]);
}

export async function updateAccount(id: string, input: Record<string, unknown>) {
  await ensureDatabaseSchema();
  await db.query(`UPDATE accounts SET name=$1, institution=$2, opening_balance=$3, currency=$4, color=$5, kind=$6, updated_at=now() WHERE id=$7`,
    [input.name, input.institution ?? "", Number(input.openingBalance ?? 0), input.currency ?? "USD", input.color ?? "#573cf0", input.kind ?? "Checking", id]);
}

export async function createTransaction(input: Record<string, unknown>) {
  await ensureDatabaseSchema();
  const type = String(input.type) as Transaction["type"];
  const rawAmount = Math.abs(Number(input.amount));
  if (!Number.isFinite(rawAmount) || rawAmount === 0) throw new Error("Transaction amount must be greater than zero.");
  if (type === "Transfer") {
    const sourceAccountId = String(input.accountId ?? "");
    const destinationAccountId = String(input.transferAccountId ?? "");
    if (!sourceAccountId || !destinationAccountId) throw new Error("Choose both the source and destination accounts.");
    if (sourceAccountId === destinationAccountId) throw new Error("A transfer must use two different accounts.");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const transferId = (await client.query("SELECT gen_random_uuid() AS id")).rows[0].id;
      await client.query(`INSERT INTO transactions (occurred_on, description, note, account_id, amount, type, transfer_id, transfer_account_id)
        VALUES ($1, $2, $3, $4, -$5, 'Transfer', $6, $7)`, [input.occurredOn, input.description, input.note ?? "", sourceAccountId, rawAmount, transferId, destinationAccountId]);
      await client.query(`INSERT INTO transactions (occurred_on, description, note, account_id, amount, type, transfer_id, transfer_account_id)
        VALUES ($1, $2, $3, $4, $5, 'Transfer', $6, $7)`, [input.occurredOn, input.description, input.note ?? "", destinationAccountId, rawAmount, transferId, sourceAccountId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    return;
  }
  const amount = type === "Expense" ? -rawAmount : rawAmount;
  await db.query(`INSERT INTO transactions (occurred_on, description, note, account_id, cost_center_id, amount, type)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`, [input.occurredOn, input.description, input.note ?? "", input.accountId, input.costCenterId || null, amount, type]);
}

export async function updateTransaction(id: string, input: Record<string, unknown>) {
  await ensureDatabaseSchema();
  const type = String(input.type) as Transaction["type"];
  const rawAmount = Math.abs(Number(input.amount));
  if (!Number.isFinite(rawAmount) || rawAmount === 0) throw new Error("Transaction amount must be greater than zero.");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT transfer_id FROM transactions WHERE id=$1 FOR UPDATE", [id]);
    if (!existing.rowCount) throw new Error("Transaction not found.");
    const existingTransferId = existing.rows[0].transfer_id as string | null;
    if (type === "Transfer") {
      const sourceAccountId = String(input.accountId ?? "");
      const destinationAccountId = String(input.transferAccountId ?? "");
      if (!sourceAccountId || !destinationAccountId) throw new Error("Choose both the source and destination accounts.");
      if (sourceAccountId === destinationAccountId) throw new Error("A transfer must use two different accounts.");
      const transferId = existingTransferId ?? (await client.query("SELECT gen_random_uuid() AS id")).rows[0].id;
      if (existingTransferId) await client.query("DELETE FROM transactions WHERE transfer_id=$1", [transferId]);
      await client.query(`INSERT INTO transactions (occurred_on, description, note, account_id, amount, type, transfer_id, transfer_account_id)
        VALUES ($1, $2, $3, $4, -$5, 'Transfer', $6, $7)`, [input.occurredOn, input.description, input.note ?? "", sourceAccountId, rawAmount, transferId, destinationAccountId]);
      await client.query(`INSERT INTO transactions (occurred_on, description, note, account_id, amount, type, transfer_id, transfer_account_id)
        VALUES ($1, $2, $3, $4, $5, 'Transfer', $6, $7)`, [input.occurredOn, input.description, input.note ?? "", destinationAccountId, rawAmount, transferId, sourceAccountId]);
    } else {
      if (existingTransferId) await client.query("DELETE FROM transactions WHERE transfer_id=$1 AND id <> $2", [existingTransferId, id]);
      const amount = type === "Expense" ? -rawAmount : rawAmount;
      await client.query(`UPDATE transactions SET occurred_on=$1, description=$2, note=$3, account_id=$4, cost_center_id=$5, amount=$6, type=$7, transfer_id=NULL, transfer_account_id=NULL, updated_at=now() WHERE id=$8`,
        [input.occurredOn, input.description, input.note ?? "", input.accountId, input.costCenterId || null, amount, type, id]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function linkTransactionsAsTransfer(transactionId: string, counterpartTransactionId: string) {
  await ensureDatabaseSchema();
  if (!transactionId || !counterpartTransactionId || transactionId === counterpartTransactionId) throw new Error("Choose a different transaction to link.");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const rows = await client.query(`SELECT t.id, t.account_id, t.amount, t.type, t.transfer_id, a.currency
      FROM transactions t JOIN accounts a ON a.id = t.account_id
      WHERE t.id = ANY($1::uuid[]) FOR UPDATE OF t`, [[transactionId, counterpartTransactionId]]);
    if (rows.rowCount !== 2) throw new Error("One of the transactions could not be found.");
    const [first, second] = rows.rows;
    if (first.type === "Transfer" || second.type === "Transfer" || first.transfer_id || second.transfer_id) throw new Error("Only unlinked income and expense transactions can be linked.");
    if (first.account_id === second.account_id) throw new Error("Transfers must link two different accounts.");
    if (first.currency !== second.currency) throw new Error("Transfers can only link accounts with the same currency.");
    const firstAmount = Number(first.amount);
    const secondAmount = Number(second.amount);
    if (Math.abs(firstAmount) !== Math.abs(secondAmount) || Math.sign(firstAmount) === Math.sign(secondAmount)) throw new Error("Transfers need equal amounts in opposite directions.");
    const transferId = (await client.query("SELECT gen_random_uuid() AS id")).rows[0].id;
    await client.query(`UPDATE transactions SET type='Transfer', transfer_id=$1,
      transfer_account_id=CASE WHEN id=$2 THEN $3 ELSE $4 END,
      cost_center_id=NULL, updated_at=now()
      WHERE id = ANY($5::uuid[])`, [transferId, first.id, second.account_id, first.account_id, [first.id, second.id]]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function createCostCenter(input: Record<string, unknown>) {
  await ensureDatabaseSchema();
  await db.query("INSERT INTO cost_centers (name, parent_id, color) VALUES ($1, $2, $3)", [input.name, input.parentId || null, input.color ?? "#573cf0"]);
}

export async function deleteCostCenter(id: string) { await ensureDatabaseSchema(); await db.query("DELETE FROM cost_centers WHERE id=$1", [id]); }

export async function savePreferences(input: Preferences) {
  await ensureDatabaseSchema();
  await db.query(`INSERT INTO preferences (id, currency, timezone, locale, price_format) VALUES (1,$1,$2,$3,$4)
    ON CONFLICT (id) DO UPDATE SET currency=$1, timezone=$2, locale=$3, price_format=$4, updated_at=now()`,
    [input.currency, input.timezone, input.locale, input.priceFormat]);
}

export async function deleteAllData() {
  await ensureDatabaseSchema();
  await db.query("TRUNCATE transactions, cost_centers, accounts RESTART IDENTITY CASCADE");
}
