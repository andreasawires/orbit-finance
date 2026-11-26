import assert from "node:assert/strict";
import test from "node:test";
import { btcApiBaseUrls, fetchAddressBalanceSats, fetchConfirmedWalletTxs, netSatsForAddress, normalizeBtcAddress, type EsploraTx } from "@/lib/btc/mempool";
import { formatMoney } from "@/lib/data";
import { loadLatestFxRates } from "@/lib/fx";

const address = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const other = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const txid = (n: number) => n.toString(16).padStart(64, "0");

function tx(n: number, { received = 0, spent = 0 }: { received?: number; spent?: number }, confirmed = true): EsploraTx {
  return {
    txid: txid(n),
    status: confirmed ? { confirmed: true, block_time: 1_700_000_000 + n } : { confirmed: false },
    vin: spent ? [{ prevout: { scriptpubkey_address: address, value: spent } }] : [{ prevout: { scriptpubkey_address: other, value: received + 1000 } }],
    vout: [
      ...(received ? [{ scriptpubkey_address: address, value: received }] : []),
      { scriptpubkey_address: other, value: 500 },
    ],
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("addresses: mainnet formats are accepted and bech32 is lower-cased", () => {
  assert.equal(normalizeBtcAddress(` ${address.toUpperCase()} `), address);
  assert.equal(normalizeBtcAddress("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"), "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2");
  assert.equal(normalizeBtcAddress("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"), "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy");
  assert.throws(() => normalizeBtcAddress("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"), /valid Bitcoin mainnet address/);
  assert.throws(() => normalizeBtcAddress("0x52908400098527886E0F7030069857D2E4169EE7"), /valid Bitcoin mainnet address/);
});

test("net effect: receive, send with change, and self-transfer", () => {
  assert.equal(netSatsForAddress(tx(1, { received: 50_000 }), address), 50_000);
  const sendWithChange: EsploraTx = {
    txid: txid(2), status: { confirmed: true, block_time: 1 },
    vin: [{ prevout: { scriptpubkey_address: address, value: 100_000 } }],
    vout: [{ scriptpubkey_address: other, value: 60_000 }, { scriptpubkey_address: address, value: 39_000 }],
  };
  assert.equal(netSatsForAddress(sendWithChange, address), -61_000);
  const consolidation: EsploraTx = {
    txid: txid(3), status: { confirmed: true, block_time: 1 },
    vin: [{ prevout: { scriptpubkey_address: address, value: 10_000 } }], vout: [{ scriptpubkey_address: address, value: 10_000 }],
  };
  assert.equal(netSatsForAddress(consolidation, address), 0);
});

test("balance comes from confirmed chain stats", async () => {
  const balance = await fetchAddressBalanceSats(address, async () => json({ chain_stats: { funded_txo_sum: 150_000, spent_txo_sum: 40_000 }, mempool_stats: { funded_txo_sum: 999 } }));
  assert.equal(balance, 110_000);
});

test("history pages by last txid and stops at the 200 cap", async () => {
  const requested: string[] = [];
  const all = Array.from({ length: 300 }, (_, i) => tx(300 - i, { received: 1000 + i }));
  const result = await fetchConfirmedWalletTxs(address, {}, async (input) => {
    const url = String(input);
    requested.push(url);
    const after = url.match(/txs\/chain\/([0-9a-f]{64})$/)?.[1];
    const start = after ? all.findIndex((item) => item.txid === after) + 1 : 0;
    return json(all.slice(start, start + 25));
  });
  assert.equal(result.length, 200);
  assert.equal(requested.length, 8);
  assert.match(requested[1], new RegExp(`/txs/chain/${all[24].txid}$`));
  assert.equal(result[0].txid, all[0].txid);
  assert.equal(result[0].blockTime.toISOString(), new Date(all[0].status.block_time! * 1000).toISOString());
});

test("incremental sync stops at the newest stored txid and skips zero-effect transactions", async () => {
  const page = [tx(5, { received: 10 }), tx(4, {}), tx(3, { spent: 700 }), tx(2, { received: 1 }), tx(1, { received: 1 })];
  const result = await fetchConfirmedWalletTxs(address, { stopAtTxid: txid(2) }, async () => json(page));
  assert.deepEqual(result.map((item) => [item.txid, item.netSats]), [[txid(5), 10], [txid(3), -700]]);
});

test("falls back to the next provider on 5xx, but not on a rejected address", async () => {
  const hosts: string[] = [];
  const balance = await fetchAddressBalanceSats(address, async (input) => {
    hosts.push(new URL(String(input)).host);
    return hosts.length === 1 ? new Response("busy", { status: 503 }) : json({ chain_stats: { funded_txo_sum: 5, spent_txo_sum: 0 } });
  });
  assert.equal(balance, 5);
  assert.deepEqual(hosts, ["mempool.space", "blockstream.info"]);
  let calls = 0;
  await assert.rejects(() => fetchAddressBalanceSats(address, async () => { calls += 1; return new Response("Invalid Bitcoin address", { status: 400 }); }), /rejected this Bitcoin address/);
  assert.equal(calls, 1);
  await assert.rejects(() => fetchAddressBalanceSats(address, async () => new Response("down", { status: 502 })), /temporarily unavailable/);
});

test("BTC_API_BASE_URL overrides the providers", () => {
  assert.deepEqual(btcApiBaseUrls({ BTC_API_BASE_URL: "http://node.local/api/, http://backup/api" }), ["http://node.local/api", "http://backup/api"]);
  assert.deepEqual(btcApiBaseUrls({}), ["https://mempool.space/api", "https://blockstream.info/api"]);
});

test("BTC converts through USD: mempool BTC→USD, Frankfurter USD→target", async () => {
  const requested: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("/v1/prices")) return json({ time: 1_763_000_000, USD: 100_000, EUR: 92_000 });
    // Frankfurter: base=EUR, quotes=AED,USD (EUR per quote is 1/rate).
    return json([{ base: "EUR", quote: "AED", rate: 4, date: "2026-11-12" }, { base: "EUR", quote: "USD", rate: 1.25, date: "2026-11-12" }]);
  };
  const result = await loadLatestFxRates("EUR", ["BTC", "AED"], fetcher);
  assert.equal(result.rates.BTC.rate, 100_000 / 1.25);
  assert.equal(result.rates.AED.rate, 1 / 4);
  assert.equal(result.rates.USD, undefined);
  assert.match(result.providerLabel, /mempool/);
  assert.ok(requested.some((url) => /quotes=AED%2CUSD|quotes=AED,USD/.test(url)));

  const usd = await loadLatestFxRates("USD", ["BTC"], async () => json({ time: 1_763_000_000, USD: 100_000 }));
  assert.equal(usd.rates.BTC.rate, 100_000);

  const toBtc = await loadLatestFxRates("BTC", ["USD", "EUR"], async (input) => String(input).includes("/v1/prices")
    ? json({ time: 1_763_000_000, USD: 100_000 })
    : json([{ base: "USD", quote: "EUR", rate: 0.8, date: "2026-11-12" }]));
  assert.equal(toBtc.rates.USD.rate, 1 / 100_000);
  assert.equal(toBtc.rates.EUR.rate, (1 / 0.8) / 100_000);
});

test("BTC amounts keep satoshi precision when formatted", () => {
  const plain = (value: string) => value.replace(/\s/g, " ");
  assert.equal(plain(formatMoney(0.00012345, "BTC")), "BTC 0.00012345");
  assert.equal(plain(formatMoney(1.5, "BTC")), "BTC 1.50");
  assert.equal(formatMoney(1234.5, "USD"), "$1,234.50");
});
