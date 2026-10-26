import type { CurrencyAmount } from "@/lib/currency-summary";
import { formatMoney, type Transaction } from "@/lib/data";

/** What arrives on the destination account. Same-currency transfers move one amount; across currencies the bank decides. */
export function transferReceivedAmount(sent: number, destination: { currency: string; sameCurrency: boolean }, transferAmount: unknown) {
  const given = transferAmount == null || transferAmount === "" ? null : Number(transferAmount);
  if (destination.sameCurrency) {
    if (given !== null && Math.abs(given) !== sent) throw new Error("Same-currency transfers send and receive the same amount.");
    return sent;
  }
  if (given === null || !Number.isFinite(given) || given <= 0) throw new Error(`Enter the amount received in ${destination.currency}.`);
  return given;
}

export type TransferRate = { unit: string; quote: string; rate: number };

/** The implied rate, quoted so that one unit of the stronger currency is worth `rate` (≥ 1) of the other. */
export function transferRate(sent: CurrencyAmount, received: CurrencyAmount): TransferRate | null {
  const out = Math.abs(sent.amount);
  const into = Math.abs(received.amount);
  if (!out || !into || sent.currency === received.currency) return null;
  return out >= into ? { unit: received.currency, quote: sent.currency, rate: out / into } : { unit: sent.currency, quote: received.currency, rate: into / out };
}

/** The other leg of a cross-currency transfer, or null when both legs share a currency (and so an amount). */
export function otherLeg(leg: Pick<Transaction, "currency" | "transferAmount" | "transferCurrency">): CurrencyAmount | null {
  return leg.transferAmount != null && leg.transferCurrency && leg.transferCurrency !== leg.currency ? { currency: leg.transferCurrency, amount: leg.transferAmount } : null;
}

/** "EGP Main → EUR Savings", naming what each side moved when the two currencies differ. */
export function transferRoute(leg: Pick<Transaction, "account" | "amount" | "currency" | "transferAmount" | "transferCurrency">, counterpart: string, locale = "en-US") {
  const other = otherLeg(leg);
  const side = (name: string, value: CurrencyAmount | null) => value ? `${name} (${formatMoney(Math.abs(value.amount), value.currency, locale)})` : name;
  const here = side(leg.account, other && { currency: leg.currency, amount: leg.amount });
  const there = side(counterpart, other);
  return leg.amount < 0 ? `${here} → ${there}` : `${there} → ${here}`;
}

// Up to four decimals, so close pairs like EUR/USD keep their precision.
export const formatTransferRate = ({ unit, quote, rate }: TransferRate, locale = "en-US") =>
  `1 ${unit} = ${new Intl.NumberFormat(locale, { style: "currency", currency: quote, currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(rate)}`;
