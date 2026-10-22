"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CreditCard, Eye, EyeOff, Landmark, Plus, Trash2, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { DateRangeFilter } from "@/components/date-range-filter";
import { AccountForm, BatchTransactionForm, Modal, TransactionForm } from "@/components/modal";
import { Pagination } from "@/components/pagination";
import { TransactionList } from "@/components/transaction-list";
import { CurrencyAmounts, CurrencyModeControl, useCurrencyPresentation } from "@/components/currency-presentation";
import { usePageFilters } from "@/components/view-state-provider";
import { groupCurrencyAmounts } from "@/lib/currency-summary";
import { formatMoney, type FinanceReport, type Transaction, type TransactionPage } from "@/lib/data";
import { DATE_RANGE_LABELS, DEFAULT_DATE_RANGE, formatDateRange, type DateRangeSelection } from "@/lib/date-range";
import { formatDate } from "@/lib/time";
import { DEFAULT_TRANSACTION_QUERY, OVERVIEW_PAGE_SIZES, reportSearchParams, transactionSearchParams, type TransactionFilters } from "@/lib/transaction-query";
import { useFinanceData } from "@/lib/use-finance-data";
import { useServerQuery } from "@/lib/use-server-query";

const filters: Array<{ label: string; type: TransactionFilters["type"] }> = [{ label: "All", type: "" }, { label: "Income", type: "Income" }, { label: "Expense", type: "Expense" }, { label: "Transfer", type: "Transfer" }];
const values = (form: FormData) => Object.fromEntries(form.entries());
const defaultFilters: { range: DateRangeSelection; type: TransactionFilters["type"]; page: number; pageSize: number } = { range: DEFAULT_DATE_RANGE, type: "", page: 1, pageSize: OVERVIEW_PAGE_SIZES[0] };

export default function Dashboard() {
  const { accounts, costCenters, currencies, preferences, loading, error, mutate } = useFinanceData();
  const [view, updateView] = usePageFilters("overview", defaultFilters);
  const list = useServerQuery<TransactionPage>("/api/transactions", transactionSearchParams({ ...DEFAULT_TRANSACTION_QUERY, range: view.range, type: view.type, page: view.page, pageSize: view.pageSize }));
  const report = useServerQuery<FinanceReport>("/api/reports", reportSearchParams(view.range, "auto"));
  const [showBalance, setShowBalance] = useState(true);
  const [accountModal, setAccountModal] = useState(false);
  const [transactionModal, setTransactionModal] = useState(false);
  const [newCount, setNewCount] = useState(1);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const deletingCounterpart = deleting?.transferAccountId ? accounts.find((account) => account.id === deleting.transferAccountId)?.name ?? "another account" : "";
  const visible = list.data?.items ?? [];
  const rangeLabel = DATE_RANGE_LABELS[view.range.preset];
  const totals = useMemo(() => {
    const balance = groupCurrencyAmounts(accounts.map((account) => ({ currency: account.currency, amount: account.balance })), preferences.currency);
    const periods = report.data?.currencies ?? [];
    const inflow = groupCurrencyAmounts(periods.map((period) => ({ currency: period.currency, amount: period.income })), preferences.currency);
    const outflow = groupCurrencyAmounts(periods.map((period) => ({ currency: period.currency, amount: period.expense })), preferences.currency);
    const net = groupCurrencyAmounts(periods.map((period) => ({ currency: period.currency, amount: period.net })), preferences.currency);
    return { balance, inflow, outflow, net };
  }, [accounts, preferences.currency, report.data]);
  const presentationValues = useMemo(() => [...totals.balance, ...totals.inflow, ...totals.outflow], [totals]);
  const currencyPresentation = useCurrencyPresentation(presentationValues, preferences.currency);

  return <div className="page dashboard-page">
    <div className="page-heading dashboard-heading">
      <div><div className="eyebrow">Overview</div><h1>Your finances</h1><p>A current view of the data stored in Orbit.</p></div>
      <div className="heading-actions"><DateRangeFilter value={view.range} onChange={(range) => updateView({ range })} timeZone={preferences.timezone} locale={preferences.locale} /><button className="button primary" disabled={!accounts.length} onClick={() => { setNewCount(1); setTransactionModal(true); }}><Plus size={17} /> New transaction</button></div>
    </div>
    {error && <div className="data-error"><strong>Could not connect to PostgreSQL.</strong><span>{error}</span><code>docker compose up -d</code></div>}
    <section className="section-block">
      <div className="section-title"><div><h2>Your accounts</h2><p>Balances across all saved accounts</p></div><Link href="/accounts">Manage accounts <ArrowRight size={15} /></Link></div>
      <div className="account-scroll">
        {accounts.map((account) => <Link href="/accounts" className="account-card" key={account.id} style={{ "--account-color": account.color } as React.CSSProperties}>
          <div className="account-card-top"><span className="account-logo">{account.kind === "Credit card" ? <CreditCard size={19} /> : <Landmark size={19} />}</span><span className="account-kind">{account.kind}</span><ArrowUpRight size={17} /></div>
          <div className="account-name"><strong>{account.name}</strong><span>{account.institution}{account.number ? ` · ${account.number}` : ""}</span></div>
          <div className="account-balance"><small>Current balance</small><strong>{formatMoney(account.balance, account.currency, preferences.locale)}</strong><span>{account.currency}</span></div>
        </Link>)}
        <button className="add-account-card" onClick={() => setAccountModal(true)}><span><Plus size={22} /></span><strong>Add account</strong><small>Add an account manually</small></button>
      </div>
      {!loading && !accounts.length && !error && <div className="inline-empty">No accounts yet. Add one to start recording transactions.</div>}
    </section>

    {currencyPresentation.canConvert && <CurrencyModeControl targetCurrency={preferences.currency} mode={currencyPresentation.mode} setMode={currencyPresentation.setDisplayMode} loading={currencyPresentation.loading} error={currencyPresentation.error} providerLabel={currencyPresentation.providerLabel} rateDates={currencyPresentation.rateDates} onRefresh={() => void currencyPresentation.refresh()} />}

    <section className="stats-grid">
      <div className="stat-card total-stat"><div className="stat-top"><span className="stat-icon purple"><WalletCards size={18} /></span><span>Current · {accounts.length} account{accounts.length === 1 ? "" : "s"}</span><button className="icon-button mini" onClick={() => setShowBalance((v) => !v)}>{showBalance ? <Eye size={16} /> : <EyeOff size={16} />}</button></div><small>Total balance</small><strong>{showBalance ? <CurrencyAmounts values={totals.balance} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} /> : "••••••••"}</strong></div>
      <div className="stat-card"><div className="stat-top"><span className="stat-icon green"><ArrowDownRight size={18} /></span><span>{rangeLabel}</span></div><small>Total income</small><strong><CurrencyAmounts values={totals.inflow} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} sign="+" /></strong></div>
      <div className="stat-card"><div className="stat-top"><span className="stat-icon orange"><ArrowUpRight size={18} /></span><span>{rangeLabel}</span></div><small>Total expenses</small><strong><CurrencyAmounts values={totals.outflow} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} sign="−" /></strong></div>
      <div className="stat-card insight-stat"><span className="stat-icon lilac"><WalletCards size={18} /></span><div><small>Net cash flow</small><strong><CurrencyAmounts values={totals.net} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} /></strong><p>Income less expenses · {report.data ? formatDateRange(report.data.range, preferences.locale) : rangeLabel.toLowerCase()}.</p></div></div>
    </section>

    <section className="panel transactions-panel">
      <div className="panel-head transaction-panel-head"><div><h2>Latest transactions</h2><p>{rangeLabel}{list.data ? ` · ${formatDateRange(list.data.range, preferences.locale)}` : ""}</p></div><div className="inline-filters">{filters.map((item) => <button key={item.label} className={view.type === item.type ? "active" : ""} onClick={() => updateView({ type: item.type })}>{item.label}</button>)}</div><Link href="/transactions" className="view-all">View all <ArrowRight size={15} /></Link></div>
      {list.error && <div className="form-error">{list.error}</div>}
      {visible.length ? <TransactionList items={visible} compact locale={preferences.locale} timeZone={preferences.timezone} onSelect={setSelected} /> : <div className="empty-state">{loading || (list.loading && !list.data) ? "Loading transactions…" : "No transactions in this period."}</div>}
      {list.data && list.data.total > 0 && <Pagination page={list.data.page} pageCount={list.data.pageCount} pageSize={list.data.pageSize} total={list.data.total} pageSizes={OVERVIEW_PAGE_SIZES} onPageChange={(page) => updateView({ page })} onPageSizeChange={(pageSize) => updateView({ pageSize })} />}
    </section>

    <Modal open={accountModal} onClose={() => setAccountModal(false)} title="Add a new account" action="Add account" onSubmit={(form) => mutate("POST", { resource: "account", data: values(form) })}><AccountForm currencies={currencies} /></Modal>
    <Modal open={!!selected} onClose={() => { setSelected(null); setLinkMode(false); }} footerStart={<button type="button" className="button danger" onClick={() => { setDeleting(selected); setSelected(null); setLinkMode(false); }}><Trash2 size={15} /> Delete</button>} title="Edit transaction" subtitle={selected ? `Update ${selected.merchant}.` : undefined} action={linkMode ? "Link as transfer" : "Save changes"} onSubmit={(form) => { const data = values(form); return mutate("PATCH", data.linkExistingTransfer ? { resource: "transactionTransferLink", id: selected?.id, data } : { resource: "transaction", id: selected?.id, data }); }}><TransactionForm accounts={accounts} costCenters={costCenters} currencies={currencies} transaction={selected} locale={preferences.locale} timeZone={preferences.timezone} onTransferLinkModeChange={setLinkMode} /></Modal>
    <Modal wide open={transactionModal} onClose={() => setTransactionModal(false)} title="New transactions" subtitle="One line per transaction. Use + to add more." action={newCount === 1 ? "Add transaction" : `Add ${newCount} transactions`} onSubmit={(form) => mutate("POST", { resource: "transactions", data: { items: JSON.parse(String(form.get("batch"))) } })}><BatchTransactionForm accounts={accounts} costCenters={costCenters} timeZone={preferences.timezone} onCountChange={setNewCount} /></Modal>
    <ConfirmDeleteDialog open={!!deleting} onClose={() => setDeleting(null)} title="Delete transaction?" confirmText={deleting?.merchant ?? ""}
      impact={deleting?.transferId
        ? <><strong>This transfer will be permanently deleted.</strong><span>Both sides are removed: {deleting.amount < 0 ? `${deleting.account} → ${deletingCounterpart}` : `${deletingCounterpart} → ${deleting.account}`}.</span></>
        : <><strong>This transaction will be permanently deleted.</strong><span>{deleting ? `${formatMoney(deleting.amount, deleting.currency, preferences.locale)} · ${formatDate(deleting.occurredAt, preferences.timezone, preferences.locale)} · ${deleting.account}` : ""}</span></>}
      onConfirm={(confirmName) => mutate("DELETE", { resource: "transaction", id: deleting?.id, data: { confirmName } })} />
  </div>;
}
