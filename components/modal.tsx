"use client";

import { Check, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FxRateMap } from "@/lib/currency-summary";
import type { Account, CostCenter, Currency, Transaction } from "@/lib/data";
import { flattenCostCenters, formatMoney } from "@/lib/data";
import { formatDate, isIsoDate, todayInZone, utcToZonedDate, zonedDateToUtc } from "@/lib/time";
import { formatTransferRate, transferRate } from "@/lib/transfer";
import { useServerQuery } from "@/lib/use-server-query";

export function Modal({ open, onClose, title, subtitle, children, action = "Save changes", onSubmit, footerStart, danger = false, submitDisabled = false, savingLabel = "Saving…", wide = false }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode; onSubmit?: (data: FormData) => Promise<unknown> | unknown;
  footerStart?: React.ReactNode; danger?: boolean; submitDisabled?: boolean; savingLabel?: string; wide?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    function keydown(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    if (open) { document.body.style.overflow = "hidden"; window.addEventListener("keydown", keydown); }
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", keydown); };
  }, [open, onClose]);
  if (!open) return null;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSubmit) return;
    setSaving(true); setError("");
    try { await onSubmit(new FormData(event.currentTarget)); onClose(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save changes"); }
    finally { setSaving(false); }
  }
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className={`modal ${wide ? "wide" : ""}`} onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="icon-button" onClick={onClose}><X size={20} /></button></div>
        <div className="modal-body">{children}</div>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-foot">{footerStart && <div className="modal-foot-start">{footerStart}</div>}<button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className={`button ${danger ? "danger solid" : "primary"}`} disabled={saving || submitDisabled}>{danger ? null : <Check size={17} />}{saving ? savingLabel : action}</button></div>
      </form>
    </div>
  );
}

export function AccountForm({ account, currencies = [] }: { account?: Account | null; currencies?: Currency[] }) {
  return <div className="form-grid">
    <label className="full">Account name<input name="name" defaultValue={account?.name} placeholder="e.g. Everyday account" required /></label>
    <label>Institution<input name="institution" defaultValue={account?.institution} placeholder="Bank or institution" /></label>
    <label>Account type<select name="kind" defaultValue={account?.kind ?? "Checking"}><option>Checking</option><option>Savings</option><option>Credit card</option><option>Investment</option></select></label>
    <label>Opening balance<input name={account ? "openingBalance" : "startingBalance"} defaultValue={account?.openingBalance} type="number" step="0.01" placeholder="0.00" required /></label>
    {account ? <label>Currency<span className="locked-currency"><strong>{account.currency}</strong><small>Locked after creation. Create a new account to use another currency.</small></span></label> : <label>Currency<select name="currency" defaultValue={currencies[0]?.code ?? "USD"} required>{currencies.length ? currencies.map((currency) => <option key={currency.code} value={currency.code}>{currency.code} · {currency.name}</option>) : <option value="USD">USD</option>}</select></label>}
    <fieldset className="full color-field"><legend>Account color</legend><div className="color-options">{["#573cf0", "#0e8a69", "#db6e30", "#267baf", "#d94e6b"].map((c, i) => <label key={c}><input type="radio" name="color" value={c} defaultChecked={account ? account.color === c : !i} /><span style={{ background: c }}>{(!account && !i) || account?.color === c ? <Check size={14} /> : null}</span></label>)}</div></fieldset>
  </div>;
}

const absoluteText = (value: number | null | undefined) => value == null ? "" : String(Math.abs(value));

// `applied` and `market` are both destination units per source unit.
function marketComparison(applied: number, market: number) {
  const difference = (applied / market - 1) * 100;
  return Math.abs(difference) < 0.05 ? "At the market rate" : `${Math.abs(difference).toFixed(1)}% ${difference < 0 ? "below" : "above"} the market rate`;
}

export function TransactionForm({ accounts, costCenters, currencies, transaction, locale = "en-US", timeZone = "UTC", onTransferLinkModeChange }: { accounts: Account[]; costCenters: CostCenter[]; currencies: Currency[]; transaction?: Transaction | null; locale?: string; timeZone?: string; onTransferLinkModeChange?: (active: boolean) => void }) {
  const [type, setType] = useState<Transaction["type"]>(transaction?.type ?? "Expense");
  const initialSourceAccountId = transaction?.type === "Transfer" && transaction.amount > 0 ? transaction.transferAccountId ?? "" : transaction?.accountId ?? accounts[0]?.id ?? "";
  const initialDestinationAccountId = transaction?.type === "Transfer" && transaction.amount < 0 ? transaction.transferAccountId ?? "" : transaction?.type === "Transfer" ? transaction?.accountId ?? "" : accounts.find((account) => account.id !== initialSourceAccountId)?.id ?? "";
  const [accountId, setAccountId] = useState(initialSourceAccountId);
  const [transferAccountId, setTransferAccountId] = useState(initialDestinationAccountId);
  // A transfer opened from its incoming leg still edits what was sent (the other leg) and what was received (this one).
  const incomingLeg = transaction?.type === "Transfer" && transaction.amount > 0;
  const [sent, setSent] = useState(() => absoluteText(incomingLeg ? transaction?.transferAmount : transaction?.amount));
  const [received, setReceived] = useState(() => transaction?.type === "Transfer" ? absoluteText(incomingLeg ? transaction.amount : transaction.transferAmount) : "");
  const isTransfer = type === "Transfer";
  const centers = flattenCostCenters(costCenters);
  const account = accounts.find((item) => item.id === accountId);
  const destination = isTransfer ? accounts.find((item) => item.id === transferAccountId) : undefined;
  const crossCurrency = !!account && !!destination && account.currency !== destination.currency;
  const currencyLabelFor = (code: string) => { const symbol = currencies.find((item) => item.code === code)?.symbol; return `${symbol ? `${symbol} ` : ""}${code}`; };
  const currencyLabel = account ? currencyLabelFor(account.currency) : "Select an account";
  const canReconcile = !!transaction && !transaction.transferId && (transaction.type === "Income" || transaction.type === "Expense");
  const isReconciliation = isTransfer && canReconcile;
  const transactionCurrency = transaction?.currency ?? accounts.find((item) => item.id === transaction?.accountId)?.currency ?? "USD";
  const linkedAccounts = accounts.filter((item) => item.id !== transaction?.accountId);
  // The market rate only suggests what might arrive and how the banks' rate compares; it is never saved.
  const marketQuery = useServerQuery<{ rates: FxRateMap }>("/api/fx/latest", crossCurrency && !isReconciliation ? new URLSearchParams({ base: destination.currency, quotes: account.currency }) : null);
  const market = crossCurrency ? marketQuery.data?.rates[account.currency] : undefined;
  const rate = crossCurrency ? transferRate({ currency: account.currency, amount: Number(sent) }, { currency: destination.currency, amount: Number(received) }) : null;
  const [otherAccountId, setOtherAccountId] = useState("");
  // The date input is in the workspace timezone; the API receives a UTC instant. An unchanged date keeps
  // its original instant so imported transactions stay anchored to their statement's timezone.
  const originalDate = transaction ? utcToZonedDate(transaction.occurredAt, timeZone) : "";
  const [occurredOn, setOccurredOn] = useState(() => originalDate || todayInZone(timeZone));
  const occurredAt = transaction && occurredOn === originalDate ? transaction.occurredAt : isIsoDate(occurredOn) ? zonedDateToUtc(occurredOn, timeZone) : "";
  // The server finds unlinked transactions on the other account with the same amount in the opposite direction.
  const candidateQuery = useServerQuery<{ items: Transaction[] }>("/api/transactions/candidates",
    isReconciliation && otherAccountId ? new URLSearchParams({ transactionId: transaction.id, accountId: otherAccountId }) : null);
  // Never offer the previous account's matches while the new ones load.
  const candidates = candidateQuery.loading ? [] : candidateQuery.data?.items ?? [];
  return <div className="form-grid">
    <input type="hidden" name="type" value={type} />
    <div className="full segmented-input">{(["Expense", "Income", "Transfer"] as const).map((value) => <button type="button" className={type === value ? "active" : ""} key={value} onClick={() => { setType(value); onTransferLinkModeChange?.(value === "Transfer" && canReconcile); }}>{value}</button>)}</div>
    {isReconciliation ? <>
      <input type="hidden" name="linkExistingTransfer" value="true" />
      <div className="full form-hint"><strong>{transaction.type === "Expense" ? "Money left" : "Money arrived"} via {transaction.account}</strong><span>{formatMoney(transaction.amount, transactionCurrency, locale)} · {formatDate(transaction.occurredAt, timeZone, locale)}</span></div>
      {linkedAccounts.length ? <label className="full">Other account<select value={otherAccountId} onChange={(event) => setOtherAccountId(event.target.value)} required><option value="" disabled>Select an account</option>{linkedAccounts.map((item) => <option value={item.id} key={item.id}>{item.name}{item.currency !== transactionCurrency ? ` · ${item.currency}` : ""}</option>)}</select></label> : <div className="full form-hint"><strong>No other accounts</strong><span>Add another account to link this one.</span></div>}
      {otherAccountId && (candidateQuery.loading ? <div className="full form-hint"><span>Looking for matching transactions…</span></div> : candidates.length ? <label className="full">Matching transaction<select name="counterpartTransactionId" defaultValue="" required><option value="" disabled>Select the matching transaction</option>{candidates.map((item) => {
        const implied = transferRate({ currency: transactionCurrency, amount: transaction.amount }, { currency: item.currency, amount: item.amount });
        return <option value={item.id} key={item.id}>{formatDate(item.occurredAt, timeZone, locale)} · {item.merchant} · {formatMoney(item.amount, item.currency, locale)}{implied ? ` · ${formatTransferRate(implied, locale)}` : ""}</option>;
      })}</select></label> : <div className="full form-hint"><strong>No matching transactions found</strong><span>Choose another account or create a new transfer instead.</span></div>)}
    </> : <>
      <label className="full">Description<input name="description" defaultValue={transaction?.merchant} placeholder="What was this for?" required /></label>
      <label><span className="amount-label">{crossCurrency ? "Sent" : "Amount"}<small>{currencyLabel}</small></span><input name="amount" value={sent} onChange={(event) => setSent(event.target.value)} type="number" min="0" step="0.01" placeholder="0.00" required /></label>
      <label>Date<input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} required /><input type="hidden" name="occurredAt" value={occurredAt} /></label>
      <label>{isTransfer ? "From account" : "Account"}<select name="accountId" value={accountId} onChange={(event) => setAccountId(event.target.value)} required><option value="" disabled>Select an account</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
      {isTransfer ? <label>To account<select name="transferAccountId" value={transferAccountId} onChange={(event) => setTransferAccountId(event.target.value)} required><option value="" disabled>Select an account</option>{accounts.filter((account) => account.id !== accountId).map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label> : <label>Cost center<select name="costCenterId" defaultValue={transaction?.costCenterId ?? ""}><option value="">Uncategorized</option>{centers.map((center) => <option value={center.id} key={center.id}>{center.path}</option>)}</select></label>}
      {crossCurrency && <>
        <label><span className="amount-label">Received<small>{currencyLabelFor(destination.currency)}</small></span><input name="transferAmount" value={received} onChange={(event) => setReceived(event.target.value)} type="number" min="0" step="0.01" placeholder={market && Number(sent) > 0 ? `≈ ${(Number(sent) * market.rate).toFixed(2)}` : "0.00"} required /></label>
        <div className="form-hint transfer-rate">{rate
          ? <><strong>{formatTransferRate(rate, locale)}</strong><span>{market ? marketComparison(Number(received) / Number(sent), market.rate) : "The rate your banks applied"}</span></>
          : <><strong>Different currencies</strong><span>Enter what arrived, as shown on the {destination.name} statement.</span></>}</div>
      </>}
      <label className="full">Note<textarea name="note" defaultValue={transaction?.detail} placeholder="Add an optional note..." rows={3} /></label>
    </>}
  </div>;
}

type BatchRow = { key: number; type: Transaction["type"]; description: string; amount: string; transferAmount: string; occurredOn: string; accountId: string; transferAccountId: string; costCenterId: string; note: string };

const firstOtherAccountId = (accounts: Account[], accountId: string) => accounts.find((account) => account.id !== accountId)?.id ?? "";

// Creates several transactions in one submit. Rows are controlled; the form posts them as one JSON field named "batch".
export function BatchTransactionForm({ accounts, costCenters, timeZone = "UTC", onCountChange }: { accounts: Account[]; costCenters: CostCenter[]; timeZone?: string; onCountChange?: (count: number) => void }) {
  const centers = flattenCostCenters(costCenters);
  const nextKey = useRef(1);
  const focusKey = useRef<number | null>(null);
  const [rows, setRows] = useState<BatchRow[]>(() => {
    const accountId = accounts[0]?.id ?? "";
    return [{ key: 0, type: "Expense", description: "", amount: "", transferAmount: "", occurredOn: todayInZone(timeZone), accountId, transferAccountId: firstOtherAccountId(accounts, accountId), costCenterId: "", note: "" }];
  });
  const currencyOf = (accountId: string) => accounts.find((account) => account.id === accountId)?.currency;
  // Only a transfer between two currencies has a separate received amount.
  const receivedCurrency = (row: BatchRow) => row.type === "Transfer" && currencyOf(row.transferAccountId) !== currencyOf(row.accountId) ? currencyOf(row.transferAccountId) : undefined;
  const payload = rows.map((row) => ({
    type: row.type, description: row.description, amount: row.amount, note: row.note, accountId: row.accountId,
    occurredAt: isIsoDate(row.occurredOn) ? zonedDateToUtc(row.occurredOn, timeZone) : "",
    ...(row.type === "Transfer" ? { transferAccountId: row.transferAccountId, ...(receivedCurrency(row) ? { transferAmount: row.transferAmount } : {}) } : { costCenterId: row.costCenterId }),
  }));

  function update(key: number, patch: Partial<BatchRow>) {
    setRows((current) => current.map((row) => {
      if (row.key !== key) return row;
      const next = { ...row, ...patch };
      // A transfer can't land on its own source account.
      if (next.transferAccountId === next.accountId) next.transferAccountId = firstOtherAccountId(accounts, next.accountId);
      return next;
    }));
  }

  function addRow() {
    // New lines repeat the previous line's type, date and accounts, which is how statements are usually typed in.
    const last = rows[rows.length - 1];
    const key = nextKey.current++;
    focusKey.current = key;
    const next = [...rows, { ...last, key, description: "", amount: "", transferAmount: "", costCenterId: "", note: "" }];
    setRows(next); onCountChange?.(next.length);
  }

  function removeRow(key: number) {
    const next = rows.filter((row) => row.key !== key);
    setRows(next); onCountChange?.(next.length);
  }

  return <div className="batch-form">
    <input type="hidden" name="batch" value={JSON.stringify(payload)} />
    <div className="batch-head" aria-hidden="true"><span>Type</span><span>Description</span><span>Amount</span><span>Date</span><span>Account</span><span>Cost center / To</span><span>Note</span><span /></div>
    {rows.map((row, index) => {
      const label = (field: string) => `${field} for transaction ${index + 1}`;
      const received = receivedCurrency(row);
      const sentAmount = <span className="batch-amount"><input aria-label={label(received ? "Amount sent" : "Amount")} value={row.amount} onChange={(event) => update(row.key, { amount: event.target.value })} type="number" min="0" step="0.01" placeholder="0.00" required /><small>{currencyOf(row.accountId)}</small></span>;
      return <div className="batch-row" key={row.key}>
        <select aria-label={label("Type")} value={row.type} onChange={(event) => update(row.key, { type: event.target.value as Transaction["type"] })}>{(["Expense", "Income", "Transfer"] as const).map((value) => <option key={value}>{value}</option>)}</select>
        <input aria-label={label("Description")} value={row.description} onChange={(event) => update(row.key, { description: event.target.value })} placeholder="Description" required
          ref={(input) => { if (input && focusKey.current === row.key) { input.focus(); focusKey.current = null; } }} />
        {received
          ? <span className="batch-amounts">{sentAmount}<span className="batch-amount"><input aria-label={label("Amount received")} value={row.transferAmount} onChange={(event) => update(row.key, { transferAmount: event.target.value })} type="number" min="0" step="0.01" placeholder="Received" required /><small>{received}</small></span></span>
          : sentAmount}
        <input aria-label={label("Date")} type="date" value={row.occurredOn} onChange={(event) => update(row.key, { occurredOn: event.target.value })} required />
        <select aria-label={label(row.type === "Transfer" ? "From account" : "Account")} value={row.accountId} onChange={(event) => update(row.key, { accountId: event.target.value })} required><option value="" disabled>Account</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select>
        {row.type === "Transfer"
          ? <select aria-label={label("To account")} value={row.transferAccountId} onChange={(event) => update(row.key, { transferAccountId: event.target.value })} required><option value="" disabled>To account</option>{accounts.filter((account) => account.id !== row.accountId).map((account) => <option value={account.id} key={account.id}>→ {account.name}</option>)}</select>
          : <select aria-label={label("Cost center")} value={row.costCenterId} onChange={(event) => update(row.key, { costCenterId: event.target.value })}><option value="">Uncategorized</option>{centers.map((center) => <option value={center.id} key={center.id}>{center.path}</option>)}</select>}
        <input aria-label={label("Note")} value={row.note} onChange={(event) => update(row.key, { note: event.target.value })} placeholder="Note (optional)" />
        {rows.length > 1 ? <button type="button" className="icon-button batch-remove" aria-label={`Remove transaction ${index + 1}`} onClick={() => removeRow(row.key)}><X size={16} /></button> : <span />}
      </div>;
    })}
    <button type="button" className="batch-add" onClick={addRow}><Plus size={15} /> Add another transaction</button>
  </div>;
}
