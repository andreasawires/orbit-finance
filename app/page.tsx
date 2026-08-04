"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CreditCard, Eye, EyeOff, Landmark, Plus, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";
import { AccountForm, Modal, TransactionForm } from "@/components/modal";
import { TransactionList } from "@/components/transaction-list";
import { CurrencyAmounts, CurrencyModeControl, useCurrencyPresentation } from "@/components/currency-presentation";
import { groupCurrencyAmounts, transactionFlows } from "@/lib/currency-summary";
import { formatMoney, type Transaction } from "@/lib/data";
import { useFinanceData } from "@/lib/use-finance-data";

const filters = ["All", "Income", "Expense", "Transfer"];
const values = (form: FormData) => Object.fromEntries(form.entries());

export default function Dashboard() {
  const { accounts, transactions, costCenters, currencies, preferences, loading, error, mutate } = useFinanceData();
  const [filter, setFilter] = useState("All");
  const [showBalance, setShowBalance] = useState(true);
  const [accountModal, setAccountModal] = useState(false);
  const [transactionModal, setTransactionModal] = useState(false);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const visible = filter === "All" ? transactions.slice(0, 6) : transactions.filter((t) => t.type === filter).slice(0, 6);
  const totals = useMemo(() => {
    const balance = groupCurrencyAmounts(accounts.map((account) => ({ currency: account.currency, amount: account.balance })), preferences.currency);
    const flows = transactionFlows(transactions, preferences.currency);
    const net = groupCurrencyAmounts([
      ...flows.inflow,
      ...flows.outflow.map((value) => ({ ...value, amount: -value.amount })),
    ], preferences.currency);
    return { balance, ...flows, net };
  }, [accounts, preferences.currency, transactions]);
  const presentationValues = useMemo(() => [...totals.balance, ...totals.inflow, ...totals.outflow], [totals]);
  const currencyPresentation = useCurrencyPresentation(presentationValues, preferences.currency);

  return <div className="page dashboard-page">
    <div className="page-heading dashboard-heading">
      <div><div className="eyebrow">Overview</div><h1>Your finances</h1><p>A current view of the data stored in Orbit.</p></div>
      <button className="button primary" disabled={!accounts.length} onClick={() => setTransactionModal(true)}><Plus size={17} /> New transaction</button>
    </div>
    {error && <div className="data-error"><strong>Could not connect to PostgreSQL.</strong><span>{error}</span><code>docker compose up -d</code></div>}
    {currencyPresentation.canConvert && <CurrencyModeControl targetCurrency={preferences.currency} mode={currencyPresentation.mode} setMode={currencyPresentation.setDisplayMode} loading={currencyPresentation.loading} error={currencyPresentation.error} providerLabel={currencyPresentation.providerLabel} rateDates={currencyPresentation.rateDates} onRefresh={() => void currencyPresentation.refresh()} />}

    <section className="stats-grid">
      <div className="stat-card total-stat"><div className="stat-top"><span className="stat-icon purple"><WalletCards size={18} /></span><span>Across {accounts.length} account{accounts.length === 1 ? "" : "s"}</span><button className="icon-button mini" onClick={() => setShowBalance((v) => !v)}>{showBalance ? <Eye size={16} /> : <EyeOff size={16} />}</button></div><small>Total balance</small><strong>{showBalance ? <CurrencyAmounts values={totals.balance} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} /> : "••••••••"}</strong></div>
      <div className="stat-card"><div className="stat-top"><span className="stat-icon green"><ArrowDownRight size={18} /></span><span>Recorded</span></div><small>Total income</small><strong><CurrencyAmounts values={totals.inflow} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} sign="+" /></strong></div>
      <div className="stat-card"><div className="stat-top"><span className="stat-icon orange"><ArrowUpRight size={18} /></span><span>Recorded</span></div><small>Total expenses</small><strong><CurrencyAmounts values={totals.outflow} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} sign="−" /></strong></div>
      <div className="stat-card insight-stat"><span className="stat-icon lilac"><WalletCards size={18} /></span><div><small>Net cash flow</small><strong><CurrencyAmounts values={totals.net} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} /></strong><p>Income less expenses in the database.</p></div></div>
    </section>

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

    <section className="panel transactions-panel">
      <div className="panel-head transaction-panel-head"><div><h2>Latest transactions</h2><p>Your most recent saved activity</p></div><div className="inline-filters">{filters.map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><Link href="/transactions" className="view-all">View all <ArrowRight size={15} /></Link></div>
      {visible.length ? <TransactionList items={visible} compact locale={preferences.locale} onSelect={setSelected} /> : <div className="empty-state">{loading ? "Loading transactions…" : "No transactions to show."}</div>}
    </section>

    <Modal open={accountModal} onClose={() => setAccountModal(false)} title="Add a new account" subtitle="Accounts are stored in PostgreSQL." action="Add account" onSubmit={(form) => mutate("POST", { resource: "account", data: values(form) })}><AccountForm currencies={currencies} /></Modal>
    <Modal open={transactionModal || !!selected} onClose={() => { setTransactionModal(false); setSelected(null); setLinkMode(false); }} title={selected ? "Edit transaction" : "New transaction"} subtitle={selected ? `Update ${selected.merchant}.` : "Record a real transaction."} action={linkMode ? "Link as transfer" : selected ? "Save changes" : "Add transaction"} onSubmit={(form) => { const data = values(form); return mutate(selected ? "PATCH" : "POST", data.linkExistingTransfer ? { resource: "transactionTransferLink", id: selected?.id, data } : { resource: "transaction", id: selected?.id, data }); }}><TransactionForm accounts={accounts} costCenters={costCenters} currencies={currencies} transactions={transactions} transaction={selected} locale={preferences.locale} onTransferLinkModeChange={setLinkMode} /></Modal>
  </div>;
}
