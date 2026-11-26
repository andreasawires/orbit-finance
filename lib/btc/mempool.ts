// Minimal client for the public Esplora-compatible APIs (mempool.space, with blockstream.info as fallback).
// Free and keyless. Every function takes an injectable `fetcher` so tests never hit the network.

export const SATS_PER_BTC = 100_000_000;
export const WALLET_IMPORT_CAP = 200;
const REQUEST_TIMEOUT_MS = 10_000;

const DEFAULT_BASE_URLS = ["https://mempool.space/api", "https://blockstream.info/api"];

/** BTC_API_BASE_URL (comma-separated) replaces the defaults, e.g. a self-hosted mempool instance. */
export function btcApiBaseUrls(env: Record<string, string | undefined> = process.env) {
  const configured = (env.BTC_API_BASE_URL ?? "").split(",").map((url) => url.trim().replace(/\/+$/, "")).filter(Boolean);
  return configured.length ? configured : DEFAULT_BASE_URLS;
}

type Fetcher = typeof fetch;

export type EsploraTx = {
  txid: string;
  status: { confirmed: boolean; block_time?: number };
  vin: Array<{ prevout?: { scriptpubkey_address?: string; value: number } | null }>;
  vout: Array<{ scriptpubkey_address?: string; value: number }>;
};

export type WalletTx = { txid: string; netSats: number; blockTime: Date };

const base58Address = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const bech32Address = /^bc1[ac-hj-np-z02-9]{11,71}$/;

/** Mainnet P2PKH/P2SH (1…, 3…) or SegWit/Taproot (bc1…). The API is the final judge of validity. */
export function normalizeBtcAddress(value: unknown) {
  const raw = String(value ?? "").trim();
  const address = /^bc1/i.test(raw) ? raw.toLowerCase() : raw;
  if (!base58Address.test(address) && !bech32Address.test(address)) throw new Error("Enter a valid Bitcoin mainnet address (1…, 3… or bc1…).");
  return address;
}

class RetryableError extends Error {}

async function getJson<T>(path: string, fetcher: Fetcher, baseUrls = btcApiBaseUrls()): Promise<T> {
  let lastError: unknown = null;
  for (const base of baseUrls) {
    try {
      const response = await fetcher(`${base}${path}`, { cache: "no-store", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (response.status === 400 || response.status === 404) throw new Error("The blockchain API rejected this Bitcoin address.");
      if (!response.ok) throw new RetryableError(`Blockchain API responded with ${response.status}.`);
      return await response.json() as T;
    } catch (error) {
      // A rejected address is the same everywhere; anything else (timeouts, 5xx, 429) tries the next provider.
      if (error instanceof Error && !(error instanceof RetryableError) && /rejected this Bitcoin address/.test(error.message)) throw error;
      lastError = error;
    }
  }
  throw new Error(`Bitcoin blockchain data is temporarily unavailable${lastError instanceof Error ? ` (${lastError.message})` : ""}.`);
}

/** Confirmed on-chain balance in satoshis. */
export async function fetchAddressBalanceSats(address: string, fetcher: Fetcher = fetch) {
  const payload = await getJson<{ chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number } }>(`/address/${encodeURIComponent(address)}`, fetcher);
  const funded = Number(payload.chain_stats?.funded_txo_sum);
  const spent = Number(payload.chain_stats?.spent_txo_sum);
  if (!Number.isSafeInteger(funded) || !Number.isSafeInteger(spent)) throw new Error("The blockchain API returned an invalid balance.");
  return funded - spent;
}

/** What the transaction did to this address: received outputs minus spent inputs, in satoshis. */
export function netSatsForAddress(tx: EsploraTx, address: string) {
  const received = tx.vout.reduce((sum, output) => sum + (output.scriptpubkey_address === address ? output.value : 0), 0);
  const spent = tx.vin.reduce((sum, input) => sum + (input.prevout?.scriptpubkey_address === address ? input.prevout.value : 0), 0);
  return received - spent;
}

/**
 * Newest-first confirmed transactions, 25 per page, until `stopAtTxid` (already stored) or `cap` is reached.
 * Transactions with no net effect on the address are skipped but still count toward paging.
 */
export async function fetchConfirmedWalletTxs(address: string, { stopAtTxid = null, cap = WALLET_IMPORT_CAP }: { stopAtTxid?: string | null; cap?: number } = {}, fetcher: Fetcher = fetch) {
  const result: WalletTx[] = [];
  let lastSeen: string | null = null;
  let seen = 0;
  while (seen < cap) {
    const path: string = `/address/${encodeURIComponent(address)}/txs/chain${lastSeen ? `/${lastSeen}` : ""}`;
    const page = await getJson<EsploraTx[]>(path, fetcher);
    if (!Array.isArray(page) || !page.length) break;
    for (const tx of page) {
      if (tx.txid === stopAtTxid || seen >= cap) return result;
      seen += 1;
      if (!tx.status?.confirmed || !tx.status.block_time) continue;
      const netSats = netSatsForAddress(tx, address);
      if (netSats !== 0) result.push({ txid: tx.txid, netSats, blockTime: new Date(tx.status.block_time * 1000) });
    }
    if (page.length < 25) break;
    lastSeen = page[page.length - 1].txid;
  }
  return result;
}

/** Latest BTC price in USD from mempool.space. Only mempool-compatible hosts serve /v1/prices. */
export async function fetchBtcUsdPrice(fetcher: Fetcher = fetch) {
  const bases = btcApiBaseUrls().filter((url) => !/blockstream\.info/.test(url));
  const payload = await getJson<{ USD?: unknown; time?: unknown }>("/v1/prices", fetcher, bases.length ? bases : ["https://mempool.space/api"]);
  const usd = Number(payload.USD);
  if (!Number.isFinite(usd) || usd <= 0) throw new Error("mempool.space did not return a BTC price.");
  const date = typeof payload.time === "number" ? new Date(payload.time * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  return { usd, date };
}

export const satsToBtc = (sats: number) => sats / SATS_PER_BTC;
