"use client";

import { CreditCard, Landmark, MoreHorizontal, Plus, Search, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";
import { AccountForm, Modal } from "@/components/modal";
import { formatMoney, type Account } from "@/lib/data";
import { useFinanceData } from "@/lib/use-finance-data";

const values = (form: FormData) => Object.fromEntries(form.entries());

export default function AccountsPage() {
  const { accounts, currencies, preferences, loading, error, mutate } = useFinanceData();
  const [modal, setModal] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Account | null>(null);
  const filtered = accounts.filter((a) => `${a.name} ${a.institution}`.toLowerCase().includes(query.toLowerCase()));
  const summary = useMemo(() => ({
    net: accounts.reduce((sum, a) => sum + a.balance, 0),
    cash: accounts.filter((a) => a.balance >= 0).reduce((sum, a) => sum + a.balance, 0),
    credit: Math.abs(accounts.filter((a) => a.balance < 0).reduce((sum, a) => sum + a.balance, 0)),
  }), [accounts]);
  const money = (amount: number) => formatMoney(amount, preferences.currency, preferences.locale);
  return <div className="page">
    <div className="page-heading"><div><div className="eyebrow">Money map</div><h1>Accounts</h1><p>Balances are calculated from opening balances and transactions.</p></div><button className="button primary" onClick={() => setModal(true)}><Plus size={17} /> New account</button></div>
    {error && <div className="data-error"><strong>Could not connect to PostgreSQL.</strong><span>{error}</span><code>docker compose up -d</code></div>}
    <div className="account-summary panel">
      <div><span className="summary-orb"><WalletCards size={21} /></span><div><small>Total net balance</small><strong>{money(summary.net)}</strong></div></div>
      <div className="summary-metric"><small>Cash available</small><strong>{money(summary.cash)}</strong></div>
      <div className="summary-metric"><small>Credit used</small><strong>{money(summary.credit)}</strong></div>
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
    <Modal open={modal || !!selected} onClose={() => { setModal(false); setSelected(null); }} title={selected ? `Edit ${selected.name}` : "Add a new account"} action={selected ? "Save changes" : "Add account"} onSubmit={(form) => mutate(selected ? "PATCH" : "POST", { resource: "account", id: selected?.id, data: values(form) })}><AccountForm account={selected} currencies={currencies} /></Modal>
  </div>;
}
