"use client";

import { ArrowDownLeft, ArrowUpRight, MoreHorizontal } from "lucide-react";
import { Fragment } from "react";
import { CurrencyAmounts, type CurrencyDisplayMode } from "@/components/currency-presentation";
import { groupCurrencyAmounts, type FxRateMap } from "@/lib/currency-summary";
import { formatMoney, Transaction } from "@/lib/data";
import { formatDate, utcToZonedDate } from "@/lib/time";

export function TransactionList({ items, onSelect, compact = false, groupByDay = false, locale = "en-US", timeZone = "UTC", mainCurrency = "USD", currencyMode = "native", rates }: { items: Transaction[]; onSelect?: (item: Transaction) => void; compact?: boolean; groupByDay?: boolean; locale?: string; timeZone?: string; mainCurrency?: string; currencyMode?: CurrencyDisplayMode; rates?: FxRateMap | null }) {
  // Items arrive newest first, so a new day starts wherever the local calendar date changes.
  const dayKeys = groupByDay ? items.map((item) => utcToZonedDate(item.occurredAt, timeZone)) : [];
  const days = new Map<string, Transaction[]>();
  items.forEach((item, index) => { if (groupByDay) days.set(dayKeys[index], [...(days.get(dayKeys[index]) ?? []), item]); });
  return (
    <div className={`transaction-table ${compact ? "compact" : ""}`}>
      <div className="transaction-row table-header"><span>Transaction</span><span>Date</span><span>Cost center</span><span>Account</span><span>Amount</span><span /></div>
      {items.map((item, index) => {
        const dayItems = groupByDay && (index === 0 || dayKeys[index - 1] !== dayKeys[index]) ? days.get(dayKeys[index]) ?? [] : [];
        const dayTotal = groupCurrencyAmounts(dayItems.map((dayItem) => ({ currency: dayItem.currency, amount: dayItem.amount })), mainCurrency);
        return <Fragment key={item.id}>
        {dayItems.length > 0 && <div className="transaction-day"><span>
          <strong>{formatDate(item.occurredAt, timeZone, locale)}</strong>
          <span>{dayItems.length} transaction{dayItems.length === 1 ? "" : "s"}</span>
          {dayTotal.length ? <CurrencyAmounts values={dayTotal} locale={locale} mainCurrency={mainCurrency} mode={currencyMode} rates={rates} signed /> : <span>{formatMoney(0, mainCurrency, locale)}</span>}
        </span></div>}
        <button className="transaction-row" onClick={() => onSelect?.(item)}>
          <span className="merchant-cell"><i className={`merchant-icon ${item.type.toLowerCase()}`}>{item.icon}</i><span><strong>{item.merchant}</strong><small>{item.detail}</small></span></span>
          <span className="date-cell">{formatDate(item.occurredAt, timeZone, locale)}</span>
          <span><i className="center-dot" />{item.costCenter}</span>
          <span>{item.account}</span>
          <strong className={`amount ${item.amount > 0 ? "positive" : ""}`}>{item.amount > 0 && item.type === "Income" ? "+" : ""}{formatMoney(item.amount, item.currency, locale)}</strong>
          <span className="row-actions">{item.type === "Income" ? <ArrowDownLeft size={15} /> : item.type === "Transfer" ? <ArrowUpRight size={15} /> : <MoreHorizontal size={17} />}</span>
        </button>
        </Fragment>;
      })}
    </div>
  );
}
