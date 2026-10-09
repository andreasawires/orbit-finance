"use client";

import { Download, Info } from "lucide-react";
import { useMemo } from "react";
import { CurrencyAmounts, CurrencyModeControl, useCurrencyPresentation, type CurrencyDisplayMode } from "@/components/currency-presentation";
import { currenciesFor, groupCurrencyAmounts, transactionFlows, type CurrencyAmount, type FxRateMap } from "@/lib/currency-summary";
import { formatMoney, type Account, type CostCenter, type Transaction } from "@/lib/data";
import { useFinanceData } from "@/lib/use-finance-data";
import { formatMonth, monthKeyInZone, todayInZone } from "@/lib/time";

type ReportMetrics = {
  currency: string;
  income: number;
  expense: number;
  net: number;
  rate: number;
  buckets: Array<{ key: string; label: string; income: number; expense: number }>;
};

type SpendCenter = CostCenter & { total: number };

function months(timeZone: string, locale: string) {
  const [year, month] = todayInZone(timeZone).split("-").map(Number);
  return Array.from({ length: 6 }, (_, index) => {
    const key = new Date(Date.UTC(year, month - 1 - 5 + index, 1)).toISOString().slice(0, 7);
    return { key, label: formatMonth(key, locale), income: 0, expense: 0 };
  });
}

function reportMetrics(currency: string, transactions: Transaction[], timeZone: string, locale: string): ReportMetrics {
  const buckets = months(timeZone, locale);
  for (const transaction of transactions) {
    const bucket = buckets.find((item) => item.key === monthKeyInZone(transaction.occurredAt, timeZone));
    if (!bucket) continue;
    if (transaction.type === "Income") bucket.income += transaction.amount;
    if (transaction.type === "Expense") bucket.expense += Math.abs(transaction.amount);
  }
  const income = transactions.filter((transaction) => transaction.type === "Income").reduce((total, transaction) => total + transaction.amount, 0);
  const expense = transactions.filter((transaction) => transaction.type === "Expense").reduce((total, transaction) => total + Math.abs(transaction.amount), 0);
  const net = income - expense;
  return { currency, buckets, income, expense, net, rate: income ? (net / income) * 100 : 0 };
}

function descendantIds(center: CostCenter): string[] {
  return [center.id, ...center.children.flatMap(descendantIds)];
}

function spendingByCenter(centers: CostCenter[], transactions: Transaction[]) {
  return centers.map((center) => {
    const ids = new Set(descendantIds(center));
    const total = transactions
      .filter((transaction) => transaction.type === "Expense" && transaction.costCenterId && ids.has(transaction.costCenterId))
      .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
    return { ...center, total };
  }).filter((center) => center.total > 0);
}

function convertedAmount(amount: number, currency: string, targetCurrency: string, rates: FxRateMap) {
  if (currency === targetCurrency) return amount;
  return amount * rates[currency].rate;
}

function convertedTransactions(transactions: Transaction[], targetCurrency: string, rates: FxRateMap) {
  return transactions.map((transaction) => ({
    ...transaction,
    amount: convertedAmount(transaction.amount, transaction.currency, targetCurrency, rates),
    currency: targetCurrency,
  }));
}

function TrendChart({ income, expense, labels, currency, locale }: { income: number[]; expense: number[]; labels: string[]; currency: string; locale: string }) {
  const max = Math.max(1, ...income, ...expense);
  const points = (values: number[]) => values.map((value, index) => `${index * 20},${100 - (value / max) * 85}`).join(" ");
  return <div className="trend-chart"><div className="chart-y"><span>{formatMoney(max, currency, locale)}</span><span>{formatMoney(max / 2, currency, locale)}</span><span>{formatMoney(0, currency, locale)}</span></div><div className="chart-area"><div className="grid-lines"><i /><i /><i /></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={`Income and expense trend in ${currency}`}><defs><linearGradient id={`incomeFill-${currency}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#573cf0" stopOpacity=".22"/><stop offset="1" stopColor="#573cf0" stopOpacity="0"/></linearGradient></defs><polygon points={`0,100 ${points(income)} 100,100`} fill={`url(#incomeFill-${currency})`}/><polyline points={points(income)} fill="none" stroke="#573cf0" strokeWidth="1.8" vectorEffect="non-scaling-stroke"/><polyline points={points(expense)} fill="none" stroke="#e59566" strokeWidth="1.8" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"/></svg><div className="chart-x">{labels.map((label) => <span key={label}>{label}</span>)}</div></div></div>;
}

function SpendPanel({ metrics, centers, locale }: { metrics: ReportMetrics; centers: SpendCenter[]; locale: string }) {
  const totalSpend = centers.reduce((sum, center) => sum + center.total, 0);
  const gradient = centers.length ? `conic-gradient(${centers.map((center, index) => `${center.color} ${(centers.slice(0, index).reduce((sum, item) => sum + item.total, 0) / totalSpend) * 100}% ${(centers.slice(0, index + 1).reduce((sum, item) => sum + item.total, 0) / totalSpend) * 100}%`).join(",")})` : "var(--line)";
  return <section className="panel spend-panel"><div className="panel-head"><div><h2>Spending by cost center</h2><p>{metrics.currency} expenses in this view</p></div><span title="Only categorized expenses are included"><Info size={17} /></span></div>{centers.length ? <div className="spend-content"><div className="donut" style={{ background: gradient }}><div><strong>{formatMoney(totalSpend, metrics.currency, locale)}</strong><span>Total categorized</span></div></div><div className="spend-list">{centers.map((center) => <div key={center.id}><i style={{ background: center.color }} /><span><strong>{center.name}</strong><small>{totalSpend ? Math.round(center.total / totalSpend * 100) : 0}%</small></span><b>{formatMoney(center.total, metrics.currency, locale)}</b></div>)}</div></div> : <div className="empty-state">No categorized expenses in {metrics.currency}.</div>}</section>;
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
  return <section className="panel balances-panel"><div className="panel-head"><div><h2>Account balances</h2><p>{converted ? `Converted to ${targetCurrency} for comparison` : "Grouped by native account currency"}</p></div><span className="tag">Live</span></div>{entries.length ? <div className="balance-list">{entries.map((account) => {
    const max = maxByCurrency.get(account.displayCurrency) ?? 1;
    return <div key={account.id}><i style={{ background: account.color }} /><span><strong>{account.name}</strong><small>{account.institution}</small></span><div><strong>{formatMoney(account.displayBalance, account.displayCurrency, locale)}</strong><small>{account.displayCurrency}</small></div><span className="balance-bar"><i style={{ width: `${Math.max(5, Math.min(100, Math.abs(account.displayBalance) / max * 100))}%`, background: account.color }} /></span></div>;
  })}</div> : <div className="empty-state">No accounts yet.</div>}</section>;
}

export default function ReportsPage() {
  const { accounts, transactions, costCenters, preferences, loading, error } = useFinanceData();
  const presentationValues = useMemo<CurrencyAmount[]>(() => [
    ...accounts.map((account) => ({ currency: account.currency, amount: account.balance })),
    ...transactions.map((transaction) => ({ currency: transaction.currency, amount: transaction.amount })),
  ], [accounts, transactions]);
  const currencyPresentation = useCurrencyPresentation(presentationValues, preferences.currency);
  const converted = currencyPresentation.mode === "converted" && currencyPresentation.rates;
  const displayTransactions = useMemo(() => converted ? convertedTransactions(transactions, preferences.currency, currencyPresentation.rates!) : transactions, [converted, currencyPresentation.rates, preferences.currency, transactions]);
  const views = useMemo(() => {
    if (converted) return [reportMetrics(preferences.currency, displayTransactions, preferences.timezone, preferences.locale)];
    return currenciesFor(transactions.map((transaction) => ({ currency: transaction.currency, amount: transaction.amount })))
      .map((currency) => reportMetrics(currency, transactions.filter((transaction) => transaction.currency === currency), preferences.timezone, preferences.locale));
  }, [converted, displayTransactions, preferences.currency, preferences.locale, preferences.timezone, transactions]);
  const flows = useMemo(() => transactionFlows(transactions, preferences.currency), [preferences.currency, transactions]);
  const net = useMemo(() => groupCurrencyAmounts([...flows.inflow, ...flows.outflow.map((value) => ({ ...value, amount: -value.amount }))], preferences.currency), [flows, preferences.currency]);
  const reportCurrency = converted ? preferences.currency : undefined;
  function exportJson() {
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify({ generatedAt: new Date().toISOString(), accounts, transactions, costCenters }, null, 2)], { type: "application/json" })); link.download = "orbit-report.json"; link.click(); URL.revokeObjectURL(link.href);
  }
  return <div className="page reports-page">
    <div className="page-heading"><div><div className="eyebrow">Financial story</div><h1>Reports</h1><p>Live calculations from your saved data.</p></div><div className="heading-actions"><button className="button secondary" disabled={!accounts.length && !transactions.length} onClick={exportJson}><Download size={16} /> Export report</button></div></div>
    {error && <div className="data-error"><strong>Could not connect to PostgreSQL.</strong><span>{error}</span><code>docker compose up -d</code></div>}
    {currencyPresentation.canConvert && <CurrencyModeControl targetCurrency={preferences.currency} mode={currencyPresentation.mode} setMode={currencyPresentation.setDisplayMode} loading={currencyPresentation.loading} error={currencyPresentation.error} providerLabel={currencyPresentation.providerLabel} rateDates={currencyPresentation.rateDates} onRefresh={() => void currencyPresentation.refresh()} />}
    <section className="report-kpis">
      <div className="panel"><span>Net income</span><strong><CurrencyAmounts values={net} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} /></strong><small><i>Income less expenses</i></small></div>
      <div className="panel"><span>Total recorded spend</span><strong><CurrencyAmounts values={flows.outflow} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} /></strong><small><i>Across {transactions.filter((transaction) => transaction.type === "Expense").length} expenses</i></small></div>
      <div className="panel"><span>Savings rate</span><strong className="currency-rates">{views.map((view) => <span key={view.currency}>{reportCurrency ? "" : `${view.currency} `}{view.rate.toFixed(1)}%</span>)}</strong><small><i>Based on recorded income</i></small></div>
    </section>
    {views.length ? views.map((view) => {
      const viewTransactions = displayTransactions.filter((transaction) => transaction.currency === view.currency);
      const centers = spendingByCenter(costCenters, viewTransactions);
      return <section className="report-currency-section" key={view.currency}>
        {!converted && <h2>{view.currency} report</h2>}
        <div className="report-grid">
          <section className="panel trend-panel"><div className="panel-head"><div><h2>Income vs. expenses</h2><p>Recorded cash flow over the last six months</p></div><div className="chart-legend"><span><i className="purple" />Income</span><span><i className="orange" />Expenses</span></div></div><div className="trend-summary"><div><small>Total income</small><strong>{formatMoney(view.income, view.currency, preferences.locale)}</strong></div><div><small>Total expenses</small><strong>{formatMoney(view.expense, view.currency, preferences.locale)}</strong></div><div><small>Difference</small><strong className={view.net >= 0 ? "positive" : "negative"}>{formatMoney(view.net, view.currency, preferences.locale)}</strong></div></div><TrendChart income={view.buckets.map((bucket) => bucket.income)} expense={view.buckets.map((bucket) => bucket.expense)} labels={view.buckets.map((bucket) => bucket.label)} currency={view.currency} locale={preferences.locale} /></section>
          <SpendPanel metrics={view} centers={centers} locale={preferences.locale} />
        </div>
      </section>;
    }) : <div className="empty-state">{loading ? "Loading…" : "No transactions to report yet."}</div>}
    <div className="report-grid report-balances"><AccountBalances accounts={accounts} mode={currencyPresentation.mode} targetCurrency={preferences.currency} rates={currencyPresentation.rates} locale={preferences.locale} /></div>
  </div>;
}
