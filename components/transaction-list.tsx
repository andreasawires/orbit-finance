"use client";

import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Check, MoreHorizontal } from "lucide-react";
import { Fragment, useRef } from "react";
import { CurrencyAmounts, type CurrencyDisplayMode } from "@/components/currency-presentation";
import type { FxRateMap } from "@/lib/currency-summary";
import { formatMoney, Transaction, type TransactionPage } from "@/lib/data";
import { formatDate, utcToZonedDate } from "@/lib/time";

function SelectBox({ checked, indeterminate = false, disabled = false, label, onChange }: { checked: boolean; indeterminate?: boolean; disabled?: boolean; label: string; onChange: (checked: boolean, shiftKey: boolean) => void }) {
  // The input is hidden, so the click lands on the label; remember Shift there because the forwarded click may not carry it.
  const shift = useRef(false);
  return <label className={`row-check ${disabled ? "disabled" : ""}`} title={disabled ? "Transfers can't have a cost center" : undefined} onMouseDown={(event) => { shift.current = event.shiftKey; if (event.shiftKey) event.preventDefault(); }}>
    <input type="checkbox" aria-label={label} checked={checked} disabled={disabled} ref={(input) => { if (input) input.indeterminate = indeterminate; }} onChange={(event) => { onChange(event.target.checked, shift.current); shift.current = false; }} />
    <span className="account-filter-check">{indeterminate ? <i className="row-check-dash" /> : <Check size={13} />}</span>
  </label>;
}

// Transfers have no cost center; that column names the other side instead. Its description and date only show when they
// differ from this row's, which they can for two imported transactions linked as one transfer.
function TransferCell({ item, locale, timeZone }: { item: Transaction; locale: string; timeZone: string }) {
  const date = item.transferOccurredAt && utcToZonedDate(item.transferOccurredAt, timeZone) !== utcToZonedDate(item.occurredAt, timeZone) ? formatDate(item.transferOccurredAt, timeZone, locale) : "";
  const merchant = item.transferMerchant && item.transferMerchant !== item.merchant ? item.transferMerchant : "";
  return <span className="transfer-cell" translate="no">
    <span><ArrowLeftRight size={12} />{item.amount < 0 ? "To" : "From"} {item.transferAccount ?? "another account"}</span>
    {merchant || date ? <small>{[merchant, date].filter(Boolean).join(" · ")}</small> : null}
  </span>;
}

// Passing `dayTotals` groups the rows by local day. The totals come from the server and cover the whole day,
// even when its transactions continue on the next page.
export function TransactionList({ items, onSelect, compact = false, dayTotals, locale = "en-US", timeZone = "UTC", mainCurrency = "USD", currencyMode = "native", rates, selectedIds, onToggleSelect }: { items: Transaction[]; onSelect?: (item: Transaction) => void; compact?: boolean; dayTotals?: TransactionPage["dayTotals"]; locale?: string; timeZone?: string; mainCurrency?: string; currencyMode?: CurrencyDisplayMode; rates?: FxRateMap | null; selectedIds?: Set<string>; onToggleSelect?: (ids: string[], selected: boolean) => void }) {
  // Items arrive sorted by date, so a new day starts wherever the local calendar date changes.
  const dayKeys = dayTotals ? items.map((item) => utcToZonedDate(item.occurredAt, timeZone)) : [];
  const selectable = !!onToggleSelect;
  const selectableIds = selectable ? items.filter((item) => item.type !== "Transfer").map((item) => item.id) : [];
  const selectedCount = selectableIds.filter((id) => selectedIds?.has(id)).length;
  const anchor = useRef<string | null>(null);
  // Shift-click applies the clicked box's new state to every selectable row between it and the last clicked row.
  function toggleRow(id: string, checked: boolean, shiftKey: boolean) {
    const from = anchor.current ? selectableIds.indexOf(anchor.current) : -1;
    const to = selectableIds.indexOf(id);
    anchor.current = id;
    onToggleSelect?.(shiftKey && from !== -1 ? selectableIds.slice(Math.min(from, to), Math.max(from, to) + 1) : [id], checked);
  }
  const header = <div className="transaction-row table-header"><span>Transaction</span><span>Date</span><span>Cost center</span><span>Account</span><span>Amount</span><span /></div>;
  return (
    <div className={`transaction-table ${compact ? "compact" : ""} ${selectable ? "selectable" : ""}`}>
      {selectable ? <div className="transaction-select-row table-header">
        <SelectBox label="Select all transactions" checked={selectedCount > 0 && selectedCount === selectableIds.length} indeterminate={selectedCount > 0 && selectedCount < selectableIds.length} disabled={!selectableIds.length} onChange={(checked) => onToggleSelect(selectableIds, checked)} />
        {header}
      </div> : header}
      {items.map((item, index) => {
        const day = dayTotals && (index === 0 || dayKeys[index - 1] !== dayKeys[index]) ? dayTotals[dayKeys[index]] ?? { count: 0, amounts: [] } : null;
        const row = <button className="transaction-row" onClick={() => onSelect?.(item)}>
          <span className="merchant-cell"><i className={`merchant-icon ${item.type.toLowerCase()}`}>{item.icon}</i><span><strong>{item.merchant}</strong><small>{item.detail}</small></span></span>
          <span className="date-cell">{formatDate(item.occurredAt, timeZone, locale)}</span>
          {/* Cost center names are user data: keep them out of browser translation, and remount on change so a rewritten text node can't hide the update. */}
          {item.type === "Transfer" ? <TransferCell item={item} locale={locale} timeZone={timeZone} /> : <span key={item.costCenterId ?? "uncategorized"} translate="no"><i className="center-dot" />{item.costCenter}</span>}
          <span>{item.account}</span>
          <strong className={`amount ${item.amount > 0 ? "positive" : ""}`}>{item.amount > 0 && item.type === "Income" ? "+" : ""}{formatMoney(item.amount, item.currency, locale)}</strong>
          <span className="row-actions">{item.type === "Income" ? <ArrowDownLeft size={15} /> : item.type === "Transfer" ? <ArrowUpRight size={15} /> : <MoreHorizontal size={17} />}</span>
        </button>;
        const selected = !!selectedIds?.has(item.id);
        return <Fragment key={item.id}>
        {day && <div className="transaction-day"><span>
          <strong>{formatDate(item.occurredAt, timeZone, locale)}</strong>
          <span>{day.count} transaction{day.count === 1 ? "" : "s"}</span>
          {day.amounts.length ? <CurrencyAmounts values={day.amounts} locale={locale} mainCurrency={mainCurrency} mode={currencyMode} rates={rates} signed /> : <span>{formatMoney(0, mainCurrency, locale)}</span>}
        </span></div>}
        {selectable ? <div className={`transaction-select-row ${selected ? "selected" : ""}`}>
          <SelectBox label={`Select ${item.merchant}`} checked={selected} disabled={item.type === "Transfer"} onChange={(checked, shiftKey) => toggleRow(item.id, checked, shiftKey)} />
          {row}
        </div> : row}
        </Fragment>;
      })}
    </div>
  );
}
