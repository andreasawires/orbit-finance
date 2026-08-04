"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { CurrencyAmount, FxRateMap } from "@/lib/currency-summary";
import { canConvertCurrencies, currenciesFor, sortCurrencyAmounts } from "@/lib/currency-summary";
import { formatMoney } from "@/lib/data";

export type CurrencyDisplayMode = "native" | "converted";

type FxResponse = {
  targetCurrency: string;
  rates: FxRateMap;
  providerLabel: string;
};

export function useCurrencyPresentation(values: CurrencyAmount[], targetCurrency: string) {
  const sourceCurrencies = useMemo(() => currenciesFor(values), [values]);
  const currencyKey = sourceCurrencies.join(",");
  const canConvert = sourceCurrencies.length > 1;
  const [mode, setMode] = useState<CurrencyDisplayMode>("native");
  const [rates, setRates] = useState<FxRateMap | null>(null);
  const [providerLabel, setProviderLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const quotes = currencyKey.split(",").filter((currency) => currency && currency !== targetCurrency);
    if (!quotes.length) return;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ base: targetCurrency, quotes: quotes.join(",") });
      const response = await fetch(`/api/fx/latest?${query}`, { cache: "no-store" });
      const payload = await response.json() as FxResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Current exchange rates are unavailable.");
      setRates(payload.rates);
      setProviderLabel(payload.providerLabel);
    } catch (caught) {
      setRates(null);
      setError(caught instanceof Error ? caught.message : "Current exchange rates are unavailable.");
    } finally {
      setLoading(false);
    }
  }, [currencyKey, targetCurrency]);

  const setDisplayMode = useCallback((nextMode: CurrencyDisplayMode) => {
    if (nextMode === "converted" && !canConvert) return;
    setMode(nextMode);
    if (nextMode === "converted") void refresh();
  }, [canConvert, refresh]);

  const rateDates = useMemo(() => {
    if (!rates) return [];
    return [...new Set(Object.values(rates).map((rate) => rate.date).filter(Boolean))].sort();
  }, [rates]);

  return { mode: canConvert ? mode : "native" as CurrencyDisplayMode, setDisplayMode, canConvert, rates, providerLabel, rateDates, loading, error, refresh };
}

export function CurrencyModeControl({
  targetCurrency,
  mode,
  setMode,
  loading,
  error,
  providerLabel,
  rateDates,
  onRefresh,
}: {
  targetCurrency: string;
  mode: CurrencyDisplayMode;
  setMode: (mode: CurrencyDisplayMode) => void;
  loading: boolean;
  error: string;
  providerLabel: string;
  rateDates: string[];
  onRefresh: () => void;
}) {
  const dateLabel = rateDates.length === 1 ? rateDates[0] : rateDates.length > 1 ? `${rateDates[0]}–${rateDates.at(-1)}` : "";
  return <div className="currency-mode-wrap">
    <div className="currency-mode" role="group" aria-label="Currency display mode">
      <button type="button" className={mode === "native" ? "active" : ""} onClick={() => setMode("native")}>Native amounts</button>
      <button type="button" className={mode === "converted" ? "active" : ""} onClick={() => setMode("converted")} disabled={loading}>Convert to {targetCurrency}</button>
      {mode === "converted" && <button type="button" className="currency-refresh" onClick={onRefresh} disabled={loading} title="Refresh current reference rates" aria-label="Refresh current reference rates"><RefreshCw size={13} className={loading ? "spin" : ""} /></button>}
    </div>
    {mode === "converted" && loading && <small className="currency-rate-status">Loading latest reference rates…</small>}
    {mode === "converted" && !loading && error && <small className="currency-rate-status error">Conversion unavailable: {error}</small>}
    {mode === "converted" && !loading && !error && providerLabel && <small className="currency-rate-status">{providerLabel}{dateLabel ? ` · ${dateLabel}` : ""}</small>}
  </div>;
}

export function CurrencyAmounts({
  values,
  locale,
  mainCurrency,
  mode = "native",
  rates,
  sign,
  className = "",
}: {
  values: CurrencyAmount[];
  locale: string;
  mainCurrency: string;
  mode?: CurrencyDisplayMode;
  rates?: FxRateMap | null;
  sign?: "+" | "−";
  className?: string;
}) {
  const native = sortCurrencyAmounts(values, mainCurrency);
  const converted = mode === "converted" && rates
    ? native.reduce<number | null>((total, value) => {
      if (total === null) return null;
      const rate = value.currency === mainCurrency ? 1 : rates[value.currency]?.rate;
      return Number.isFinite(rate) && rate > 0 ? total + value.amount * rate : null;
    }, 0)
    : null;
  const shown = converted === null ? native : [{ currency: mainCurrency, amount: converted }];
  return <span className={`currency-amounts ${className}`.trim()}>{shown.map((value) => <span key={value.currency}>{sign}{formatMoney(value.amount, value.currency, locale)}</span>)}</span>;
}

export function hasConvertibleCurrencies(values: CurrencyAmount[]) {
  return canConvertCurrencies(values);
}
