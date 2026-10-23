"use client";

import { ArrowDownUp, ArrowLeftRight, ChevronDown, Download, FolderTree, Plus, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { DateRangeFilter } from "@/components/date-range-filter";
import { BatchTransactionForm, Modal, TransactionForm } from "@/components/modal";
import { MultiSelectFilter } from "@/components/multi-select-filter";
import { Pagination } from "@/components/pagination";
import { InfoHint } from "@/components/info-hint";
import { TransactionList } from "@/components/transaction-list";
import { CurrencyAmounts, CurrencyModeControl, useCurrencyPresentation } from "@/components/currency-presentation";
import { usePageFilters } from "@/components/view-state-provider";
import { useWorkspace } from "@/components/workspace-provider";
import { flattenCostCenters, formatMoney, type Transaction, type TransactionPage } from "@/lib/data";
import { formatDate } from "@/lib/time";
import { DEFAULT_TRANSACTION_QUERY, PAGE_SIZES, TRANSACTION_TYPES, UNCATEGORIZED, transactionFilterSearchParams, transactionSearchParams, type SortDirection, type TransactionFilters, type TransactionSort } from "@/lib/transaction-query";
import { useFinanceData } from "@/lib/use-finance-data";
import { useServerQuery } from "@/lib/use-server-query";

const values = (form: FormData) => Object.fromEntries(form.entries());
const sorts: Array<{ value: `${TransactionSort}:${SortDirection}`; label: string }> = [
  { value: "date:desc", label: "Newest first" },
  { value: "date:asc", label: "Oldest first" },
  { value: "amount:desc", label: "Amount: high to low" },
  { value: "amount:asc", label: "Amount: low to high" },
  { value: "description:asc", label: "Description: A to Z" },
  { value: "description:desc", label: "Description: Z to A" },
];

export default function TransactionsPage() {
  const { accounts, costCenters, currencies, preferences, loading, error, mutate } = useFinanceData();
  const { workspaceFetch } = useWorkspace();
  const [query, updateQuery] = usePageFilters("transactions", DEFAULT_TRANSACTION_QUERY);
  const [search, setSearch] = useState(query.q);
  const [modal, setModal] = useState(false);
  const [newCount, setNewCount] = useState(1);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [bulkModal, setBulkModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const deletingCounterpart = deleting?.transferAccountId ? accounts.find((account) => account.id === deleting.transferAccountId)?.name ?? "another account" : "";

  // Search is sent to the server once typing pauses.
  useEffect(() => {
    if (search.trim() === query.q) return;
    const timer = window.setTimeout(() => updateQuery({ q: search.trim() }), 300);
    return () => window.clearTimeout(timer);
  }, [query.q, search, updateQuery]);

  const params = transactionSearchParams(query);
  const listKey = params.toString();
  const { data: result, loading: listLoading, error: listError } = useServerQuery<TransactionPage>("/api/transactions", params);
  const items = useMemo(() => result?.items ?? [], [result]);
  // Selection belongs to the exact query it was made under, so changing filters or pages starts with nothing selected.
  const [selection, setSelection] = useState<{ key: string; ids: Set<string> }>({ key: "", ids: new Set() });
  const selectedIds = useMemo(() => selection.key === listKey ? selection.ids : new Set<string>(), [listKey, selection]);
  const bulkIds = useMemo(() => items.filter((t) => t.type !== "Transfer" && selectedIds.has(t.id)).map((t) => t.id), [items, selectedIds]);
  const centers = useMemo(() => flattenCostCenters(costCenters), [costCenters]);
  const centerOptions = useMemo(() => [{ id: UNCATEGORIZED, label: "Uncategorized" }, ...centers.map((center) => ({ id: center.id, label: center.path }))], [centers]);
  const accountOptions = useMemo(() => accounts.map((account) => ({ id: account.id, label: account.name })), [accounts]);
  const activeFilters = useMemo(() => [
    ...(query.type ? [{ id: "type", label: query.type, kind: "type" as const }] : []),
    ...query.accountIds.map((accountId) => ({ id: accountId, label: accounts.find((account) => account.id === accountId)?.name ?? "Account", kind: "account" as const })),
    ...query.costCenterIds.map((centerId) => ({ id: centerId, label: centerOptions.find((center) => center.id === centerId)?.label ?? "Cost center", kind: "costCenter" as const })),
  ], [accounts, centerOptions, query.accountIds, query.costCenterIds, query.type]);
  const presentationValues = useMemo(() => [...(result?.summary.inflow ?? []), ...(result?.summary.outflow ?? []), ...(result?.summary.transfer ?? [])], [result]);
  const currencyPresentation = useCurrencyPresentation(presentationValues, preferences.currency);

  function toggleSelected(ids: string[], checked: boolean) {
    setSelection(() => {
      const next = new Set(selectedIds);
      ids.forEach((id) => { if (checked) next.add(id); else next.delete(id); });
      return { key: listKey, ids: next };
    });
  }

  function removeFilter(filter: (typeof activeFilters)[number]) {
    if (filter.kind === "type") updateQuery({ type: "" });
    else if (filter.kind === "account") updateQuery({ accountIds: query.accountIds.filter((id) => id !== filter.id) });
    else updateQuery({ costCenterIds: query.costCenterIds.filter((id) => id !== filter.id) });
  }

  async function exportCsv() {
    setExporting(true); setExportError("");
    try {
      const response = await workspaceFetch(`/api/transactions/export?${transactionFilterSearchParams(query)}&sort=${query.sort}&dir=${query.dir}`, { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json()).error || "Could not export transactions");
      const link = document.createElement("a"); link.href = URL.createObjectURL(await response.blob()); link.download = "orbit-transactions.csv"; link.click(); URL.revokeObjectURL(link.href);
    } catch (caught) { setExportError(caught instanceof Error ? caught.message : "Could not export transactions"); }
    finally { setExporting(false); }
  }

  return <div className="page transactions-page">
    <div className="page-heading"><div><div className="eyebrow">Activity ledger</div><h1>Transactions</h1><p>Search and manage saved movements.</p></div><div className="heading-actions"><DateRangeFilter value={query.range} onChange={(range) => updateQuery({ range })} timeZone={preferences.timezone} locale={preferences.locale} /><button className="button secondary" disabled={!result?.total || exporting} onClick={() => void exportCsv()}><Download size={16} /> {exporting ? "Exporting…" : "Export"}</button><button className="button primary" disabled={!accounts.length} onClick={() => { setNewCount(1); setModal(true); }}><Plus size={17} /> New transaction</button></div></div>
    {error && <div className="data-error"><strong>Could not connect to PostgreSQL.</strong><span>{error}</span><code>docker compose up -d</code></div>}
    <section className="panel transaction-workspace">
      <div className="transaction-toolbar">
        <div className="transaction-search"><Search size={17} /><input placeholder="Search by description, note, or cost center..." value={search} onChange={(e) => setSearch(e.target.value)} />{search && <button onClick={() => { setSearch(""); updateQuery({ q: "" }); }}><X size={14} /></button>}</div>
        <label className="filter-select"><SlidersHorizontal size={16} /><select value={query.type} onChange={(e) => updateQuery({ type: e.target.value as TransactionFilters["type"] })}><option value="">All types</option>{TRANSACTION_TYPES.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label>
        <MultiSelectFilter allLabel="All accounts" pluralLabel="accounts" ariaLabel="Filter by account" options={accountOptions} selected={query.accountIds} onChange={(accountIds) => updateQuery({ accountIds })} />
        <MultiSelectFilter allLabel="All cost centers" pluralLabel="cost centers" ariaLabel="Filter by cost center" options={centerOptions} selected={query.costCenterIds} onChange={(costCenterIds) => updateQuery({ costCenterIds })} />
        <label className="filter-select"><ArrowDownUp size={16} /><select aria-label="Sort transactions" value={`${query.sort}:${query.dir}`} onChange={(e) => { const [sort, dir] = e.target.value.split(":") as [TransactionSort, SortDirection]; updateQuery({ sort, dir }); }}>{sorts.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><ChevronDown size={14} /></label>
      </div>
      {currencyPresentation.canConvert && <CurrencyModeControl targetCurrency={preferences.currency} mode={currencyPresentation.mode} setMode={currencyPresentation.setDisplayMode} loading={currencyPresentation.loading} error={currencyPresentation.error} providerLabel={currencyPresentation.providerLabel} rateDates={currencyPresentation.rateDates} onRefresh={() => void currencyPresentation.refresh()} />}
      {activeFilters.length > 0 && <div className="active-filters"><span>Active filters</span>{activeFilters.map((filter) => <button key={`${filter.kind}-${filter.id}`} onClick={() => removeFilter(filter)}>{filter.label}<X size={12} /></button>)}<button className="clear-filters" onClick={() => updateQuery({ type: "", accountIds: [], costCenterIds: [] })}>Clear all</button></div>}
      <div className="table-summary"><span><strong>{result?.total ?? 0}</strong> transactions</span><span>Total outflow <InfoHint text="Expenses only. Transfers between your accounts are excluded." /> <strong className="negative"><CurrencyAmounts values={result?.summary.outflow ?? []} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} sign="−" /></strong></span><span>Total inflow <InfoHint text="Income only. Transfers between your accounts are excluded." /> <strong className="positive"><CurrencyAmounts values={result?.summary.inflow ?? []} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} sign="+" /></strong></span><span>Total transfers <strong className="transfer"><ArrowLeftRight size={13} /><CurrencyAmounts values={result?.summary.transfer ?? []} locale={preferences.locale} mainCurrency={preferences.currency} mode={currencyPresentation.mode} rates={currencyPresentation.rates} /></strong></span>{listLoading && result && <span className="table-summary-status">Updating…</span>}</div>
      {(listError || exportError) && <div className="form-error">{listError || exportError}</div>}
      {bulkIds.length > 0 && <div className="bulk-bar"><span><strong>{bulkIds.length}</strong> selected</span><button className="button primary" onClick={() => setBulkModal(true)}><FolderTree size={15} /> Assign cost center</button><button className="button secondary" onClick={() => setSelection({ key: "", ids: new Set() })}><X size={14} /> Clear</button></div>}
      <div className="transaction-scroll">{items.length ? <TransactionList items={items} dayTotals={result?.dayTotals} locale={preferences.locale} timeZone={preferences.timezone} mainCurrency={preferences.currency} currencyMode={currencyPresentation.mode} rates={currencyPresentation.rates} onSelect={setSelected} selectedIds={selectedIds} onToggleSelect={toggleSelected} /> : <div className="empty-state"><Search size={26} /><strong>{loading || (listLoading && !result) ? "Loading…" : "No transactions found"}</strong><span>{accounts.length ? "Change your filters or date range, or add a transaction." : "Add an account before recording a transaction."}</span></div>}</div>
      {result && result.total > 0 && <Pagination page={result.page} pageCount={result.pageCount} pageSize={result.pageSize} total={result.total} pageSizes={PAGE_SIZES} onPageChange={(page) => updateQuery({ page })} onPageSizeChange={(pageSize) => updateQuery({ pageSize })} />}
    </section>
    <Modal open={!!selected} onClose={() => { setSelected(null); setLinkMode(false); }} footerStart={<button type="button" className="button danger" onClick={() => { setDeleting(selected); setSelected(null); setLinkMode(false); }}><Trash2 size={15} /> Delete</button>} title="Edit transaction" action={linkMode ? "Link as transfer" : "Save changes"} onSubmit={(form) => { const data = values(form); return mutate("PATCH", data.linkExistingTransfer ? { resource: "transactionTransferLink", id: selected?.id, data } : { resource: "transaction", id: selected?.id, data }); }}><TransactionForm accounts={accounts} costCenters={costCenters} currencies={currencies} transaction={selected} locale={preferences.locale} timeZone={preferences.timezone} onTransferLinkModeChange={setLinkMode} /></Modal>
    <Modal wide open={modal} onClose={() => setModal(false)} title="New transactions" subtitle="One line per transaction. Use + to add more." action={newCount === 1 ? "Add transaction" : `Add ${newCount} transactions`} onSubmit={(form) => mutate("POST", { resource: "transactions", data: { items: JSON.parse(String(form.get("batch"))) } })}><BatchTransactionForm accounts={accounts} costCenters={costCenters} timeZone={preferences.timezone} onCountChange={setNewCount} /></Modal>
    <Modal open={bulkModal} onClose={() => setBulkModal(false)} title="Assign cost center" subtitle={`Apply to ${bulkIds.length} transaction${bulkIds.length === 1 ? "" : "s"}.`} action="Assign" submitDisabled={!bulkIds.length} onSubmit={async (form) => { await mutate("PATCH", { resource: "transactionCostCenter", data: { ids: bulkIds, costCenterId: form.get("costCenterId") || null } }); setSelection({ key: "", ids: new Set() }); }}><div className="form-grid"><label className="full">Cost center<select name="costCenterId" defaultValue="" autoFocus><option value="">Uncategorized</option>{centers.map((center) => <option value={center.id} key={center.id}>{center.path}</option>)}</select></label></div></Modal>
    <ConfirmDeleteDialog open={!!deleting} onClose={() => setDeleting(null)} title="Delete transaction?" confirmText={deleting?.merchant ?? ""}
      impact={deleting?.transferId
        ? <><strong>This transfer will be permanently deleted.</strong><span>Both sides are removed: {deleting.amount < 0 ? `${deleting.account} → ${deletingCounterpart}` : `${deletingCounterpart} → ${deleting.account}`}.</span></>
        : <><strong>This transaction will be permanently deleted.</strong><span>{deleting ? `${formatMoney(deleting.amount, deleting.currency, preferences.locale)} · ${formatDate(deleting.occurredAt, preferences.timezone, preferences.locale)} · ${deleting.account}` : ""}</span></>}
      onConfirm={(confirmName) => mutate("DELETE", { resource: "transaction", id: deleting?.id, data: { confirmName } })} />
  </div>;
}
