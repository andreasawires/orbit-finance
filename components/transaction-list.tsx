"use client";

import { ArrowDownLeft, ArrowUpRight, MoreHorizontal } from "lucide-react";
import { formatMoney, Transaction } from "@/lib/data";
import { formatDate } from "@/lib/time";

export function TransactionList({ items, onSelect, compact = false, locale = "en-US", timeZone = "UTC" }: { items: Transaction[]; onSelect?: (item: Transaction) => void; compact?: boolean; locale?: string; timeZone?: string }) {
  return (
    <div className={`transaction-table ${compact ? "compact" : ""}`}>
      <div className="transaction-row table-header"><span>Transaction</span><span>Date</span><span>Cost center</span><span>Account</span><span>Amount</span><span /></div>
      {items.map((item) => (
        <button className="transaction-row" key={item.id} onClick={() => onSelect?.(item)}>
          <span className="merchant-cell"><i className={`merchant-icon ${item.type.toLowerCase()}`}>{item.icon}</i><span><strong>{item.merchant}</strong><small>{item.detail}</small></span></span>
          <span className="date-cell">{formatDate(item.occurredAt, timeZone, locale)}</span>
          <span><i className="center-dot" />{item.costCenter}</span>
          <span>{item.account}</span>
          <strong className={`amount ${item.amount > 0 ? "positive" : ""}`}>{item.amount > 0 && item.type === "Income" ? "+" : ""}{formatMoney(item.amount, item.currency, locale)}</strong>
          <span className="row-actions">{item.type === "Income" ? <ArrowDownLeft size={15} /> : item.type === "Transfer" ? <ArrowUpRight size={15} /> : <MoreHorizontal size={17} />}</span>
        </button>
      ))}
    </div>
  );
}
