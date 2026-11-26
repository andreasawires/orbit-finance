"use client";

import { Bitcoin, CreditCard, Landmark, MoreHorizontal, Plus, RefreshCw, Search, Trash2, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { AccountForm, Modal, WALLET_ACCOUNT_KIND } from "@/components/modal";
import { CurrencyAmounts, CurrencyModeControl, useCurrencyPresentation } from "@/components/currency-presentation";
import { groupCurrencyAmounts } from "@/lib/currency-summary";
import { formatMoney, type Account } from "@/lib/data";
import { useFinanceData } from "@/lib/use-finance-data";

const values = (form: FormData) => Object.fromEntries(form.entries());

function syncedLabel(account: Account, syncing: boolean) {
  if (syncing) return "Syncing…";
  if (account.wallet?.lastSyncError) return "Sync failed";
  if (!account.wallet?.lastSyncedAt) return "Not synced yet";
  const minutes = Math.floor((Date.now() - new Date(account.wallet.lastSyncedAt).getTime()) / 60_000);
  return minutes < 1 ? "Synced just now" : minutes < 60 ? `Synced ${minutes} min ago` : `Synced ${Math.floor(minutes / 60)} h ago`;
}

export default function AccountsPage() {
  const { accounts, currencies, preferences, loading, error, mutate, syncWallets } = useFinanceData();
  const [syncing, setSyncing] = useState<Set<string>>(new Set());
  const [syncError, setSyncError] = useState("");
  const syncedOnLoad = useRef(false);
  const hasWallets = accounts.some((account) => account.wallet);

  async function runSync(ids: string[], body: { accountId?: string; force?: boolean }) {
    setSyncing((current) => new Set([...current, ...ids]));
    setSyncError("");
    try { await syncWallets(body); }
    catch (caught) { setSyncError(caught instanceof Error ? caught.message : "Could not sync wallets"); }
    finally { setSyncing((current) => new Set([...current].filter((id) => !ids.includes(id)))); }
  }

  // Wallets catch up once each time the page is opened (the server skips wallets synced in the last minute).
  useEffect(() => {
    if (loading || !hasWallets || syncedOnLoad.current) return;
    syncedOnLoad.current = true;
    void runSync(accounts.filter((account) => account.wallet).map((account) => account.id), {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, hasWallets]);
  const [modal, setModal] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);
  const deleteImpact = { own: deleting?.transactionCount ?? 0, transfers: deleting?.transferCount ?? 0 };
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
    {syncError && <div className="form-error">Wallet sync: {syncError}</div>}
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
        <div className="account-detail-head"><span className="account-large-logo">{account.wallet ? <Bitcoin size={22} /> : account.kind === "Credit card" ? <CreditCard size={22} /> : <Landmark size={22} />}</span>
          {account.wallet
            ? <><span className="status-dot" title={account.wallet.lastSyncError ?? account.wallet.address}>{syncedLabel(account, syncing.has(account.id))}</span>
              <span role="button" tabIndex={0} className="icon-button" aria-label={`Sync ${account.name}`} title="Sync now"
                onClick={(event) => { event.stopPropagation(); if (!syncing.has(account.id)) void runSync([account.id], { accountId: account.id, force: true }); }}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); if (!syncing.has(account.id)) void runSync([account.id], { accountId: account.id, force: true }); } }}>
                <RefreshCw size={16} className={syncing.has(account.id) ? "spin" : undefined} /></span></>
            : <><span className="status-dot">Saved</span><MoreHorizontal size={19} /></>}</div>
        <div className="account-detail-title"><h3>{account.name}</h3><p>{account.institution}{account.institution ? " · " : ""}{account.kind}</p></div>
        <div className="account-detail-balance"><small>Current balance</small><strong>{formatMoney(account.balance, account.currency, preferences.locale)}</strong><span>{account.currency}</span></div>
      </button>)}
      <button className="account-detail-add" onClick={() => setModal(true)}><span><Plus size={23} /></span><strong>Add another account</strong><small>Save an account manually</small></button>
    </div>
    {!loading && !filtered.length && !error && <div className="inline-empty">{query ? "No accounts match your search." : "No accounts yet."}</div>}
    <Modal open={modal || !!selected} onClose={() => { setModal(false); setSelected(null); }} footerStart={selected ? <button type="button" className="button danger" onClick={() => { setDeleting(selected); setSelected(null); }}><Trash2 size={15} /> Delete account</button> : null} title={selected ? `Edit ${selected.name}` : "Add a new account"} action={selected ? "Save changes" : "Add account"} onSubmit={(form) => !selected && form.get("kind") === WALLET_ACCOUNT_KIND
      ? mutate("POST", { resource: "btcWallet", data: values(form) })
      : mutate(selected ? "PATCH" : "POST", { resource: "account", id: selected?.id, data: values(form) })}><AccountForm account={selected} currencies={currencies} /></Modal>
    <ConfirmDeleteDialog open={!!deleting} onClose={() => setDeleting(null)} title={`Delete ${deleting?.name ?? "account"}?`} confirmText={deleting?.name ?? ""}
      impact={<><strong>The account and everything recorded in it will be permanently deleted.</strong><ul>
        <li>{deleteImpact.own} transaction{deleteImpact.own === 1 ? "" : "s"}</li>
        {deleteImpact.transfers > 0 && <li>{deleteImpact.transfers} transfer{deleteImpact.transfers === 1 ? "" : "s"}, including the matching entries on the other accounts</li>}
        <li>{deleting?.wallet ? "Its synced blockchain history (the wallet itself is not affected)" : "Its import history and uploaded statements"}</li>
      </ul></>}
      onConfirm={(confirmName) => mutate("DELETE", { resource: "account", id: deleting?.id, data: { confirmName } })} />
  </div>;
}
