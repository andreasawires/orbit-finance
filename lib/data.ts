import type { CurrencyAmount } from "@/lib/currency-summary";
import type { DateRange } from "@/lib/date-range";
import type { ReportBucketUnit } from "@/lib/transaction-query";

export type Account = {
  id: string;
  name: string;
  institution: string;
  number: string;
  openingBalance: number;
  balance: number;
  currency: string;
  color: string;
  kind: string;
  transactionCount: number;
  transferCount: number;
};

export type Transaction = {
  id: string;
  /** UTC instant (ISO 8601). Display it with the workspace timezone via lib/time. */
  occurredAt: string;
  merchant: string;
  detail: string;
  costCenter: string;
  costCenterId: string | null;
  account: string;
  accountId: string;
  transferId: string | null;
  transferAccountId: string | null;
  /** The other side of a transfer: its account, description and time. */
  transferAccount: string | null;
  transferMerchant: string | null;
  transferOccurredAt: string | null;
  /** The other side's amount, in its own account's currency; differs from this one's for cross-currency transfers. */
  transferAmount: number | null;
  transferCurrency: string | null;
  amount: number;
  currency: string;
  type: "Income" | "Expense" | "Transfer";
  icon: string;
};

export type CostCenter = {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
  /** All-time expenses per currency, including every descendant center. */
  spend: CurrencyAmount[];
  children: CostCenter[];
};

export type Preferences = {
  currency: string;
  timezone: string;
  locale: string;
  priceFormat: string;
};

export type Currency = {
  code: string;
  name: string;
  symbol: string;
};

export type Workspace = {
  id: string;
  name: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FinanceData = {
  workspace: Workspace | null;
  accounts: Account[];
  costCenters: CostCenter[];
  currencies: Currency[];
  preferences: Preferences;
};

export const emptyFinanceData: FinanceData = {
  workspace: null,
  accounts: [],
  costCenters: [],
  currencies: [],
  preferences: { currency: "USD", timezone: "UTC", locale: "en-US", priceFormat: "symbol" },
};

/** One page of the filtered ledger. `summary` covers every matching transaction, not just this page. */
export type TransactionPage = {
  items: Transaction[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  range: DateRange;
  /** Inflow and outflow leave transfers out; `transfer` is the money moved between accounts, each transfer counted once. */
  summary: { inflow: CurrencyAmount[]; outflow: CurrencyAmount[]; transfer: CurrencyAmount[] };
  /** Full-day totals for each local day on this page, keyed YYYY-MM-DD. Only present when sorted by date. */
  dayTotals: Record<string, { count: number; amounts: CurrencyAmount[] }> | null;
};

export type ReportCurrencyView = {
  currency: string;
  income: number;
  expense: number;
  net: number;
  rate: number;
  expenseCount: number;
  /** Money moved between accounts, each transfer counted once. Not part of income, expense or net. */
  transfer: number;
  transferCount: number;
  /** Aligned with FinanceReport.buckets. */
  buckets: Array<{ income: number; expense: number }>;
  /** Root cost centers with their rolled-up expenses in this currency, then "uncategorized" for expenses without one. */
  costCenters: Array<{ id: string; name: string; color: string; total: number }>;
};

export type FinanceReport = {
  range: DateRange;
  granularity: ReportBucketUnit;
  /** Start date of each bucket, YYYY-MM-DD. */
  buckets: string[];
  currencies: ReportCurrencyView[];
};

export const formatMoney = (value: number, currency = "USD", locale = "en-US") =>
  new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2 }).format(value);

export const flattenCostCenters = (centers: CostCenter[], prefix = ""): Array<CostCenter & { path: string }> =>
  centers.flatMap((center) => {
    const path = prefix ? `${prefix} › ${center.name}` : center.name;
    return [{ ...center, path }, ...flattenCostCenters(center.children, path)];
  });
