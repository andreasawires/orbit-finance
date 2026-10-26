import assert from "node:assert/strict";
import test from "node:test";
import { formatTransferRate, otherLeg, transferRate, transferReceivedAmount, transferRoute } from "@/lib/transfer";

// Intl separates a currency code from its amount with a no-break space.
const plain = (text: string) => text.replace(/\u00a0/g, " ");

const eur = { currency: "EUR", sameCurrency: false };
const usd = { currency: "USD", sameCurrency: true };

test("same-currency transfers receive exactly what was sent", () => {
  assert.equal(transferReceivedAmount(100, usd, undefined), 100);
  assert.equal(transferReceivedAmount(100, usd, ""), 100);
  assert.equal(transferReceivedAmount(100, usd, "100"), 100);
  assert.throws(() => transferReceivedAmount(100, usd, "99"), /same amount/);
});

test("cross-currency transfers require the amount that arrived", () => {
  assert.equal(transferReceivedAmount(20000, eur, "315"), 315);
  for (const missing of [undefined, "", "0", "-315", "abc"]) {
    assert.throws(() => transferReceivedAmount(20000, eur, missing), /amount received in EUR/);
  }
});

test("the implied rate is quoted per unit of the stronger currency", () => {
  const rate = transferRate({ currency: "EGP", amount: -20000 }, { currency: "EUR", amount: 315 });
  assert.equal(rate?.unit, "EUR");
  assert.equal(rate?.quote, "EGP");
  assert.ok(Math.abs(rate!.rate - 63.492) < 0.001);
  assert.deepEqual(transferRate({ currency: "EUR", amount: -315 }, { currency: "EGP", amount: 20000 }), rate);
  assert.equal(plain(formatTransferRate(rate!, "en-US")), "1 EUR = EGP 63.4921");
});

test("no rate without two currencies and two amounts", () => {
  assert.equal(transferRate({ currency: "EUR", amount: -10 }, { currency: "EUR", amount: 10 }), null);
  assert.equal(transferRate({ currency: "EGP", amount: -20000 }, { currency: "EUR", amount: 0 }), null);
});

test("transfer routes name both amounts only across currencies", () => {
  const outgoing = { account: "EGP Main", amount: -20000, currency: "EGP", transferAmount: 315, transferCurrency: "EUR" };
  assert.deepEqual(otherLeg(outgoing), { currency: "EUR", amount: 315 });
  assert.equal(plain(transferRoute(outgoing, "EUR Savings")), "EGP Main (EGP 20,000.00) → EUR Savings (€315.00)");
  const incoming = { account: "EUR Savings", amount: 315, currency: "EUR", transferAmount: -20000, transferCurrency: "EGP" };
  assert.equal(plain(transferRoute(incoming, "EGP Main")), "EGP Main (EGP 20,000.00) → EUR Savings (€315.00)");
  const local = { account: "Checking", amount: -50, currency: "USD", transferAmount: 50, transferCurrency: "USD" };
  assert.equal(otherLeg(local), null);
  assert.equal(transferRoute(local, "Savings"), "Checking → Savings");
});
