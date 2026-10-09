"use client";

import { CreditCard, Landmark, MoreHorizontal, Plus, Search, Trash2, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { AccountForm, Modal } from "@/components/modal";
import { CurrencyAmounts, CurrencyModeControl, useCurrencyPresentation } from "@/components/currency-presentation";
import { groupCurrencyAmounts } from "@/lib/currency-summary";
import { formatMoney, type Account } from "@/lib/data";
import { useFinanceData } from "@/lib/use-finance-data";

const values = (form: FormData) => Object.fromEntries(form.entries());

export default function AccountsPage() {
  const { accounts, transactions, currencies, preferences, loading, error, mutate } = useFinanceData();
  const [modal, setModal] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);
  const deleteImpact = useMemo(() => {
    if (!deleting) return { own: 0, transfers: 0 };
    const own = transactions.filter((transaction) => transaction.accountId === deleting.id);
    return { own: own.length, transfers: own.filter((transaction) => transaction.transferId).length };
  }, [deleting, transactions]);
  const filtered = accounts.filter((a) => `${a.name} ${a.institution}`.toLowerCase().includes(query.toLowerCase()));
  const summary = useMemo(() => ({
    net: groupCurrencyAmounts(accounts.map((account) => ({ currency: account.currency, amount: account.balance })), preferences.currency),
    cash: groupCurrencyAmounts(accounts.filter((account) => account.balance >= 0).map((account) => ({ currency: account.currency, amount: account.balance })), preferences.currency),
    credit: groupCurrencyAmounts(accounts.filter((account) => account.balance < 0).map((account) => ({ currency: account.currency, amount: Math.abs(account.balance) })), preferences.currency),
  }), [accounts, preferences.currency]);
  const presentationValues = useMemo(() => [...summary.net, ...summary.cash, ...summary.credit], [summary]);
  const currencyPresentation = useCurrencyPresentation(presentationValues, preferences.currency);
  return <div className="page">
    <div className="page-heading"><div><div className="eyebrow">Money map</div><h1>Accounts</h1><p>Balances are calculated from opening balances and transactions.</p></div><button className="button primary" onClick={() => setModal(true)}><Plus size={17} /> New account</button></div>
    {error && <div className="data-error"><strong>Could not connect to PostgreSQL.</strong><span>{error}</span><code>docker compose up -d</code></div>}
    {currencyPresentation.canConvert && <CurrencyModeControl targetCurrency={preferences.currency} mode={currencyPresentation.mode} setMode={currencyPresentation.setDisplayMode} loading={currencyPresentation.loading} error={currencyPresentation.error} providerLabel={currencyPresentation.providerLabel} rateDates={currencyPresentation.rateDates} onRefresh={() => void currencyPresentation.refresh()} />}
    <div className="account-summary panel">
      <div><span className="summary-orb"><WalletCards size={21} /></span><div><small>Total net balance</small><strong><CurrencyAmounts values={summary.net} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} /></strong></div></div>
      <div className="summary-metric"><small>Cash available</small><strong><CurrencyAmounts values={summary.cash} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} /></strong></div>
      <div className="summary-metric"><small>Credit used</small><strong><CurrencyAmounts values={summary.credit} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} /></strong></div>
      <div className="summary-metric"><small>Accounts</small><strong>{accounts.length}</strong><span>{new Set(accounts.map((a) => a.institution).filter(Boolean)).size} institutions</span></div>
    </div>
    <div className="list-toolbar"><div className="toolbar-search"><Search size={17} /><input placeholder="Search accounts..." value={query} onChange={(e) => setQuery(e.target.value)} /></div><div className="account-view-label">{filtered.length} accounts</div></div>
    <div className="accounts-grid">
      {filtered.map((account) => <button className="account-detail-card panel" key={account.id} onClick={() => setSelected(account)} style={{ "--account-color": account.color } as React.CSSProperties}>
        <div className="account-detail-head"><span className="account-large-logo">{account.kind === "Credit card" ? <CreditCard size={22} /> : <Landmark size={22} />}</span><span className="status-dot">Saved</span><MoreHorizontal size={19} /></div>
        <div className="account-detail-title"><h3>{account.name}</h3><p>{account.institution}{account.institution ? " · " : ""}{account.kind}</p></div>
        <div className="account-detail-balance"><small>Current balance</small><strong>{formatMoney(account.balance, account.currency, preferences.locale)}</strong><span>{account.currency}</span></div>
      </button>)}
      <button className="account-detail-add" onClick={() => setModal(true)}><span><Plus size={23} /></span><strong>Add another account</strong><small>Save an account manually</small></button>
    </div>
    {!loading && !filtered.length && !error && <div className="inline-empty">{query ? "No accounts match your search." : "No accounts yet."}</div>}
    <Modal open={modal || !!selected} onClose={() => { setModal(false); setSelected(null); }} footerStart={selected ? <button type="button" className="button danger" onClick={() => { setDeleting(selected); setSelected(null); }}><Trash2 size={15} /> Delete account</button> : null} title={selected ? `Edit ${selected.name}` : "Add a new account"} action={selected ? "Save changes" : "Add account"} onSubmit={(form) => mutate(selected ? "PATCH" : "POST", { resource: "account", id: selected?.id, data: values(form) })}><AccountForm account={selected} currencies={currencies} /></Modal>
    <ConfirmDeleteDialog open={!!deleting} onClose={() => setDeleting(null)} title={`Delete ${deleting?.name ?? "account"}?`} confirmText={deleting?.name ?? ""}
      impact={<><strong>The account and everything recorded in it will be permanently deleted.</strong><ul>
        <li>{deleteImpact.own} transaction{deleteImpact.own === 1 ? "" : "s"}</li>
        {deleteImpact.transfers > 0 && <li>{deleteImpact.transfers} transfer{deleteImpact.transfers === 1 ? "" : "s"}, including the matching entries on the other accounts</li>}
        <li>Its import history and uploaded statements</li>
      </ul></>}
      onConfirm={(confirmName) => mutate("DELETE", { resource: "account", id: deleting?.id, data: { confirmName } })} />
  </div>;
}
