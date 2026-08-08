"use client";

import { Archive, Check, ChevronRight, Database, Download, Folder, Globe2, Moon, Palette, Pencil, Plus, RotateCcw, Settings2, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Modal } from "@/components/modal";
import type { Currency, Preferences } from "@/lib/data";
import { useFinanceData } from "@/lib/use-finance-data";
import { useWorkspace } from "@/components/workspace-provider";
import type { Workspace } from "@/lib/data";

type ThemePreference = "light" | "dark" | "system";
const tabs = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "currencies", label: "Currencies", icon: Globe2 },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "workspaces", label: "Workspaces", icon: Folder },
  { id: "data", label: "Data & privacy", icon: Database },
];

function applyTheme(preference: ThemePreference) {
  const dark = preference === "dark" || (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.themePreference = preference;
  localStorage.setItem("orbit-theme", preference);
}

export default function SettingsPage() {
  const { accounts, transactions, costCenters, currencies, preferences, error, mutate } = useFinanceData();
  const { workspace, selectWorkspace, refreshWorkspaces } = useWorkspace();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(() => searchParams.get("tab") === "workspaces" ? "workspaces" : "general");
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [form, setForm] = useState<Preferences>(preferences);
  const [saved, setSaved] = useState(false);
  const [currencyModal, setCurrencyModal] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<Currency | null>(null);
  const [currencyError, setCurrencyError] = useState("");
  const [workspaceModal, setWorkspaceModal] = useState(false);
  const [managedWorkspaces, setManagedWorkspaces] = useState<Workspace[]>([]);
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setForm(preferences), 0); return () => window.clearTimeout(timer); }, [preferences]);
  async function loadManagedWorkspaces() {
    setWorkspaceLoading(true);
    try {
      const response = await fetch("/api/workspaces?includeArchived=true", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load workspaces");
      setManagedWorkspaces(body.workspaces); setWorkspaceError("");
    } catch (caught) { setWorkspaceError(caught instanceof Error ? caught.message : "Could not load workspaces"); }
    finally { setWorkspaceLoading(false); }
  }
  useEffect(() => {
    if (tab !== "workspaces") return;
    const timer = window.setTimeout(() => { void loadManagedWorkspaces(); }, 0);
    return () => window.clearTimeout(timer);
  }, [tab]);
  useEffect(() => {
    const stored = (localStorage.getItem("orbit-theme") as ThemePreference | null) ?? "system";
    const frame = window.requestAnimationFrame(() => { setTheme(stored); applyTheme(stored); });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const change = () => { if ((localStorage.getItem("orbit-theme") ?? "system") === "system") applyTheme("system"); };
    media.addEventListener("change", change); return () => { window.cancelAnimationFrame(frame); media.removeEventListener("change", change); };
  }, []);
  function selectTheme(value: ThemePreference) { setTheme(value); applyTheme(value); }
  function exportData() {
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify({ accounts, transactions, costCenters, currencies, preferences }, null, 2)], { type: "application/json" })); link.download = "orbit-finance-backup.json"; link.click(); URL.revokeObjectURL(link.href);
  }
  async function save() { await mutate("PATCH", { resource: "preferences", data: form }); setSaved(true); setTimeout(() => setSaved(false), 2000); }
  async function saveCurrency(data: FormData) {
    await mutate(selectedCurrency ? "PATCH" : "POST", { resource: "currency", id: selectedCurrency?.code, data: Object.fromEntries(data.entries()) });
  }
  async function removeCurrency(currency: Currency) {
    if (!window.confirm(`Delete ${currency.code} (${currency.name})?`)) return;
    try {
      await mutate("DELETE", { resource: "currency", id: currency.code });
      setCurrencyError("");
    } catch (caught) { setCurrencyError(caught instanceof Error ? caught.message : "Could not delete currency"); }
  }
  async function createWorkspace(data: FormData) {
    const response = await fetch("/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: data.get("name") }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not create workspace");
    await refreshWorkspaces(); await loadManagedWorkspaces(); selectWorkspace(body.workspace.id);
  }
  async function renameWorkspace(item: Workspace) {
    const name = window.prompt("Workspace name", item.name)?.trim();
    if (!name || name === item.name) return;
    const response = await fetch(`/api/workspaces/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const body = await response.json(); if (!response.ok) { setWorkspaceError(body.error || "Could not rename workspace"); return; }
    await refreshWorkspaces(); await loadManagedWorkspaces();
  }
  async function changeWorkspaceArchive(item: Workspace, action: "archive" | "restore") {
    const response = await fetch(`/api/workspaces/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const body = await response.json(); if (!response.ok) { setWorkspaceError(body.error || "Could not update workspace"); return; }
    await refreshWorkspaces(); await loadManagedWorkspaces();
  }
  async function deleteWorkspace(item: Workspace) {
    const confirmationName = window.prompt(`Type ${item.name} to permanently delete this workspace and all of its data.`);
    if (confirmationName == null) return;
    const response = await fetch(`/api/workspaces/${item.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmationName }) });
    const body = await response.json(); if (!response.ok) { setWorkspaceError(body.error || "Could not delete workspace"); return; }
    await refreshWorkspaces(); await loadManagedWorkspaces();
  }
  return <div className="page settings-page">
    <div className="page-heading"><div><div className="eyebrow">Your preferences</div><h1>Settings</h1><p>Configure the active workspace. Appearance stays on this device.</p></div></div>
    {error && <div className="data-error"><strong>Could not connect to PostgreSQL.</strong><span>{error}</span><code>docker compose up -d</code></div>}
    <div className="settings-layout">
      <aside className="settings-tabs panel">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon size={18} /><span>{label}</span><ChevronRight size={15} /></button>)}</aside>
      <section className="settings-content panel">
        {tab === "general" && <><div className="settings-head"><h2>General settings</h2><p>Regional preferences are stored in PostgreSQL.</p></div><div className="settings-form"><label><span>Main currency<small>Used for calculated totals.</small></span><select className="control" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{currencies.map((currency) => <option value={currency.code} key={currency.code}>{currency.code} · {currency.name}</option>)}</select></label><label><span>Timezone<small>Used for future date-aware features.</small></span><input className="control" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></label><label><span>Locale<small>Controls number formats.</small></span><input className="control" value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })} /></label></div></>}
        {tab === "currencies" && <><div className="settings-head split"><div><h2>Currencies</h2><p>Add and manage the currencies available for accounts and reporting.</p></div><button className="button primary" onClick={() => { setSelectedCurrency(null); setCurrencyError(""); setCurrencyModal(true); }}><Plus size={16} /> Add currency</button></div><div className="currency-list"><div className="currency-row currency-header"><span>Currency</span><span>Accounts</span><span>Status</span><span>Actions</span></div>{currencies.map((currency) => { const accountCount = accounts.filter((account) => account.currency === currency.code).length; const isBase = currency.code === preferences.currency; return <div className="currency-row currency-simple" key={currency.code}><span className="currency-name"><i>{currency.symbol || currency.code.slice(0, 1)}</i><span><strong>{currency.code}</strong><small>{currency.name}</small></span></span><span>{accountCount}</span><span>{isBase ? <b className="base-pill">Base</b> : accountCount ? <b className="active-pill">In use</b> : <b className="active-pill">Available</b>}</span><span className="currency-actions"><button title={`Edit ${currency.code}`} onClick={() => { setSelectedCurrency(currency); setCurrencyError(""); setCurrencyModal(true); }}><Pencil size={15} /></button><button title={`Delete ${currency.code}`} disabled={isBase || accountCount > 0} onClick={() => void removeCurrency(currency)}><Trash2 size={15} /></button></span></div>; })}{!currencies.length && <div className="empty-state">Add a currency to start assigning it to accounts.</div>}{currencyError && <div className="form-error">{currencyError}</div>}</div></>}
        {tab === "appearance" && <><div className="settings-head"><h2>Appearance</h2><p>Theme changes apply immediately and persist on this device.</p></div><div className="appearance-options"><button className={theme === "light" ? "selected" : ""} onClick={() => selectTheme("light")}><div className="theme-preview light-preview"><span /><i /><i /><i /></div><span><strong>Light</strong><small>Clean and bright</small></span>{theme === "light" && <Check size={17} />}</button><button className={theme === "dark" ? "selected" : ""} onClick={() => selectTheme("dark")}><div className="theme-preview dark-preview"><span /><i /><i /><i /></div><span><strong>Dark</strong><small>Easy on the eyes</small></span>{theme === "dark" && <Check size={17} />}</button></div><div className="setting-toggle-row"><span className="toggle-icon"><Moon size={19} /></span><div><strong>Follow system appearance</strong><small>Automatically match your device and react to changes.</small></div><button aria-pressed={theme === "system"} className={`toggle ${theme === "system" ? "on" : ""}`} onClick={() => selectTheme("system")}><i /></button></div></>}
        {tab === "workspaces" && <><div className="settings-head split"><div><h2>Workspaces</h2><p>Keep accounts, transactions, imports, reports, and settings in separate financial spaces.</p></div><button className="button primary" onClick={() => setWorkspaceModal(true)}><Plus size={16} /> New workspace</button></div><div className="currency-list"><div className="currency-row currency-header"><span>Workspace</span><span>Status</span><span>Active</span><span>Actions</span></div>{managedWorkspaces.map((item) => <div className="currency-row currency-simple" key={item.id}><span className="currency-name"><i><Folder size={15} /></i><span><strong>{item.name}</strong><small>{item.archivedAt ? "Archived workspace" : "Financial data and settings"}</small></span></span><span>{item.archivedAt ? <b className="base-pill">Archived</b> : <b className="active-pill">Active</b>}</span><span>{workspace?.id === item.id ? <b className="base-pill">Current</b> : !item.archivedAt ? <button className="button secondary" onClick={() => selectWorkspace(item.id)}>Switch</button> : "—"}</span><span className="currency-actions"><button title={`Rename ${item.name}`} onClick={() => void renameWorkspace(item)}><Pencil size={15} /></button>{item.archivedAt ? <button title={`Restore ${item.name}`} onClick={() => void changeWorkspaceArchive(item, "restore")}><RotateCcw size={15} /></button> : <button title={`Archive ${item.name}`} onClick={() => void changeWorkspaceArchive(item, "archive")}><Archive size={15} /></button>}<button title={`Delete ${item.name}`} onClick={() => void deleteWorkspace(item)}><Trash2 size={15} /></button></span></div>)}{workspaceLoading && <div className="empty-state">Loading workspaces…</div>}{!workspaceLoading && !managedWorkspaces.length && <div className="empty-state">No workspaces found.</div>}{workspaceError && <div className="form-error">{workspaceError}</div>}</div></>}
        {tab === "data" && <><div className="settings-head"><h2>Data & privacy</h2><p>Export or remove records from the active workspace.</p></div><div className="data-cards"><div><span><Download size={20} /></span><div><strong>Export workspace data</strong><p>Download this workspace’s accounts, transactions, cost centers, currencies, and preferences as JSON.</p></div><button className="button secondary" onClick={exportData}>Export</button></div></div><div className="danger-zone"><h3>Danger zone</h3><div><span><strong>Delete this workspace’s financial data</strong><small>Accounts, transactions, cost centers, and imports in the active workspace will be permanently removed.</small></span><button className="button danger" onClick={() => { if (window.confirm("Permanently delete all financial data in this workspace?")) void mutate("DELETE", { resource: "all" }); }}><Trash2 size={15} /> Delete data</button></div></div></>}
        {tab === "general" && <div className="settings-save"><span className={saved ? "shown" : ""}><Check size={14} /> Preferences saved</span><button className="button primary" onClick={() => void save()}>Save changes</button></div>}
      </section>
    </div>
    <Modal open={currencyModal} onClose={() => { setCurrencyModal(false); setSelectedCurrency(null); }} title={selectedCurrency ? `Edit ${selectedCurrency.code}` : "Add currency"} subtitle="Currencies are saved in PostgreSQL and can be assigned to accounts." action={selectedCurrency ? "Save currency" : "Add currency"} onSubmit={saveCurrency}><div className="form-grid"><label>ISO code<input name="code" defaultValue={selectedCurrency?.code} maxLength={3} pattern="[A-Za-z]{3}" placeholder="e.g. EUR" required readOnly={!!selectedCurrency} /><small className="form-field-hint">{selectedCurrency ? "ISO codes are locked after creation." : "Use the three-letter ISO code."}</small></label><label>Symbol<input name="symbol" defaultValue={selectedCurrency?.symbol} maxLength={8} placeholder="e.g. €" /></label><label className="full">Name<input name="name" defaultValue={selectedCurrency?.name} placeholder="e.g. Euro" required /></label></div></Modal>
    <Modal open={workspaceModal} onClose={() => setWorkspaceModal(false)} title="Create workspace" subtitle="Your new workspace starts with default settings and no financial data." action="Create workspace" onSubmit={createWorkspace}><div className="form-grid"><label className="full">Workspace name<input name="name" placeholder="e.g. Household, Freelance, Business" maxLength={120} required autoFocus /></label></div></Modal>
  </div>;
}
