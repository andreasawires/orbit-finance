import "server-only";
import { currenciesFor, groupCurrencyAmounts, type CurrencyAmount } from "@/lib/currency-summary";
import type { FinanceReport, TransactionPage } from "@/lib/data";
import { db } from "@/lib/database";
import { dateRangeBounds, resolveDateRange, type DateRangeSelection } from "@/lib/date-range";
import { buildTree, ensureDatabaseSchema, getFinanceData, transactionFromRow } from "@/lib/db";
import { addDays, safeTimeZone, utcToZonedDate, zonedDateToUtc } from "@/lib/time";
import { bucketStarts, isUuid, resolveGranularity, UNCATEGORIZED, type ReportGranularity, type SortDirection, type TransactionFilters, type TransactionQuery, type TransactionSort } from "@/lib/transaction-query";

type Row = Record<string, unknown>;

const TRANSACTION_FROM = `FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.workspace_id = t.workspace_id
  LEFT JOIN cost_centers c ON c.id = t.cost_center_id AND c.workspace_id = t.workspace_id`;
const TRANSACTION_COLUMNS = "t.*, a.name AS account_name, a.currency AS transaction_currency, c.name AS cost_center";

// Ranges and day buckets follow the workspace timezone stored on the server, never one sent by the browser.
async function workspaceSettings(workspaceId: string) {
  await ensureDatabaseSchema();
  const result = await db.query<{ currency: string; timezone: string }>("SELECT currency, timezone FROM workspace_preferences WHERE workspace_id = $1", [workspaceId]);
  return { currency: String(result.rows[0]?.currency ?? "USD"), timeZone: safeTimeZone(result.rows[0]?.timezone) };
}

// One WHERE clause for every ledger query, so a page, its totals, the export and the report always agree.
function transactionFilter(workspaceId: string, filters: TransactionFilters, timeZone: string) {
  const range = resolveDateRange(filters.range, timeZone);
  const { start, end } = dateRangeBounds(range, timeZone);
  const params: unknown[] = [workspaceId, start, end];
  const param = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const clauses = ["t.workspace_id = $1", "t.occurred_at >= $2", "t.occurred_at < $3"];
  if (filters.type) clauses.push(`t.type = ${param(filters.type)}`);
  if (filters.accountIds.length) clauses.push(`t.account_id = ANY(${param(filters.accountIds)}::uuid[])`);
  if (filters.costCenterIds.length) {
    const ids = filters.costCenterIds.filter((id) => id !== UNCATEGORIZED);
    const matches = [
      ...(ids.length ? [`t.cost_center_id = ANY(${param(ids)}::uuid[])`] : []),
      ...(filters.costCenterIds.includes(UNCATEGORIZED) ? ["t.cost_center_id IS NULL"] : []),
    ];
    clauses.push(`(${matches.join(" OR ")})`);
  }
  if (filters.q) {
    // Same haystack the ledger search has always used: description, note and cost center name together.
    const pattern = param(`%${filters.q.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    clauses.push(`concat_ws(' ', t.description, t.note, COALESCE(c.name, 'Uncategorized')) ILIKE ${pattern}`);
  }
  return { range, where: clauses.join(" AND "), params };
}

const SORT_COLUMNS: Record<TransactionSort, string> = { date: "t.occurred_at", amount: "ABS(t.amount)", description: "lower(t.description)" };

function orderBy(sort: TransactionSort, dir: SortDirection) {
  const direction = dir === "asc" ? "ASC" : "DESC";
  if (sort === "date") return `t.occurred_at ${direction}, t.created_at ${direction}, t.id ${direction}`;
  return `${SORT_COLUMNS[sort]} ${direction}, t.occurred_at DESC, t.created_at DESC, t.id DESC`;
}

const amounts = (rows: Row[], column: string, mainCurrency: string) =>
  groupCurrencyAmounts(rows.map((row) => ({ currency: String(row.currency), amount: Number(row[column] ?? 0) })), mainCurrency);

export async function listTransactions(workspaceId: string, query: TransactionQuery): Promise<TransactionPage> {
  const { currency: mainCurrency, timeZone } = await workspaceSettings(workspaceId);
  const { range, where, params } = transactionFilter(workspaceId, query, timeZone);
  const summary = await db.query(`SELECT a.currency, COUNT(*)::int AS count,
      COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'Income'), 0) AS inflow,
      COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type = 'Expense'), 0) AS outflow
    ${TRANSACTION_FROM} WHERE ${where} GROUP BY a.currency`, params);
  const total = summary.rows.reduce((sum, row) => sum + Number(row.count), 0);
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
  // A page past the end (e.g. after deleting the last row on it) falls back to the last page that exists.
  const page = Math.min(query.page, pageCount);
  const rows = await db.query(`SELECT ${TRANSACTION_COLUMNS} ${TRANSACTION_FROM} WHERE ${where}
    ORDER BY ${orderBy(query.sort, query.dir)} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, query.pageSize, (page - 1) * query.pageSize]);
  const items = rows.rows.map(transactionFromRow);
  return {
    items, total, page, pageSize: query.pageSize, pageCount, range,
    summary: { inflow: amounts(summary.rows, "inflow", mainCurrency), outflow: amounts(summary.rows, "outflow", mainCurrency) },
    dayTotals: query.sort === "date" ? await dayTotals(where, params, items, timeZone, mainCurrency) : null,
  };
}

// A date-sorted page covers a contiguous run of local days, so totals for exactly those days come from one bounded query.
async function dayTotals(where: string, params: unknown[], items: TransactionPage["items"], timeZone: string, mainCurrency: string) {
  if (!items.length) return {};
  const days = items.map((item) => utcToZonedDate(item.occurredAt, timeZone)).sort();
  const start = zonedDateToUtc(days[0], timeZone, "00:00");
  const end = zonedDateToUtc(addDays(days.at(-1)!, 1), timeZone, "00:00");
  const next = params.length;
  const result = await db.query(`SELECT to_char(t.occurred_at AT TIME ZONE $${next + 1}::text, 'YYYY-MM-DD') AS day, a.currency, COUNT(*)::int AS count, SUM(t.amount) AS amount
    ${TRANSACTION_FROM} WHERE ${where} AND t.occurred_at >= $${next + 2} AND t.occurred_at < $${next + 3}
    GROUP BY 1, a.currency`, [...params, timeZone, start, end]);
  const totals: NonNullable<TransactionPage["dayTotals"]> = {};
  for (const row of result.rows) {
    const day = totals[String(row.day)] ??= { count: 0, amounts: [] };
    day.count += Number(row.count);
    day.amounts = groupCurrencyAmounts([...day.amounts, { currency: String(row.currency), amount: Number(row.amount) }], mainCurrency);
  }
  return totals;
}

const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;

export async function exportTransactionsCsv(workspaceId: string, filters: TransactionFilters, sort: TransactionSort, dir: SortDirection) {
  const { timeZone } = await workspaceSettings(workspaceId);
  const { where, params } = transactionFilter(workspaceId, filters, timeZone);
  const result = await db.query(`SELECT ${TRANSACTION_COLUMNS} ${TRANSACTION_FROM} WHERE ${where} ORDER BY ${orderBy(sort, dir)}`, params);
  return [["Date", "Description", "Note", "Type", "Account", "Cost center", "Amount", "Currency"], ...result.rows.map(transactionFromRow)
    .map((t) => [utcToZonedDate(t.occurredAt, timeZone), t.merchant, t.detail, t.type, t.account, t.costCenter, String(t.amount), t.currency])]
    .map((row) => row.map(csvCell).join(",")).join("\n");
}

// Unlinked transactions on `accountId` that can be the other side of a transfer: the same amount in the opposite direction.
export async function transferCandidates(workspaceId: string, transactionId: string, accountId: string) {
  if (!isUuid(transactionId) || !isUuid(accountId)) throw new Error("Invalid transaction or account id.");
  await ensureDatabaseSchema();
  const source = await db.query<{ amount: string }>("SELECT amount FROM transactions WHERE workspace_id = $1 AND id = $2", [workspaceId, transactionId]);
  if (!source.rowCount) throw new Error("Transaction not found.");
  const amount = Number(source.rows[0].amount);
  const result = await db.query(`SELECT ${TRANSACTION_COLUMNS} ${TRANSACTION_FROM}
    WHERE t.workspace_id = $1 AND t.account_id = $2 AND t.id <> $3 AND t.transfer_id IS NULL AND t.type = $4 AND t.amount = -$5::numeric
    ORDER BY t.occurred_at DESC, t.created_at DESC LIMIT 200`, [workspaceId, accountId, transactionId, amount < 0 ? "Income" : "Expense", source.rows[0].amount]);
  return { items: result.rows.map(transactionFromRow) };
}

export async function getReport(workspaceId: string, selection: DateRangeSelection, granularity: ReportGranularity): Promise<FinanceReport> {
  const { currency: mainCurrency, timeZone } = await workspaceSettings(workspaceId);
  const { range, where, params } = transactionFilter(workspaceId, { range: selection, q: "", type: "", accountIds: [], costCenterIds: [] }, timeZone);
  const unit = resolveGranularity(range, granularity);
  const buckets = bucketStarts(range, unit);
  const next = params.length;
  const [bucketResult, spendResult, centersResult] = await Promise.all([
    db.query(`SELECT a.currency, to_char(date_trunc($${next + 1}::text, t.occurred_at AT TIME ZONE $${next + 2}::text), 'YYYY-MM-DD') AS bucket,
        COUNT(*) FILTER (WHERE t.type = 'Expense')::int AS expense_count,
        COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'Income'), 0) AS income,
        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type = 'Expense'), 0) AS expense
      ${TRANSACTION_FROM} WHERE ${where} GROUP BY a.currency, 2`, [...params, unit, timeZone]),
    db.query(`SELECT t.cost_center_id, a.currency, SUM(ABS(t.amount)) AS amount
      ${TRANSACTION_FROM} WHERE ${where} AND t.type = 'Expense' AND t.cost_center_id IS NOT NULL
      GROUP BY t.cost_center_id, a.currency`, params),
    db.query("SELECT * FROM cost_centers WHERE workspace_id = $1 ORDER BY created_at, name", [workspaceId]),
  ]);
  const centers = buildTree(centersResult.rows, spendResult.rows, mainCurrency);
  const currencies = currenciesFor(bucketResult.rows.map((row) => ({ currency: String(row.currency), amount: 0 })));
  return {
    range, granularity: unit, buckets,
    currencies: currencies.map((currency) => {
      const rows = bucketResult.rows.filter((row) => row.currency === currency);
      const byBucket = new Map(rows.map((row) => [String(row.bucket), row]));
      const income = rows.reduce((sum, row) => sum + Number(row.income), 0);
      const expense = rows.reduce((sum, row) => sum + Number(row.expense), 0);
      const net = income - expense;
      return {
        currency, income, expense, net, rate: income ? (net / income) * 100 : 0,
        expenseCount: rows.reduce((sum, row) => sum + Number(row.expense_count), 0),
        buckets: buckets.map((key) => ({ income: Number(byBucket.get(key)?.income ?? 0), expense: Number(byBucket.get(key)?.expense ?? 0) })),
        costCenters: centers
          .map((center) => ({ id: center.id, name: center.name, color: center.color, total: center.spend.find((value: CurrencyAmount) => value.currency === currency)?.amount ?? 0 }))
          .filter((center) => center.total > 0),
      };
    }),
  };
}

/** Full workspace backup, including every transaction. */
export async function getWorkspaceExport(workspaceId: string) {
  const data = await getFinanceData(workspaceId);
  const transactions = await db.query(`SELECT ${TRANSACTION_COLUMNS} ${TRANSACTION_FROM} WHERE t.workspace_id = $1 ORDER BY t.occurred_at DESC, t.created_at DESC`, [workspaceId]);
  return { accounts: data.accounts, transactions: transactions.rows.map(transactionFromRow), costCenters: data.costCenters, currencies: data.currencies, preferences: data.preferences };
}
