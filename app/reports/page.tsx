"use client";

import { ChevronDown, Download, Info } from "lucide-react";
import { useMemo } from "react";
import { CurrencyAmounts, CurrencyModeControl, useCurrencyPresentation, type CurrencyDisplayMode } from "@/components/currency-presentation";
import { DateRangeFilter } from "@/components/date-range-filter";
import { usePageFilters } from "@/components/view-state-provider";
import { groupCurrencyAmounts, type CurrencyAmount, type FxRateMap } from "@/lib/currency-summary";
import { formatMoney, type Account, type FinanceReport, type ReportCurrencyView } from "@/lib/data";
import { DEFAULT_DATE_RANGE, formatDateRange, resolveDateRange, type DateRange, type DateRangeSelection } from "@/lib/date-range";
import { formatMonth } from "@/lib/time";
import { granularityAllowed, reportSearchParams, type ReportBucketUnit, type ReportGranularity } from "@/lib/transaction-query";
import { useFinanceData } from "@/lib/use-finance-data";
import { useServerQuery } from "@/lib/use-server-query";

type SpendCenter = ReportCurrencyView["costCenters"][number];

const defaultFilters: { range: DateRangeSelection; granularity: ReportGranularity } = { range: DEFAULT_DATE_RANGE, granularity: "auto" };
const granularities: Array<{ value: ReportGranularity; label: string }> = [
  { value: "auto", label: "Auto" }, { value: "day", label: "Daily" }, { value: "week", label: "Weekly" }, { value: "month", label: "Monthly" },
];
const unitLabels: Record<ReportBucketUnit, string> = { day: "Daily", week: "Weekly", month: "Monthly" };
const MAX_CHART_LABELS = 8;

function rangeFor(selection: DateRangeSelection, timeZone: string): DateRange | null {
  try { return resolveDateRange(selection, timeZone); } catch { return null; }
}

function bucketLabel(key: string, unit: ReportBucketUnit, locale: string, multiYear: boolean) {
  if (unit === "month") return multiYear ? `${formatMonth(key.slice(0, 7), locale)} ${key.slice(2, 4)}` : formatMonth(key.slice(0, 7), locale);
  const date = new Date(`${key}T12:00:00Z`);
  try { return date.toLocaleDateString(locale, { month: "short", day: "numeric", timeZone: "UTC" }); }
  catch { return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); }
}

// The server aggregates per native currency. Converting those totals with the latest reference rate is
// presentation only; it returns null when a rate is missing so the page falls back to native views.
function convertedView(views: ReportCurrencyView[], targetCurrency: string, rates: FxRateMap): ReportCurrencyView | null {
  const rateFor = (currency: string) => currency === targetCurrency ? 1 : rates[currency]?.rate;
  if (!views.every((view) => Number.isFinite(rateFor(view.currency)) && rateFor(view.currency)! > 0)) return null;
  const income = views.reduce((sum, view) => sum + view.income * rateFor(view.currency)!, 0);
  const expense = views.reduce((sum, view) => sum + view.expense * rateFor(view.currency)!, 0);
  const centers = new Map<string, SpendCenter>();
  for (const view of views) for (const center of view.costCenters) {
    const existing = centers.get(center.id);
    centers.set(center.id, { ...center, total: (existing?.total ?? 0) + center.total * rateFor(view.currency)! });
  }
  return {
    currency: targetCurrency, income, expense, net: income - expense, rate: income ? ((income - expense) / income) * 100 : 0,
    expenseCount: views.reduce((sum, view) => sum + view.expenseCount, 0),
    buckets: (views[0]?.buckets ?? []).map((_, index) => ({
      income: views.reduce((sum, view) => sum + view.buckets[index].income * rateFor(view.currency)!, 0),
      expense: views.reduce((sum, view) => sum + view.buckets[index].expense * rateFor(view.currency)!, 0),
    })),
    costCenters: [...centers.values()],
  };
}

function convertedAmount(amount: number, currency: string, targetCurrency: string, rates: FxRateMap) {
  if (currency === targetCurrency) return amount;
  return amount * (rates[currency]?.rate ?? 0);
}

function TrendChart({ income, expense, labels, currency, locale }: { income: number[]; expense: number[]; labels: string[]; currency: string; locale: string }) {
  const max = Math.max(1, ...income, ...expense);
  // A single bucket is drawn as a flat line across the chart.
  const points = (values: number[]) => (values.length === 1 ? [values[0], values[0]] : values).map((value, index, all) => `${(index / Math.max(1, all.length - 1)) * 100},${100 - (value / max) * 85}`).join(" ");
  const step = Math.ceil(labels.length / MAX_CHART_LABELS);
  return <div className="trend-chart"><div className="chart-y"><span>{formatMoney(max, currency, locale)}</span><span>{formatMoney(max / 2, currency, locale)}</span><span>{formatMoney(0, currency, locale)}</span></div><div className="chart-area"><div className="grid-lines"><i /><i /><i /></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={`Income and expense trend in ${currency}`}><defs><linearGradient id={`incomeFill-${currency}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#573cf0" stopOpacity=".22"/><stop offset="1" stopColor="#573cf0" stopOpacity="0"/></linearGradient></defs><polygon points={`0,100 ${points(income)} 100,100`} fill={`url(#incomeFill-${currency})`}/><polyline points={points(income)} fill="none" stroke="#573cf0" strokeWidth="1.8" vectorEffect="non-scaling-stroke"/><polyline points={points(expense)} fill="none" stroke="#e59566" strokeWidth="1.8" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"/></svg><div className="chart-x">{labels.map((label, index) => <span key={`${label}-${index}`}>{index % step === 0 || index === labels.length - 1 ? label : ""}</span>)}</div></div></div>;
}

function SpendPanel({ view, locale }: { view: ReportCurrencyView; locale: string }) {
  const centers = view.costCenters;
  const totalSpend = centers.reduce((sum, center) => sum + center.total, 0);
  const gradient = centers.length ? `conic-gradient(${centers.map((center, index) => `${center.color} ${(centers.slice(0, index).reduce((sum, item) => sum + item.total, 0) / totalSpend) * 100}% ${(centers.slice(0, index + 1).reduce((sum, item) => sum + item.total, 0) / totalSpend) * 100}%`).join(",")})` : "var(--line)";
  return <section className="panel spend-panel"><div className="panel-head"><div><h2>Spending by cost center</h2><p>{view.currency} expenses in this period</p></div><span title="Expenses without a cost center are shown as Uncategorized"><Info size={17} /></span></div>{centers.length ? <div className="spend-content"><div className="donut" style={{ background: gradient }}><div><strong>{formatMoney(totalSpend, view.currency, locale)}</strong><span>Total spend</span></div></div><div className="spend-list">{centers.map((center) => <div key={center.id}><i style={{ background: center.color }} /><span><strong>{center.name}</strong><small>{totalSpend ? Math.round(center.total / totalSpend * 100) : 0}%</small></span><b>{formatMoney(center.total, view.currency, locale)}</b></div>)}</div></div> : <div className="empty-state">No expenses in {view.currency}.</div>}</section>;
}

function AccountBalances({ accounts, mode, targetCurrency, rates, locale }: { accounts: Account[]; mode: CurrencyDisplayMode; targetCurrency: string; rates: FxRateMap | null; locale: string }) {
  const converted = mode === "converted" && rates;
  const entries = accounts.map((account) => ({
    ...account,
    displayCurrency: converted ? targetCurrency : account.currency,
    displayBalance: converted ? convertedAmount(account.balance, account.currency, targetCurrency, rates) : account.balance,
  }));
  const maxByCurrency = new Map<string, number>();
  for (const entry of entries) maxByCurrency.set(entry.displayCurrency, Math.max(maxByCurrency.get(entry.displayCurrency) ?? 1, Math.abs(entry.displayBalance)));
  return <section className="panel balances-panel"><div className="panel-head"><div><h2>Account balances</h2><p>{converted ? `Current balances converted to ${targetCurrency}` : "Current balances in native account currency"}</p></div><span className="tag">Live</span></div>{entries.length ? <div className="balance-list">{entries.map((account) => {
    const max = maxByCurrency.get(account.displayCurrency) ?? 1;
    return <div key={account.id}><i style={{ background: account.color }} /><span><strong>{account.name}</strong><small>{account.institution}</small></span><div><strong>{formatMoney(account.displayBalance, account.displayCurrency, locale)}</strong><small>{account.displayCurrency}</small></div><span className="balance-bar"><i style={{ width: `${Math.max(5, Math.min(100, Math.abs(account.displayBalance) / max * 100))}%`, background: account.color }} /></span></div>;
  })}</div> : <div className="empty-state">No accounts yet.</div>}</section>;
}

export default function ReportsPage() {
  const { accounts, preferences, loading, error } = useFinanceData();
  const [view, updateView] = usePageFilters("reports", defaultFilters);
  const { data: report, loading: reportLoading, error: reportError } = useServerQuery<FinanceReport>("/api/reports", reportSearchParams(view.range, view.granularity));
  const nativeViews = useMemo(() => report?.currencies ?? [], [report]);
  const presentationValues = useMemo<CurrencyAmount[]>(() => [
    ...accounts.map((account) => ({ currency: account.currency, amount: account.balance })),
    ...nativeViews.map((item) => ({ currency: item.currency, amount: item.income + item.expense })),
  ], [accounts, nativeViews]);
  const currencyPresentation = useCurrencyPresentation(presentationValues, preferences.currency);
  const converted = useMemo(() => currencyPresentation.mode === "converted" && currencyPresentation.rates ? convertedView(nativeViews, preferences.currency, currencyPresentation.rates) : null, [currencyPresentation.mode, currencyPresentation.rates, nativeViews, preferences.currency]);
  const views = converted ? [converted] : nativeViews;
  const net = useMemo(() => groupCurrencyAmounts(nativeViews.map((item) => ({ currency: item.currency, amount: item.net })), preferences.currency), [nativeViews, preferences.currency]);
  const spend = useMemo(() => groupCurrencyAmounts(nativeViews.map((item) => ({ currency: item.currency, amount: item.expense })), preferences.currency), [nativeViews, preferences.currency]);
  const expenseCount = nativeViews.reduce((sum, item) => sum + item.expenseCount, 0);
  const selectedRange = rangeFor(view.range, preferences.timezone);
  const multiYear = !!report && report.buckets.length > 0 && report.buckets[0].slice(0, 4) !== report.buckets.at(-1)!.slice(0, 4);
  const labels = report ? report.buckets.map((key) => bucketLabel(key, report.granularity, preferences.locale, multiYear)) : [];

  function changeRange(range: DateRangeSelection) {
    // A fixed bucket size that would be too fine for the new range goes back to automatic.
    const next = rangeFor(range, preferences.timezone);
    const keep = view.granularity === "auto" || (next && granularityAllowed(next, view.granularity));
    updateView(keep ? { range } : { range, granularity: "auto" });
  }

  function exportJson() {
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify({ generatedAt: new Date().toISOString(), report, accounts }, null, 2)], { type: "application/json" })); link.download = "orbit-report.json"; link.click(); URL.revokeObjectURL(link.href);
  }

  return <div className="page reports-page">
    <div className="page-heading"><div><div className="eyebrow">Financial story</div><h1>Reports</h1><p>Live calculations from your saved data.</p></div><div className="heading-actions">
      <DateRangeFilter value={view.range} onChange={changeRange} timeZone={preferences.timezone} locale={preferences.locale} />
      <label className="filter-select"><select aria-label="Chart granularity" value={view.granularity} onChange={(event) => updateView({ granularity: event.target.value as ReportGranularity })}>{granularities.map((item) => <option key={item.value} value={item.value} disabled={item.value !== "auto" && !!selectedRange && !granularityAllowed(selectedRange, item.value)}>{item.label}</option>)}</select><ChevronDown size={14} /></label>
      <button className="button secondary" disabled={!report} onClick={exportJson}><Download size={16} /> Export report</button>
    </div></div>
    {error && <div className="data-error"><strong>Could not connect to PostgreSQL.</strong><span>{error}</span><code>docker compose up -d</code></div>}
    {reportError && <div className="form-error">{reportError}</div>}
    {currencyPresentation.canConvert && <CurrencyModeControl targetCurrency={preferences.currency} mode={currencyPresentation.mode} setMode={currencyPresentation.setDisplayMode} loading={currencyPresentation.loading} error={currencyPresentation.error} providerLabel={currencyPresentation.providerLabel} rateDates={currencyPresentation.rateDates} onRefresh={() => void currencyPresentation.refresh()} />}
    <section className="report-kpis">
      <div className="panel"><span>Net income</span><strong><CurrencyAmounts values={net} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} /></strong><small><i>Income less expenses</i></small></div>
      <div className="panel"><span>Total recorded spend</span><strong><CurrencyAmounts values={spend} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} /></strong><small><i>Across {expenseCount} expenses</i></small></div>
      <div className="panel"><span>Savings rate</span><strong className="currency-rates">{views.map((item) => <span key={item.currency}>{converted ? "" : `${item.currency} `}{item.rate.toFixed(1)}%</span>)}</strong><small><i>Based on recorded income</i></small></div>
    </section>
    {views.length && report ? views.map((item) => <section className="report-currency-section" key={item.currency}>
      {!converted && <h2>{item.currency} report</h2>}
      <div className="report-grid">
        <section className="panel trend-panel"><div className="panel-head"><div><h2>Income vs. expenses</h2><p>{unitLabels[report.granularity]} cash flow · {formatDateRange(report.range, preferences.locale)}</p></div><div className="chart-legend"><span><i className="purple" />Income</span><span><i className="orange" />Expenses</span></div></div><div className="trend-summary"><div><small>Total income</small><strong>{formatMoney(item.income, item.currency, preferences.locale)}</strong></div><div><small>Total expenses</small><strong>{formatMoney(item.expense, item.currency, preferences.locale)}</strong></div><div><small>Difference</small><strong className={item.net >= 0 ? "positive" : "negative"}>{formatMoney(item.net, item.currency, preferences.locale)}</strong></div></div><TrendChart income={item.buckets.map((bucket) => bucket.income)} expense={item.buckets.map((bucket) => bucket.expense)} labels={labels} currency={item.currency} locale={preferences.locale} /></section>
        <SpendPanel view={item} locale={preferences.locale} />
      </div>
    </section>) : <div className="empty-state">{loading || (reportLoading && !report) ? "Loading…" : "No transactions in this period."}</div>}
    <div className="report-grid report-balances"><AccountBalances accounts={accounts} mode={currencyPresentation.mode} targetCurrency={preferences.currency} rates={currencyPresentation.rates} locale={preferences.locale} /></div>
  </div>;
}
