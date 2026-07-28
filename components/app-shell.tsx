"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CircleDollarSign,
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

const navItems = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/transactions", label: "Transactions", icon: ReceiptText },
  { href: "/cost-centers", label: "Cost centers", icon: CircleDollarSign },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

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

      <main className="main-content">{children}</main>

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
