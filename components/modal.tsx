"use client";

import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Account, CostCenter, Currency, Transaction } from "@/lib/data";
import { flattenCostCenters, formatMoney } from "@/lib/data";

export function Modal({ open, onClose, title, subtitle, children, action = "Save changes", onSubmit }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode; action?: string; onSubmit?: (data: FormData) => Promise<unknown> | unknown;
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
      <form className="modal" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose}><X size={20} /></button></div>
        <div className="modal-body">{children}</div>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-foot"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={saving}><Check size={17} />{saving ? "Saving…" : action}</button></div>
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

export function TransactionForm({ accounts, costCenters, currencies, transactions = [], transaction, locale = "en-US", onTransferLinkModeChange }: { accounts: Account[]; costCenters: CostCenter[]; currencies: Currency[]; transactions?: Transaction[]; transaction?: Transaction | null; locale?: string; onTransferLinkModeChange?: (active: boolean) => void }) {
  const [type, setType] = useState<Transaction["type"]>(transaction?.type ?? "Expense");
  const initialSourceAccountId = transaction?.type === "Transfer" && transaction.amount > 0 ? transaction.transferAccountId ?? "" : transaction?.accountId ?? accounts[0]?.id ?? "";
  const initialDestinationAccountId = transaction?.type === "Transfer" && transaction.amount < 0 ? transaction.transferAccountId ?? "" : transaction?.type === "Transfer" ? transaction?.accountId ?? "" : accounts.find((account) => account.id !== initialSourceAccountId)?.id ?? "";
  const [accountId, setAccountId] = useState(initialSourceAccountId);
  const [transferAccountId, setTransferAccountId] = useState(initialDestinationAccountId);
  const isTransfer = type === "Transfer";
  const centers = flattenCostCenters(costCenters);
  const account = accounts.find((item) => item.id === accountId);
  const currency = currencies.find((item) => item.code === account?.currency);
  const currencyLabel = account ? `${currency?.symbol ? `${currency.symbol} ` : ""}${account.currency}` : "Select an account";
  const canReconcile = !!transaction && !transaction.transferId && (transaction.type === "Income" || transaction.type === "Expense");
  const isReconciliation = isTransfer && canReconcile;
  const transactionCurrency = transaction?.currency ?? accounts.find((item) => item.id === transaction?.accountId)?.currency ?? "USD";
  const linkedAccounts = accounts.filter((item) => item.id !== transaction?.accountId && item.currency === transactionCurrency);
  const [otherAccountId, setOtherAccountId] = useState("");
  const candidates = isReconciliation ? transactions.filter((item) =>
    item.id !== transaction?.id && item.accountId === otherAccountId && !item.transferId &&
    ((transaction.amount < 0 && item.type === "Income" && item.amount > 0) || (transaction.amount > 0 && item.type === "Expense" && item.amount < 0)) &&
    Math.abs(item.amount) === Math.abs(transaction.amount)
  ) : [];
  return <div className="form-grid">
    <input type="hidden" name="type" value={type} />
    <div className="full segmented-input">{(["Expense", "Income", "Transfer"] as const).map((value) => <button type="button" className={type === value ? "active" : ""} key={value} onClick={() => { setType(value); onTransferLinkModeChange?.(value === "Transfer" && canReconcile); }}>{value}</button>)}</div>
    {isReconciliation ? <>
      <input type="hidden" name="linkExistingTransfer" value="true" />
      <div className="full form-hint"><strong>{transaction.type === "Expense" ? "Money left" : "Money arrived"} via {transaction.account}</strong><span>{formatMoney(transaction.amount, transactionCurrency, locale)} · {transaction.date}</span></div>
      <label className="full">Other account<select value={otherAccountId} onChange={(event) => setOtherAccountId(event.target.value)} required><option value="" disabled>Select an account</option>{linkedAccounts.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      {otherAccountId && (candidates.length ? <label className="full">Matching transaction<select name="counterpartTransactionId" defaultValue="" required><option value="" disabled>Select the matching transaction</option>{candidates.map((item) => <option value={item.id} key={item.id}>{item.date} · {item.merchant} · {formatMoney(item.amount, item.currency, locale)}</option>)}</select></label> : <div className="full form-hint"><strong>No matching transactions found</strong><span>Choose another account or create a new transfer instead.</span></div>)}
    </> : <>
      <label className="full">Description<input name="description" defaultValue={transaction?.merchant} placeholder="What was this for?" required /></label>
      <label><span className="amount-label">Amount<small>{currencyLabel}</small></span><input name="amount" defaultValue={transaction ? Math.abs(transaction.amount) : undefined} type="number" min="0" step="0.01" placeholder="0.00" required /></label>
      <label>Date<input name="occurredOn" type="date" defaultValue={transaction?.occurredOn ?? new Date().toISOString().slice(0, 10)} required /></label>
      <label>{isTransfer ? "From account" : "Account"}<select name="accountId" value={accountId} onChange={(event) => setAccountId(event.target.value)} required><option value="" disabled>Select an account</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
      {isTransfer ? <label>To account<select name="transferAccountId" value={transferAccountId} onChange={(event) => setTransferAccountId(event.target.value)} required><option value="" disabled>Select an account</option>{accounts.filter((account) => account.id !== accountId).map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label> : <label>Cost center<select name="costCenterId" defaultValue={transaction?.costCenterId ?? ""}><option value="">Uncategorized</option>{centers.map((center) => <option value={center.id} key={center.id}>{center.path}</option>)}</select></label>}
      <label className="full">Note<textarea name="note" defaultValue={transaction?.detail} placeholder="Add an optional note..." rows={3} /></label>
    </>}
  </div>;
}
