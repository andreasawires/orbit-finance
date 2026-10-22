"use client";

import { Check, ChevronDown, Download, FolderTree, Plus, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { BatchTransactionForm, Modal, TransactionForm } from "@/components/modal";
import { TransactionList } from "@/components/transaction-list";
import { CurrencyAmounts, CurrencyModeControl, useCurrencyPresentation } from "@/components/currency-presentation";
import { transactionFlows } from "@/lib/currency-summary";
import { flattenCostCenters, formatMoney, type Transaction } from "@/lib/data";
import { formatDate, utcToZonedDate } from "@/lib/time";
import { useFinanceData } from "@/lib/use-finance-data";

const types = ["All types", "Income", "Expense", "Transfer"];
const values = (form: FormData) => Object.fromEntries(form.entries());

export default function TransactionsPage() {
  const { accounts, transactions, costCenters, currencies, preferences, loading, error, mutate } = useFinanceData();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("All types");
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [accountFilterOpen, setAccountFilterOpen] = useState(false);
  const [modal, setModal] = useState(false);
  const [newCount, setNewCount] = useState(1);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkModal, setBulkModal] = useState(false);
  const deletingCounterpart = deleting?.transferAccountId ? accounts.find((account) => account.id === deleting.transferAccountId)?.name ?? "another account" : "";
  const accountFilterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accountFilterOpen) return;
    const closeWhenClickingAway = (event: PointerEvent) => {
      if (!accountFilterRef.current?.contains(event.target as Node)) setAccountFilterOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountFilterOpen(false);
    };
    document.addEventListener("pointerdown", closeWhenClickingAway);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenClickingAway);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountFilterOpen]);

  const filtered = useMemo(() => transactions.filter((t) => {
    const matchesQuery = `${t.merchant} ${t.detail} ${t.costCenter}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (type === "All types" || t.type === type) && (!selectedAccountIds.length || selectedAccountIds.includes(t.accountId));
  }), [transactions, query, type, selectedAccountIds]);
  const activeFilters = useMemo(() => [
    ...(type !== "All types" ? [{ id: "type", label: type, kind: "type" as const }] : []),
    ...selectedAccountIds.map((accountId) => ({ id: accountId, label: accounts.find((account) => account.id === accountId)?.name ?? "Account", kind: "account" as const })),
  ], [accounts, selectedAccountIds, type]);
  const accountFilterLabel = selectedAccountIds.length === 0 ? "All accounts" : selectedAccountIds.length === 1 ? accounts.find((account) => account.id === selectedAccountIds[0])?.name ?? "1 account" : `${selectedAccountIds.length} accounts`;
  const flows = useMemo(() => transactionFlows(filtered, preferences.currency), [filtered, preferences.currency]);
  const presentationValues = useMemo(() => [...flows.inflow, ...flows.outflow], [flows]);
  const currencyPresentation = useCurrencyPresentation(presentationValues, preferences.currency);
  // Only rows still visible under the current filters count, so a hidden selection is never updated by accident.
  const bulkIds = useMemo(() => filtered.filter((t) => t.type !== "Transfer" && selectedIds.has(t.id)).map((t) => t.id), [filtered, selectedIds]);
  const centers = useMemo(() => flattenCostCenters(costCenters), [costCenters]);

  function toggleAccount(accountId: string) {
    setSelectedAccountIds((current) => current.includes(accountId) ? current.filter((id) => id !== accountId) : [...current, accountId]);
  }

  function toggleSelected(ids: string[], checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => { if (checked) next.add(id); else next.delete(id); });
      return next;
    });
  }

  function exportCsv() {
    const csv = [["Date", "Description", "Note", "Type", "Account", "Cost center", "Amount", "Currency"], ...filtered.map((t) => [utcToZonedDate(t.occurredAt, preferences.timezone), t.merchant, t.detail, t.type, t.account, t.costCenter, String(t.amount), t.currency])]
      .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = "orbit-transactions.csv"; link.click(); URL.revokeObjectURL(link.href);
  }

  return <div className="page transactions-page">
    <div className="page-heading"><div><div className="eyebrow">Activity ledger</div><h1>Transactions</h1><p>Search and manage saved movements.</p></div><div className="heading-actions"><button className="button secondary" disabled={!filtered.length} onClick={exportCsv}><Download size={16} /> Export</button><button className="button primary" disabled={!accounts.length} onClick={() => { setNewCount(1); setModal(true); }}><Plus size={17} /> New transaction</button></div></div>
    {error && <div className="data-error"><strong>Could not connect to PostgreSQL.</strong><span>{error}</span><code>docker compose up -d</code></div>}
    <section className="panel transaction-workspace">
      <div className="transaction-toolbar">
        <div className="transaction-search"><Search size={17} /><input placeholder="Search by description, note, or cost center..." value={query} onChange={(e) => setQuery(e.target.value)} />{query && <button onClick={() => setQuery("")}><X size={14} /></button>}</div>
        <label className="filter-select"><SlidersHorizontal size={16} /><select value={type} onChange={(e) => setType(e.target.value)}>{types.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label>
        <div className="account-filter" ref={accountFilterRef}>
          <button className="filter-select account-filter-trigger" type="button" aria-haspopup="dialog" aria-expanded={accountFilterOpen} onClick={() => setAccountFilterOpen((open) => !open)}><span>{accountFilterLabel}</span><ChevronDown size={14} /></button>
          {accountFilterOpen && <div className="account-filter-menu popover" role="group" aria-label="Filter by account">
            <label className="account-filter-option">
              <input type="checkbox" checked={selectedAccountIds.length === 0} onChange={() => setSelectedAccountIds([])} />
              <span className="account-filter-check"><Check size={13} /></span>
              <span>All accounts</span>
            </label>
            {accounts.map((item) => <label className="account-filter-option" key={item.id}>
              <input type="checkbox" checked={selectedAccountIds.includes(item.id)} onChange={() => toggleAccount(item.id)} />
              <span className="account-filter-check"><Check size={13} /></span>
              <span>{item.name}</span>
            </label>)}
          </div>}
        </div>
      </div>
      {currencyPresentation.canConvert && <CurrencyModeControl targetCurrency={preferences.currency} mode={currencyPresentation.mode} setMode={currencyPresentation.setDisplayMode} loading={currencyPresentation.loading} error={currencyPresentation.error} providerLabel={currencyPresentation.providerLabel} rateDates={currencyPresentation.rateDates} onRefresh={() => void currencyPresentation.refresh()} />}
      {activeFilters.length > 0 && <div className="active-filters"><span>Active filters</span>{activeFilters.map((filter) => <button key={`${filter.kind}-${filter.id}`} onClick={() => { if (filter.kind === "type") setType("All types"); else setSelectedAccountIds((current) => current.filter((accountId) => accountId !== filter.id)); }}>{filter.label}<X size={12} /></button>)}<button className="clear-filters" onClick={() => { setType("All types"); setSelectedAccountIds([]); }}>Clear all</button></div>}
      <div className="table-summary"><span><strong>{filtered.length}</strong> transactions</span><span>Total outflow <strong className="negative"><CurrencyAmounts values={flows.outflow} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} sign="−" /></strong></span><span>Total inflow <strong className="positive"><CurrencyAmounts values={flows.inflow} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} sign="+" /></strong></span></div>
      {bulkIds.length > 0 && <div className="bulk-bar"><span><strong>{bulkIds.length}</strong> selected</span><button className="button primary" onClick={() => setBulkModal(true)}><FolderTree size={15} /> Assign cost center</button><button className="button secondary" onClick={() => setSelectedIds(new Set())}><X size={14} /> Clear</button></div>}
      <div className="transaction-scroll">{filtered.length ? <TransactionList items={filtered} groupByDay locale={preferences.locale} timeZone={preferences.timezone} mainCurrency={preferences.currency} currencyMode={currencyPresentation.mode} rates={currencyPresentation.rates} onSelect={setSelected} selectedIds={selectedIds} onToggleSelect={toggleSelected} /> : <div className="empty-state"><Search size={26} /><strong>{loading ? "Loading…" : "No transactions found"}</strong><span>{accounts.length ? "Change your filters or add a transaction." : "Add an account before recording a transaction."}</span></div>}</div>
    </section>
    <Modal open={!!selected} onClose={() => { setSelected(null); setLinkMode(false); }} footerStart={<button type="button" className="button danger" onClick={() => { setDeleting(selected); setSelected(null); setLinkMode(false); }}><Trash2 size={15} /> Delete</button>} title="Edit transaction" action={linkMode ? "Link as transfer" : "Save changes"} onSubmit={(form) => { const data = values(form); return mutate("PATCH", data.linkExistingTransfer ? { resource: "transactionTransferLink", id: selected?.id, data } : { resource: "transaction", id: selected?.id, data }); }}><TransactionForm accounts={accounts} costCenters={costCenters} currencies={currencies} transactions={transactions} transaction={selected} locale={preferences.locale} timeZone={preferences.timezone} onTransferLinkModeChange={setLinkMode} /></Modal>
    <Modal wide open={modal} onClose={() => setModal(false)} title="New transactions" subtitle="One line per transaction. Use + to add more." action={newCount === 1 ? "Add transaction" : `Add ${newCount} transactions`} onSubmit={(form) => mutate("POST", { resource: "transactions", data: { items: JSON.parse(String(form.get("batch"))) } })}><BatchTransactionForm accounts={accounts} costCenters={costCenters} timeZone={preferences.timezone} onCountChange={setNewCount} /></Modal>
    <Modal open={bulkModal} onClose={() => setBulkModal(false)} title="Assign cost center" subtitle={`Apply to ${bulkIds.length} transaction${bulkIds.length === 1 ? "" : "s"}.`} action="Assign" submitDisabled={!bulkIds.length} onSubmit={async (form) => { await mutate("PATCH", { resource: "transactionCostCenter", data: { ids: bulkIds, costCenterId: form.get("costCenterId") || null } }); setSelectedIds(new Set()); }}><div className="form-grid"><label className="full">Cost center<select name="costCenterId" defaultValue="" autoFocus><option value="">Uncategorized</option>{centers.map((center) => <option value={center.id} key={center.id}>{center.path}</option>)}</select></label></div></Modal>
    <ConfirmDeleteDialog open={!!deleting} onClose={() => setDeleting(null)} title="Delete transaction?" confirmText={deleting?.merchant ?? ""}
      impact={deleting?.transferId
        ? <><strong>This transfer will be permanently deleted.</strong><span>Both sides are removed: {deleting.amount < 0 ? `${deleting.account} → ${deletingCounterpart}` : `${deletingCounterpart} → ${deleting.account}`}.</span></>
        : <><strong>This transaction will be permanently deleted.</strong><span>{deleting ? `${formatMoney(deleting.amount, deleting.currency, preferences.locale)} · ${formatDate(deleting.occurredAt, preferences.timezone, preferences.locale)} · ${deleting.account}` : ""}</span></>}
      onConfirm={(confirmName) => mutate("DELETE", { resource: "transaction", id: deleting?.id, data: { confirmName } })} />
  </div>;
}
