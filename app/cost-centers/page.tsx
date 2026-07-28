"use client";

import { ChevronDown, ChevronRight, CircleDollarSign, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/modal";
import { flattenCostCenters, formatMoney, type CostCenter } from "@/lib/data";
import { useFinanceData } from "@/lib/use-finance-data";

export default function CostCentersPage() {
  const { costCenters, preferences, loading, error, mutate } = useFinanceData();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(false);
  const [parent, setParent] = useState<CostCenter | null>(null);
  const [menu, setMenu] = useState("");
  const toggle = (id: string) => setExpanded((old) => old.includes(id) ? old.filter((i) => i !== id) : [...old, id]);
  const groups = costCenters.filter((g) => `${g.name} ${g.children.map((c) => c.name).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const allCenters = flattenCostCenters(costCenters);
  const money = (amount: number) => formatMoney(amount, preferences.currency, preferences.locale);
  return <div className="page">
    <div className="page-heading"><div><div className="eyebrow">Spending structure</div><h1>Cost centers</h1><p>Organize transactions with saved categories.</p></div><button className="button primary" onClick={() => { setParent(null); setModal(true); }}><Plus size={17} /> Add root center</button></div>
    {error && <div className="data-error"><strong>Could not connect to PostgreSQL.</strong><span>{error}</span><code>docker compose up -d</code></div>}
    <div className="cost-layout">
      <section className="panel tree-panel">
        <div className="tree-toolbar"><div className="toolbar-search"><Search size={17} /><input placeholder="Search cost centers..." value={query} onChange={(e) => setQuery(e.target.value)} /></div><span>{allCenters.length} centers</span></div>
        <div className="tree-head"><span>Name</span><span>Recorded spend</span><span /></div>
        <div className="tree-list">
          {groups.map((group) => <div className="tree-group" key={group.id}>
            <div className="tree-node root-node"><button className="tree-toggle" onClick={() => toggle(group.id)}>{expanded.includes(group.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button><span className="tree-color" style={{ background: group.color }}><CircleDollarSign size={15} /></span><strong>{group.name}</strong><span className="child-count">{group.children.length} children</span><span className="tree-amount">{money(group.amount + group.children.reduce((sum, child) => sum + child.amount, 0))}</span><div className="node-actions"><button title="Add child" onClick={() => { setParent(group); setModal(true); }}><Plus size={15} /></button><button title="More" onClick={() => setMenu(menu === group.id ? "" : group.id)}><MoreHorizontal size={17} /></button>{menu === group.id && <div className="node-menu popover"><button onClick={() => void mutate("DELETE", { resource: "costCenter", id: group.id })}><Trash2 size={14} /> Delete</button></div>}</div></div>
            {expanded.includes(group.id) && <div className="tree-children">{group.children.map((child) => <div className="tree-node child-node" key={child.id}><span className="branch-line" /><span className="child-bullet" style={{ borderColor: group.color }} /><span>{child.name}</span><span className="tree-amount">{money(child.amount)}</span><div className="node-actions"><button onClick={() => { setParent(child); setModal(true); }}><Plus size={15} /></button><button onClick={() => void mutate("DELETE", { resource: "costCenter", id: child.id })}><Trash2 size={15} /></button></div></div>)}<button className="add-child-row" onClick={() => { setParent(group); setModal(true); }}><span /><Plus size={14} /> Add child to {group.name}</button></div>}
          </div>)}
          {!loading && !groups.length && <div className="empty-state">{query ? "No cost centers match your search." : "No cost centers yet."}</div>}
        </div>
      </section>
      <aside className="cost-help panel"><span className="help-illustration"><CircleDollarSign size={27} /></span><h3>Organize your ledger</h3><p>Cost centers group transactions in a hierarchy you control.</p><div><strong>{costCenters.length}</strong><span>Root centers</span></div><div><strong>{allCenters.length - costCenters.length}</strong><span>Nested centers</span></div><small>Deleting a center leaves its transactions uncategorized.</small></aside>
    </div>
    <Modal open={modal} onClose={() => setModal(false)} title={parent ? `Add under ${parent.name}` : "New cost center"} action="Create cost center" onSubmit={(form) => mutate("POST", { resource: "costCenter", data: Object.fromEntries(form.entries()) })}><div className="form-grid"><input type="hidden" name="parentId" value={parent?.id ?? ""} /><label className="full">Name<input name="name" placeholder="e.g. Dining out" autoFocus required /></label><label className="full">Color<input name="color" type="color" defaultValue={parent?.color ?? "#573cf0"} /></label></div></Modal>
  </div>;
}
