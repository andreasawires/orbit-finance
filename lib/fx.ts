import type { FxRateMap } from "@/lib/currency-summary";

const currencyCode = /^[A-Z]{3}$/;
const frankfurterUrl = "https://api.frankfurter.dev/v2/rates";

type FrankfurterRate = {
  date?: unknown;
  base?: unknown;
  quote?: unknown;
  rate?: unknown;
};

export type LatestFxRates = {
  targetCurrency: string;
  rates: FxRateMap;
  providerLabel: "Frankfurter Central Bank Rates";
};

export function normalizeCurrencyCode(value: string) {
  const code = value.trim().toUpperCase();
  if (!currencyCode.test(code)) throw new Error("Currency codes must be three-letter ISO codes.");
  return code;
}

export function normalizeCurrencyCodes(values: string[]) {
  return [...new Set(values.map(normalizeCurrencyCode))];
}

export function normalizeFrankfurterRates(targetCurrency: string, sourceCurrencies: string[], payload: unknown): LatestFxRates {
  const target = normalizeCurrencyCode(targetCurrency);
  const sources = normalizeCurrencyCodes(sourceCurrencies).filter((currency) => currency !== target);
  if (!Array.isArray(payload)) throw new Error("Frankfurter returned an invalid rate response.");
  const rows = payload as FrankfurterRate[];
  const rates: FxRateMap = {};
  for (const sourceCurrency of sources) {
    const upstream = rows.find((row) => row.base === target && row.quote === sourceCurrency);
    const value = typeof upstream?.rate === "number" ? upstream.rate : Number(upstream?.rate);
    const date = typeof upstream?.date === "string" ? upstream.date : "";
    if (!Number.isFinite(value) || value <= 0 || !date) throw new Error(`Frankfurter did not return a current rate for ${sourceCurrency}.`);
    rates[sourceCurrency] = { rate: 1 / value, date };
  }
  return { targetCurrency: target, rates, providerLabel: "Frankfurter Central Bank Rates" };
}

export async function loadLatestFxRates(targetCurrency: string, sourceCurrencies: string[], fetcher: typeof fetch = fetch): Promise<LatestFxRates> {
  const target = normalizeCurrencyCode(targetCurrency);
  const sources = normalizeCurrencyCodes(sourceCurrencies);
  const quotes = sources.filter((currency) => currency !== target);
  if (!quotes.length) return { targetCurrency: target, rates: {}, providerLabel: "Frankfurter Central Bank Rates" };
  const url = new URL(frankfurterUrl);
  url.searchParams.set("base", target);
  url.searchParams.set("quotes", quotes.join(","));
  const response = await fetcher(url, { cache: "no-store", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Frankfurter Central Bank Rates are temporarily unavailable.");
  return normalizeFrankfurterRates(target, sources, await response.json());
}
