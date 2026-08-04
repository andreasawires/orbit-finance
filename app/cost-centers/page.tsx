"use client";

import { ChevronDown, ChevronRight, CircleDollarSign, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { Modal } from "@/components/modal";
import { CurrencyAmounts, CurrencyModeControl, useCurrencyPresentation, type CurrencyDisplayMode } from "@/components/currency-presentation";
import { groupCurrencyAmounts, type CurrencyAmount, type FxRateMap } from "@/lib/currency-summary";
import { flattenCostCenters, type CostCenter, type Transaction } from "@/lib/data";
import { useFinanceData } from "@/lib/use-finance-data";

function matchesCostCenter(center: CostCenter, query: string): boolean {
  return center.name.toLocaleLowerCase().includes(query) || center.children.some((child) => matchesCostCenter(child, query));
}

function costCenterSpending(centers: CostCenter[], transactions: Transaction[], mainCurrency: string) {
  const direct = new Map<string, CurrencyAmount[]>();
  for (const transaction of transactions) {
    if (transaction.type !== "Expense" || !transaction.costCenterId) continue;
    const values = direct.get(transaction.costCenterId) ?? [];
    values.push({ currency: transaction.currency, amount: Math.abs(transaction.amount) });
    direct.set(transaction.costCenterId, values);
  }
  const totals = new Map<string, CurrencyAmount[]>();
  const rollup = (center: CostCenter): CurrencyAmount[] => {
    const values = [...(direct.get(center.id) ?? []), ...center.children.flatMap(rollup)];
    const grouped = groupCurrencyAmounts(values, mainCurrency);
    totals.set(center.id, grouped);
    return grouped;
  };
  centers.forEach(rollup);
  return totals;
}

function CostCenterNode({
  center,
  depth,
  expanded,
  query,
  menu,
  spending,
  locale,
  mainCurrency,
  displayMode,
  rates,
  onToggle,
  onAddChild,
  onDelete,
  onToggleMenu,
}: {
  center: CostCenter;
  depth: number;
  expanded: string[];
  query: string;
  menu: string;
  spending: Map<string, CurrencyAmount[]>;
  locale: string;
  mainCurrency: string;
  displayMode: CurrencyDisplayMode;
  rates: FxRateMap | null;
  onToggle: (id: string) => void;
  onAddChild: (center: CostCenter) => void;
  onDelete: (id: string) => void;
  onToggleMenu: (id: string) => void;
}) {
  const visibleChildren = query ? center.children.filter((child) => matchesCostCenter(child, query)) : center.children;
  const hasChildren = center.children.length > 0;
  const isExpanded = hasChildren && (!!query || expanded.includes(center.id));
  const style = { "--tree-depth": depth } as CSSProperties;

  return <div className="tree-branch">
    <div className={`tree-node ${depth === 0 ? "root-node" : "child-node"}`} style={style}>
      {depth === 0 ? <>
        {hasChildren ? <button className="tree-toggle" onClick={() => onToggle(center.id)} aria-label={`${isExpanded ? "Collapse" : "Expand"} ${center.name}`} aria-expanded={isExpanded}>{isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button> : <span className="tree-toggle tree-toggle-spacer" />}
        <span className="tree-color" style={{ background: center.color }}><CircleDollarSign size={15} /></span>
      </> : <>
        <span className="branch-line" />
        {hasChildren ? <button className="tree-toggle" onClick={() => onToggle(center.id)} aria-label={`${isExpanded ? "Collapse" : "Expand"} ${center.name}`} aria-expanded={isExpanded}>{isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button> : <span className="tree-toggle tree-toggle-spacer" />}
        <span className="child-bullet" style={{ borderColor: center.color }} />
      </>}
      <strong className="tree-node-name">{center.name}</strong>
      {hasChildren && <span className="child-count">{center.children.length} {center.children.length === 1 ? "child" : "children"}</span>}
      <span className="tree-amount"><CurrencyAmounts values={spending.get(center.id) ?? []} locale={locale} mainCurrency={mainCurrency} mode={displayMode} rates={rates} /></span>
      <div className="node-actions">
        <button title={`Add child to ${center.name}`} onClick={() => onAddChild(center)}><Plus size={15} /></button>
        <button title={`More actions for ${center.name}`} onClick={() => onToggleMenu(center.id)} aria-expanded={menu === center.id}><MoreHorizontal size={17} /></button>
        {menu === center.id && <div className="node-menu popover"><button onClick={() => onDelete(center.id)}><Trash2 size={14} /> Delete</button></div>}
      </div>
    </div>
    {isExpanded && <div className="tree-children">
      {visibleChildren.map((child) => <CostCenterNode key={child.id} center={child} depth={depth + 1} expanded={expanded} query={query} menu={menu} spending={spending} locale={locale} mainCurrency={mainCurrency} displayMode={displayMode} rates={rates} onToggle={onToggle} onAddChild={onAddChild} onDelete={onDelete} onToggleMenu={onToggleMenu} />)}
      {!query && <button className="add-child-row" style={style} onClick={() => onAddChild(center)}><span /><Plus size={14} /> Add child to {center.name}</button>}
    </div>}
  </div>;
}

export default function CostCentersPage() {
  const { costCenters, transactions, preferences, loading, error, mutate } = useFinanceData();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(false);
  const [parent, setParent] = useState<CostCenter | null>(null);
  const [menu, setMenu] = useState("");
  const toggle = (id: string) => setExpanded((old) => old.includes(id) ? old.filter((i) => i !== id) : [...old, id]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const groups = normalizedQuery ? costCenters.filter((center) => matchesCostCenter(center, normalizedQuery)) : costCenters;
  const allCenters = flattenCostCenters(costCenters);
  const spending = useMemo(() => costCenterSpending(costCenters, transactions, preferences.currency), [costCenters, preferences.currency, transactions]);
  const presentationValues = useMemo(() => transactions.filter((transaction) => transaction.type === "Expense" && transaction.costCenterId).map((transaction) => ({ currency: transaction.currency, amount: Math.abs(transaction.amount) })), [transactions]);
  const currencyPresentation = useCurrencyPresentation(presentationValues, preferences.currency);
  const addChild = (center: CostCenter) => { setParent(center); setModal(true); };
  return <div className="page">
    <div className="page-heading"><div><div className="eyebrow">Spending structure</div><h1>Cost centers</h1><p>Organize transactions with saved categories.</p></div><button className="button primary" onClick={() => { setParent(null); setModal(true); }}><Plus size={17} /> Add root center</button></div>
    {error && <div className="data-error"><strong>Could not connect to PostgreSQL.</strong><span>{error}</span><code>docker compose up -d</code></div>}
    {currencyPresentation.canConvert && <CurrencyModeControl targetCurrency={preferences.currency} mode={currencyPresentation.mode} setMode={currencyPresentation.setDisplayMode} loading={currencyPresentation.loading} error={currencyPresentation.error} providerLabel={currencyPresentation.providerLabel} rateDates={currencyPresentation.rateDates} onRefresh={() => void currencyPresentation.refresh()} />}
    <div className="cost-layout">
      <section className="panel tree-panel">
        <div className="tree-toolbar"><div className="toolbar-search"><Search size={17} /><input placeholder="Search cost centers..." value={query} onChange={(e) => setQuery(e.target.value)} /></div><span>{allCenters.length} centers</span></div>
        <div className="tree-head"><span>Name</span><span>Recorded spend</span><span /></div>
        <div className="tree-list">
          {groups.map((group) => <CostCenterNode key={group.id} center={group} depth={0} expanded={expanded} query={normalizedQuery} menu={menu} spending={spending} locale={preferences.locale} mainCurrency={preferences.currency} displayMode={currencyPresentation.mode} rates={currencyPresentation.rates} onToggle={toggle} onAddChild={addChild} onDelete={(id) => void mutate("DELETE", { resource: "costCenter", id })} onToggleMenu={(id) => setMenu(menu === id ? "" : id)} />)}
          {!loading && !groups.length && <div className="empty-state">{query ? "No cost centers match your search." : "No cost centers yet."}</div>}
        </div>
      </section>
      <aside className="cost-help panel"><span className="help-illustration"><CircleDollarSign size={27} /></span><h3>Organize your ledger</h3><p>Cost centers group transactions in a hierarchy you control.</p><div><strong>{costCenters.length}</strong><span>Root centers</span></div><div><strong>{allCenters.length - costCenters.length}</strong><span>Nested centers</span></div><small>Deleting a center leaves its transactions uncategorized.</small></aside>
    </div>
    <Modal open={modal} onClose={() => setModal(false)} title={parent ? `Add under ${parent.name}` : "New cost center"} action="Create cost center" onSubmit={(form) => mutate("POST", { resource: "costCenter", data: Object.fromEntries(form.entries()) })}><div className="form-grid"><input type="hidden" name="parentId" value={parent?.id ?? ""} /><label className="full">Name<input name="name" placeholder="e.g. Dining out" autoFocus required /></label><label className="full">Color<input name="color" type="color" defaultValue={parent?.color ?? "#573cf0"} /></label></div></Modal>
  </div>;
}
