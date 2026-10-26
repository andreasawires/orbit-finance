import type { Transaction } from "@/lib/data";

export type CurrencyAmount = {
  currency: string;
  amount: number;
};

export type FxRate = {
  rate: number;
  date: string;
};

export type FxRateMap = Record<string, FxRate>;

export type CurrencyFlows = {
  inflow: CurrencyAmount[];
  outflow: CurrencyAmount[];
};

function normalizedCurrency(currency: string) {
  return currency.trim().toUpperCase();
}

export function sortCurrencyAmounts(values: Iterable<CurrencyAmount>, mainCurrency: string) {
  const main = normalizedCurrency(mainCurrency);
  return [...values]
    .filter((value) => Number.isFinite(value.amount) && value.amount !== 0)
    .sort((left, right) => {
      if (left.currency === main) return -1;
      if (right.currency === main) return 1;
      return left.currency.localeCompare(right.currency);
    });
}

export function groupCurrencyAmounts(values: Iterable<CurrencyAmount>, mainCurrency: string) {
  const totals = new Map<string, number>();
  for (const value of values) {
    const currency = normalizedCurrency(value.currency);
    totals.set(currency, (totals.get(currency) ?? 0) + value.amount);
  }
  return sortCurrencyAmounts([...totals].map(([currency, amount]) => ({ currency, amount })), mainCurrency);
}

export function currenciesFor(values: Iterable<CurrencyAmount>) {
  return [...new Set([...values].map((value) => normalizedCurrency(value.currency)))].sort();
}

export function canConvertCurrencies(values: Iterable<CurrencyAmount>) {
  return currenciesFor(values).length > 1;
}

export function convertCurrencyAmounts(values: Iterable<CurrencyAmount>, targetCurrency: string, rates: FxRateMap) {
  const target = normalizedCurrency(targetCurrency);
  let total = 0;
  for (const value of values) {
    const currency = normalizedCurrency(value.currency);
    if (currency === target) total += value.amount;
    else {
      const rate = rates[currency]?.rate;
      if (!Number.isFinite(rate) || rate <= 0) return null;
      total += value.amount * rate;
    }
  }
  return total;
}

export function transactionFlows(transactions: Iterable<Pick<Transaction, "amount" | "currency" | "type">>, mainCurrency: string): CurrencyFlows {
  const inflow: CurrencyAmount[] = [];
  const outflow: CurrencyAmount[] = [];
  for (const transaction of transactions) {
    if (transaction.type === "Income") inflow.push({ currency: transaction.currency, amount: transaction.amount });
    if (transaction.type === "Expense") outflow.push({ currency: transaction.currency, amount: Math.abs(transaction.amount) });
  }
  return {
    inflow: groupCurrencyAmounts(inflow, mainCurrency),
    outflow: groupCurrencyAmounts(outflow, mainCurrency),
  };
}

export function nativeAmountForCurrency(values: Iterable<CurrencyAmount>, currency: string) {
  const target = normalizedCurrency(currency);
  return [...values].filter((value) => normalizedCurrency(value.currency) === target).reduce((total, value) => total + value.amount, 0);
}
