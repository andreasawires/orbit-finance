"use client";

import { ArrowDownRight, ArrowUpRight, Download, Info } from "lucide-react";
import { useMemo } from "react";
import { formatMoney } from "@/lib/data";
import { useFinanceData } from "@/lib/use-finance-data";

function TrendChart({ income, expense, months }: { income: number[]; expense: number[]; months: string[] }) {
  const max = Math.max(1, ...income, ...expense);
  const points = (values: number[]) => values.map((v, i) => `${i * 20},${100 - (v / max) * 85}`).join(" ");
  return <div className="trend-chart"><div className="chart-y"><span>{formatMoney(max, "USD", "en-US").replace(".00", "")}</span><span>{formatMoney(max / 2, "USD", "en-US").replace(".00", "")}</span><span>$0</span></div><div className="chart-area"><div className="grid-lines"><i /><i /><i /></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Income and expense trend"><defs><linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#573cf0" stopOpacity=".22"/><stop offset="1" stopColor="#573cf0" stopOpacity="0"/></linearGradient></defs><polygon points={`0,100 ${points(income)} 100,100`} fill="url(#incomeFill)"/><polyline points={points(income)} fill="none" stroke="#573cf0" strokeWidth="1.8" vectorEffect="non-scaling-stroke"/><polyline points={points(expense)} fill="none" stroke="#e59566" strokeWidth="1.8" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"/></svg><div className="chart-x">{months.map((m) => <span key={m}>{m}</span>)}</div></div></div>;
}

export default function ReportsPage() {
  const { accounts, transactions, costCenters, preferences, loading, error } = useFinanceData();
  const report = useMemo(() => {
    const now = new Date();
    const buckets = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1));
      return { key: date.toISOString().slice(0, 7), label: date.toLocaleString("en", { month: "short", timeZone: "UTC" }), income: 0, expense: 0 };
    });
    for (const transaction of transactions) {
      const bucket = buckets.find((item) => item.key === transaction.occurredOn.slice(0, 7));
      if (!bucket) continue;
      if (transaction.type === "Income") bucket.income += transaction.amount;
      if (transaction.type === "Expense") bucket.expense += Math.abs(transaction.amount);
    }
    const income = transactions.filter((t) => t.type === "Income").reduce((sum, t) => sum + t.amount, 0);
    const expense = Math.abs(transactions.filter((t) => t.type === "Expense").reduce((sum, t) => sum + t.amount, 0));
    return { buckets, income, expense, net: income - expense, rate: income ? ((income - expense) / income) * 100 : 0 };
  }, [transactions]);
  const money = (amount: number, currency = preferences.currency) => formatMoney(amount, currency, preferences.locale);
  const spendCenters = costCenters.map((center) => ({ ...center, total: center.amount + center.children.reduce((sum, child) => sum + child.amount, 0) })).filter((center) => center.total > 0);
  const totalSpend = spendCenters.reduce((sum, center) => sum + center.total, 0);
  const gradient = spendCenters.length ? `conic-gradient(${spendCenters.map((center, index) => `${center.color} ${(spendCenters.slice(0, index).reduce((s, c) => s + c.total, 0) / totalSpend) * 100}% ${(spendCenters.slice(0, index + 1).reduce((s, c) => s + c.total, 0) / totalSpend) * 100}%`).join(",")})` : "var(--line)";
  function exportJson() {
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify({ generatedAt: new Date().toISOString(), accounts, transactions, costCenters }, null, 2)], { type: "application/json" })); link.download = "orbit-report.json"; link.click(); URL.revokeObjectURL(link.href);
  }
  return <div className="page reports-page">
    <div className="page-heading"><div><div className="eyebrow">Financial story</div><h1>Reports</h1><p>Live calculations from your saved data.</p></div><div className="heading-actions"><button className="button secondary" disabled={!accounts.length && !transactions.length} onClick={exportJson}><Download size={16} /> Export report</button></div></div>
    {error && <div className="data-error"><strong>Could not connect to PostgreSQL.</strong><span>{error}</span><code>docker compose up -d</code></div>}
    <section className="report-kpis">
      <div className="panel"><span>Net income</span><strong>{money(report.net)}</strong><small className={report.net >= 0 ? "positive" : "negative"}>{report.net >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />} Income less expenses</small></div>
      <div className="panel"><span>Total recorded spend</span><strong>{money(report.expense)}</strong><small><i>Across {transactions.filter((t) => t.type === "Expense").length} expenses</i></small></div>
      <div className="panel"><span>Savings rate</span><strong>{report.rate.toFixed(1)}%</strong><small><i>Based on recorded income</i></small></div>
    </section>
    <div className="report-grid">
      <section className="panel trend-panel"><div className="panel-head"><div><h2>Income vs. expenses</h2><p>Recorded cash flow over the last six months</p></div><div className="chart-legend"><span><i className="purple" />Income</span><span><i className="orange" />Expenses</span></div></div><div className="trend-summary"><div><small>Total income</small><strong>{money(report.income)}</strong></div><div><small>Total expenses</small><strong>{money(report.expense)}</strong></div><div><small>Difference</small><strong className={report.net >= 0 ? "positive" : "negative"}>{money(report.net)}</strong></div></div><TrendChart income={report.buckets.map((b) => b.income)} expense={report.buckets.map((b) => b.expense)} months={report.buckets.map((b) => b.label)} /></section>
      <section className="panel spend-panel"><div className="panel-head"><div><h2>Spending by cost center</h2><p>All recorded expenses</p></div><span title="Only categorized expenses are included"><Info size={17} /></span></div>{spendCenters.length ? <div className="spend-content"><div className="donut" style={{ background: gradient }}><div><strong>{money(totalSpend)}</strong><span>Total categorized</span></div></div><div className="spend-list">{spendCenters.map((center) => <div key={center.id}><i style={{ background: center.color }} /><span><strong>{center.name}</strong><small>{totalSpend ? Math.round(center.total / totalSpend * 100) : 0}%</small></span><b>{money(center.total)}</b></div>)}</div></div> : <div className="empty-state">{loading ? "Loading…" : "No categorized expenses yet."}</div>}</section>
      <section className="panel balances-panel"><div className="panel-head"><div><h2>Account balances</h2><p>Calculated from your transaction ledger</p></div><span className="tag">Live</span></div>{accounts.length ? <div className="balance-list">{accounts.map((account) => <div key={account.id}><i style={{ background: account.color }} /><span><strong>{account.name}</strong><small>{account.institution}</small></span><div><strong>{money(account.balance, account.currency)}</strong><small>{account.currency}</small></div><span className="balance-bar"><i style={{ width: `${Math.max(5, Math.min(100, Math.abs(account.balance) / Math.max(1, ...accounts.map((a) => Math.abs(a.balance))) * 100))}%`, background: account.color }} /></span></div>)}</div> : <div className="empty-state">No accounts yet.</div>}</section>
    </div>
  </div>;
}
