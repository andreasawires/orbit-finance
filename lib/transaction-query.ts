// Query parameters for the server-side ledger and report endpoints. The client builds them with the
// *SearchParams helpers and the API parses them back with the parse* helpers, so both sides agree.

import type { Transaction } from "@/lib/data";
import { DEFAULT_DATE_RANGE, dateRangeParams, daysInRange, parseDateRange, type DateRange, type DateRangeSelection } from "@/lib/date-range";
import { addDays } from "@/lib/time";

export const TRANSACTION_TYPES = ["Income", "Expense", "Transfer"] as const;
export const TRANSACTION_SORTS = ["date", "amount", "description"] as const;
export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export const PAGE_SIZES = [25, 50, 100, 200];
export const OVERVIEW_PAGE_SIZES = [5, 10, 25];
const ALLOWED_PAGE_SIZES = new Set([...OVERVIEW_PAGE_SIZES, ...PAGE_SIZES]);
/** Cost center filter value for transactions without a cost center. */
export const UNCATEGORIZED = "uncategorized";

export type TransactionSort = typeof TRANSACTION_SORTS[number];
export type SortDirection = typeof SORT_DIRECTIONS[number];

export type TransactionFilters = {
  range: DateRangeSelection;
  q: string;
  type: Transaction["type"] | "";
  accountIds: string[];
  costCenterIds: string[];
};

export type TransactionQuery = TransactionFilters & {
  sort: TransactionSort;
  dir: SortDirection;
  page: number;
  pageSize: number;
};

export const DEFAULT_TRANSACTION_QUERY: TransactionQuery = {
  range: DEFAULT_DATE_RANGE, q: "", type: "", accountIds: [], costCenterIds: [], sort: "date", dir: "desc", page: 1, pageSize: PAGE_SIZES[0],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const includes = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === "string" && (values as readonly string[]).includes(value);

export function transactionFilterSearchParams(filters: TransactionFilters) {
  const params = new URLSearchParams(dateRangeParams(filters.range));
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.type) params.set("type", filters.type);
  for (const id of filters.accountIds) params.append("account", id);
  for (const id of filters.costCenterIds) params.append("costCenter", id);
  return params;
}

export function transactionSearchParams(query: TransactionQuery) {
  const params = transactionFilterSearchParams(query);
  params.set("sort", query.sort);
  params.set("dir", query.dir);
  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  return params;
}

export function parseTransactionFilters(params: URLSearchParams): TransactionFilters {
  const type = params.get("type") ?? "";
  if (type && !includes(TRANSACTION_TYPES, type)) throw new Error("Invalid type filter.");
  const accountIds = params.getAll("account");
  if (!accountIds.every(isUuid)) throw new Error("Invalid account filter.");
  const costCenterIds = params.getAll("costCenter");
  if (!costCenterIds.every((id) => id === UNCATEGORIZED || isUuid(id))) throw new Error("Invalid cost center filter.");
  return { range: parseDateRange(params), q: (params.get("q") ?? "").trim().slice(0, 200), type: type as TransactionFilters["type"], accountIds, costCenterIds };
}

export function parseTransactionSort(params: URLSearchParams) {
  const sort = params.get("sort") ?? DEFAULT_TRANSACTION_QUERY.sort;
  const dir = params.get("dir") ?? DEFAULT_TRANSACTION_QUERY.dir;
  if (!includes(TRANSACTION_SORTS, sort) || !includes(SORT_DIRECTIONS, dir)) throw new Error("Invalid sort.");
  return { sort, dir };
}

export function parseTransactionQuery(params: URLSearchParams): TransactionQuery {
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? DEFAULT_TRANSACTION_QUERY.pageSize);
  if (!Number.isInteger(page) || page < 1) throw new Error("Invalid page.");
  if (!ALLOWED_PAGE_SIZES.has(pageSize)) throw new Error("Invalid page size.");
  return { ...parseTransactionFilters(params), ...parseTransactionSort(params), page, pageSize };
}

// Reports group the range into buckets. "auto" picks a size that keeps the chart readable.
export const REPORT_GRANULARITIES = ["auto", "day", "week", "month"] as const;
export type ReportGranularity = typeof REPORT_GRANULARITIES[number];
export type ReportBucketUnit = Exclude<ReportGranularity, "auto">;
const MAX_BUCKETS = 400;

/** Start date (YYYY-MM-DD) of every bucket overlapping the range. Weeks start on Monday, matching Postgres date_trunc. */
export function bucketStarts(range: DateRange, unit: ReportBucketUnit) {
  let cursor = range.from;
  if (unit === "week") cursor = addDays(cursor, -((new Date(`${cursor}T00:00:00Z`).getUTCDay() + 6) % 7));
  if (unit === "month") cursor = `${cursor.slice(0, 7)}-01`;
  const starts: string[] = [];
  while (cursor <= range.to && starts.length <= MAX_BUCKETS) {
    starts.push(cursor);
    if (unit === "month") {
      const [year, month] = cursor.split("-").map(Number);
      cursor = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    } else cursor = addDays(cursor, unit === "week" ? 7 : 1);
  }
  return starts;
}

export function granularityAllowed(range: DateRange, unit: ReportBucketUnit) {
  return bucketStarts(range, unit).length <= MAX_BUCKETS;
}

export function resolveGranularity(range: DateRange, granularity: ReportGranularity): ReportBucketUnit {
  if (granularity !== "auto") {
    if (!granularityAllowed(range, granularity)) throw new Error("Invalid granularity: too many buckets for this date range.");
    return granularity;
  }
  const days = daysInRange(range);
  return days <= 31 ? "day" : days <= 120 ? "week" : "month";
}

export function reportSearchParams(range: DateRangeSelection, granularity: ReportGranularity) {
  return new URLSearchParams({ ...dateRangeParams(range), granularity });
}

export function parseReportQuery(params: URLSearchParams) {
  const granularity = params.get("granularity") ?? "auto";
  if (!includes(REPORT_GRANULARITIES, granularity)) throw new Error("Invalid granularity.");
  return { range: parseDateRange(params), granularity };
}
