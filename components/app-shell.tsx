"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CircleDollarSign,
  FileUp,
  Landmark,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  ReceiptText,
  Search,
  Settings,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useWorkspace } from "@/components/workspace-provider";

const navItems = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/transactions", label: "Transactions", icon: ReceiptText },
  { href: "/imports", label: "Imports", icon: FileUp },
  { href: "/cost-centers", label: "Cost centers", icon: CircleDollarSign },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { workspace, workspaces, loading: workspaceLoading, error: workspaceError, selectWorkspace } = useWorkspace();

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, []);

  return (
    <div className={`app-frame ${collapsed ? "sidebar-collapsed" : ""}`}>
      <header className="topbar">
        <div className="brand-area">
          <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu size={20} />
          </button>
          <Link href="/" className="brand">
            <span className="logo-mark"><span /></span>
            <span className="brand-name">orbit<span>finance</span></span>
          </Link>
        </div>

        <button className="global-search" onClick={() => setSearchOpen(true)}>
          <Search size={17} />
          <span>Search anything...</span>
          <kbd>⌘ K</kbd>
        </button>

        <div className="top-actions">
          <Link href="/settings" className="icon-button" aria-label="Settings"><Settings size={18} /></Link>
        </div>
      </header>

      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="mobile-sidebar-head">
          <span className="brand"><span className="logo-mark"><span /></span><span className="brand-name">orbit<span>finance</span></span></span>
          <button className="icon-button" onClick={() => setMobileOpen(false)}><X size={20} /></button>
        </div>
        <nav className="nav-list">
          <span className="nav-label">Workspace</span>
          <div className="workspace-switcher">
            <select aria-label="Active workspace" disabled={workspaceLoading || !workspaces.length} value={workspace?.id ?? ""} onChange={(event) => selectWorkspace(event.target.value)}>
              {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <Link href="/settings?tab=workspaces" title="Manage workspaces">Manage</Link>
          </div>
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return <Link key={href} href={href} className={active ? "active" : ""} title={collapsed ? label : undefined} onClick={() => setMobileOpen(false)}><Icon size={19} /><span>{label}</span>{active && <i />}</Link>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <Link href="/settings" onClick={() => setMobileOpen(false)} className={pathname.startsWith("/settings") ? "active settings-link" : "settings-link"}><Settings size={19} /><span>Settings</span></Link>
          <button className="collapse-button" onClick={() => setCollapsed((v) => !v)}><PanelLeftClose size={18} /><span>Collapse sidebar</span></button>
        </div>
      </aside>
      {mobileOpen && <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}

      <main className="main-content" key={workspace?.id ?? "workspace-loading"}>
        {workspaceLoading ? <div className="page"><div className="empty-state">Loading workspace…</div></div>
          : workspaceError ? <div className="page"><div className="data-error"><strong>Could not load workspaces.</strong><span>{workspaceError}</span></div></div>
            : children}
      </main>

      {searchOpen && (
        <div className="modal-backdrop search-backdrop" onMouseDown={() => setSearchOpen(false)}>
          <div className="command-menu" onMouseDown={(e) => e.stopPropagation()}>
            <div className="command-input"><Search size={20} /><input autoFocus placeholder="Search accounts, transactions, reports..." /><button onClick={() => setSearchOpen(false)}>esc</button></div>
            <div className="command-section"><span>Quick links</span>
              <Link href="/transactions" onClick={() => setSearchOpen(false)}><ReceiptText size={17} /><span><strong>Search transactions</strong><small>Find by merchant or amount</small></span><b>→</b></Link>
              <Link href="/accounts" onClick={() => setSearchOpen(false)}><Landmark size={17} /><span><strong>View accounts</strong><small>Balances and account details</small></span><b>→</b></Link>
              <Link href="/settings" onClick={() => setSearchOpen(false)}><SlidersHorizontal size={17} /><span><strong>Open settings</strong><small>Currency, appearance and data</small></span><b>→</b></Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
