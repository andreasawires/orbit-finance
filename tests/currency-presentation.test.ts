import assert from "node:assert/strict";
import test from "node:test";
import { lockedAccountCurrency } from "@/lib/account-currency";
import { convertCurrencyAmounts, groupCurrencyAmounts, transactionFlows } from "@/lib/currency-summary";
import { loadLatestFxRates, normalizeFrankfurterRates } from "@/lib/fx";

test("groups native amounts by currency with the main currency first", () => {
  const grouped = groupCurrencyAmounts([
    { currency: "AED", amount: 78 },
    { currency: "USD", amount: 20 },
    { currency: "AED", amount: 22 },
  ], "USD");
  assert.deepEqual(grouped, [{ currency: "USD", amount: 20 }, { currency: "AED", amount: 100 }]);
});

test("transaction flows preserve native currencies and exclude transfers", () => {
  const flows = transactionFlows([
    { type: "Expense", currency: "AED", amount: -80 },
    { type: "Income", currency: "AED", amount: 100 },
    { type: "Expense", currency: "USD", amount: -10 },
    { type: "Transfer", currency: "AED", amount: -500 },
  ], "USD");
  assert.deepEqual(flows.outflow, [{ currency: "USD", amount: 10 }, { currency: "AED", amount: 80 }]);
  assert.deepEqual(flows.inflow, [{ currency: "AED", amount: 100 }]);
});

test("conversion uses the current source-to-reporting rate without early rounding", () => {
  const converted = convertCurrencyAmounts([
    { currency: "AED", amount: 367.25 },
    { currency: "USD", amount: 10.015 },
  ], "USD", { AED: { rate: 1 / 3.6725, date: "2026-08-03" } });
  assert.ok(converted);
  assert.equal(Number(converted.toFixed(6)), 110.015);
});

test("missing FX data refuses a partial converted total", () => {
  assert.equal(convertCurrencyAmounts([{ currency: "AED", amount: 10 }, { currency: "EUR", amount: 10 }], "USD", { AED: { rate: 0.27, date: "2026-08-03" } }), null);
});

test("Frankfurter rows normalize to source-to-target current rates", () => {
  const normalized = normalizeFrankfurterRates("USD", ["AED", "USD"], [
    { base: "USD", quote: "AED", rate: 3.6725, date: "2026-08-01" },
  ]);
  assert.equal(normalized.providerLabel, "Frankfurter Central Bank Rates");
  assert.equal(normalized.rates.AED.date, "2026-08-01");
  assert.equal(normalized.rates.AED.rate, 1 / 3.6725);
});

test("Frankfurter loader validates the provider response and its request", async () => {
  let requested = "";
  const result = await loadLatestFxRates("USD", ["AED", "USD"], async (input) => {
    requested = String(input);
    return new Response(JSON.stringify([{ base: "USD", quote: "AED", rate: 3.6725, date: "2026-08-01" }]));
  });
  assert.match(requested, /base=USD/);
  assert.match(requested, /quotes=AED/);
  assert.equal(result.rates.AED.rate, 1 / 3.6725);
  await assert.rejects(() => loadLatestFxRates("USD", ["AED"], async () => new Response("unavailable", { status: 503 })), /temporarily unavailable/);
});

test("account currency remains immutable after creation", () => {
  assert.equal(lockedAccountCurrency("AED", undefined), "AED");
  assert.equal(lockedAccountCurrency("aed", "AED"), "AED");
  assert.throws(() => lockedAccountCurrency("AED", "USD"), /currency is locked/);
});
