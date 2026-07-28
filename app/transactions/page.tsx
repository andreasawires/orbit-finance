"use client";

import { ChevronDown, Download, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Modal, TransactionForm } from "@/components/modal";
import { TransactionList } from "@/components/transaction-list";
import { formatMoney, type Transaction } from "@/lib/data";
import { useFinanceData } from "@/lib/use-finance-data";

const types = ["All types", "Income", "Expense", "Transfer"];
const values = (form: FormData) => Object.fromEntries(form.entries());

export default function TransactionsPage() {
  const { accounts, transactions, costCenters, currencies, preferences, loading, error, mutate } = useFinanceData();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("All types");
  const [account, setAccount] = useState("All accounts");
  const [modal, setModal] = useState(false);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const filtered = useMemo(() => transactions.filter((t) => {
    const matchesQuery = `${t.merchant} ${t.detail} ${t.costCenter}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (type === "All types" || t.type === type) && (account === "All accounts" || t.accountId === account);
  }), [transactions, query, type, account]);
  const activeFilters = [type !== "All types" ? type : "", account !== "All accounts" ? account : ""].filter(Boolean);
  const outflow = Math.abs(filtered.filter((t) => t.type === "Expense").reduce((sum, t) => sum + t.amount, 0));
  const inflow = filtered.filter((t) => t.type === "Income").reduce((sum, t) => sum + t.amount, 0);
  const money = (amount: number) => formatMoney(amount, preferences.currency, preferences.locale);
  function exportCsv() {
    const csv = [["Date", "Description", "Note", "Type", "Account", "Cost center", "Amount"], ...filtered.map((t) => [t.occurredOn, t.merchant, t.detail, t.type, t.account, t.costCenter, String(t.amount)])]
      .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = "orbit-transactions.csv"; link.click(); URL.revokeObjectURL(link.href);
  }

  return <div className="page transactions-page">
    <div className="page-heading"><div><div className="eyebrow">Activity ledger</div><h1>Transactions</h1><p>Search and manage saved movements.</p></div><div className="heading-actions"><button className="button secondary" disabled={!filtered.length} onClick={exportCsv}><Download size={16} /> Export</button><button className="button primary" disabled={!accounts.length} onClick={() => setModal(true)}><Plus size={17} /> New transaction</button></div></div>
    {error && <div className="data-error"><strong>Could not connect to PostgreSQL.</strong><span>{error}</span><code>docker compose up -d</code></div>}
    <section className="panel transaction-workspace">
      <div className="transaction-toolbar">
        <div className="transaction-search"><Search size={17} /><input placeholder="Search by description, note, or cost center..." value={query} onChange={(e) => setQuery(e.target.value)} />{query && <button onClick={() => setQuery("")}><X size={14} /></button>}</div>
        <label className="filter-select"><SlidersHorizontal size={16} /><select value={type} onChange={(e) => setType(e.target.value)}>{types.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label>
        <label className="filter-select"><select value={account} onChange={(e) => setAccount(e.target.value)}><option value="All accounts">All accounts</option>{accounts.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><ChevronDown size={14} /></label>
      </div>
      {activeFilters.length > 0 && <div className="active-filters"><span>Active filters</span>{activeFilters.map((f) => <button key={f} onClick={() => { if (f === type) setType("All types"); if (f === account) setAccount("All accounts"); }}>{f === account ? accounts.find((a) => a.id === f)?.name : f}<X size={12} /></button>)}<button className="clear-filters" onClick={() => { setType("All types"); setAccount("All accounts"); }}>Clear all</button></div>}
      <div className="table-summary"><span><strong>{filtered.length}</strong> transactions</span><span>Total outflow <strong className="negative">−{money(outflow)}</strong></span><span>Total inflow <strong className="positive">+{money(inflow)}</strong></span></div>
      {filtered.length ? <TransactionList items={filtered} onSelect={setSelected} /> : <div className="empty-state"><Search size={26} /><strong>{loading ? "Loading…" : "No transactions found"}</strong><span>{accounts.length ? "Change your filters or add a transaction." : "Add an account before recording a transaction."}</span></div>}
    </section>
    <Modal open={modal || !!selected} onClose={() => { setModal(false); setSelected(null); setLinkMode(false); }} title={selected ? "Edit transaction" : "New transaction"} action={linkMode ? "Link as transfer" : selected ? "Save changes" : "Add transaction"} onSubmit={(form) => { const data = values(form); return mutate(selected ? "PATCH" : "POST", data.linkExistingTransfer ? { resource: "transactionTransferLink", id: selected?.id, data } : { resource: "transaction", id: selected?.id, data }); }}><TransactionForm accounts={accounts} costCenters={costCenters} currencies={currencies} transactions={transactions} transaction={selected} onTransferLinkModeChange={setLinkMode} /></Modal>
  </div>;
}
