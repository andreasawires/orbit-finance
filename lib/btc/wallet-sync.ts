import "server-only";
import { ensureDatabaseSchema } from "@/lib/db";
import { db } from "@/lib/database";
import { fetchAddressBalanceSats, fetchConfirmedWalletTxs, normalizeBtcAddress, WALLET_IMPORT_CAP } from "@/lib/btc/mempool";

export const WALLET_ACCOUNT_KIND = "Crypto wallet";
/** Page loads within this window reuse the last sync; the refresh button passes `force`. */
const SYNC_THROTTLE_SECONDS = 60;

export type WalletSyncResult = { accountId: string; status: "synced" | "skipped" | "failed"; imported: number; error?: string };

export async function createBtcWallet(workspaceId: string, input: Record<string, unknown>) {
  await ensureDatabaseSchema();
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Account name is required.");
  const address = normalizeBtcAddress(input.address);
  const btc = await db.query("SELECT 1 FROM currencies WHERE workspace_id=$1 AND code='BTC'", [workspaceId]);
  if (!btc.rowCount) throw new Error("Add BTC in Settings → Currencies before adding a Bitcoin wallet.");
  // Reject unknown or malformed addresses before anything is created.
  await fetchAddressBalanceSats(address);

  const client = await db.connect();
  let accountId: string;
  try {
    await client.query("BEGIN");
    const account = await client.query<{ id: string }>(`INSERT INTO accounts (workspace_id, name, institution, last_four, opening_balance, currency, color, kind)
      VALUES ($1, $2, 'Bitcoin', '', 0, 'BTC', $3, $4) RETURNING id`, [workspaceId, name, input.color ?? "#db6e30", WALLET_ACCOUNT_KIND]);
    accountId = account.rows[0].id;
    await client.query("INSERT INTO crypto_wallets (account_id, workspace_id, address) VALUES ($1, $2, $3)", [accountId, workspaceId, address]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") throw new Error("This Bitcoin address is already added to this workspace.");
    throw error;
  } finally { client.release(); }

  // A failed first import keeps the wallet; the error shows on its card and the next sync retries.
  return syncWallet(workspaceId, accountId, { force: true });
}

export async function syncWallet(workspaceId: string, accountId: string, { force = false } = {}): Promise<WalletSyncResult> {
  await ensureDatabaseSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // SKIP LOCKED: a second tab loading the page at the same time just skips instead of double-importing.
    const wallet = await client.query<{ address: string; fresh: boolean }>(`SELECT address,
        COALESCE(last_synced_at > now() - make_interval(secs => $3), false) AS fresh
      FROM crypto_wallets WHERE workspace_id=$1 AND account_id=$2 FOR UPDATE SKIP LOCKED`, [workspaceId, accountId, SYNC_THROTTLE_SECONDS]);
    if (!wallet.rowCount || (wallet.rows[0].fresh && !force)) {
      await client.query("ROLLBACK");
      return { accountId, status: "skipped", imported: 0 };
    }
    const { address } = wallet.rows[0];
    const latest = await client.query<{ txid: string }>("SELECT txid FROM crypto_wallet_transactions WHERE account_id=$1 ORDER BY block_time DESC LIMIT 1", [accountId]);

    let balanceSats: number;
    let txs: Awaited<ReturnType<typeof fetchConfirmedWalletTxs>>;
    try {
      [balanceSats, txs] = await Promise.all([
        fetchAddressBalanceSats(address),
        fetchConfirmedWalletTxs(address, { stopAtTxid: latest.rows[0]?.txid ?? null, cap: WALLET_IMPORT_CAP }),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed.";
      await client.query("UPDATE crypto_wallets SET last_sync_error=$1 WHERE account_id=$2", [message, accountId]);
      await client.query("COMMIT");
      return { accountId, status: "failed", imported: 0, error: message };
    }

    // Lets this transaction past the trigger that keeps manual entries out of wallet ledgers.
    await client.query("SELECT set_config('orbit.wallet_sync', 'on', true)");
    const known = await client.query<{ txid: string }>("SELECT txid FROM crypto_wallet_transactions WHERE account_id=$1 AND txid = ANY($2::text[])", [accountId, txs.map((tx) => tx.txid)]);
    const knownTxids = new Set(known.rows.map((row) => row.txid));
    let imported = 0;
    for (const tx of txs) {
      if (knownTxids.has(tx.txid)) continue;
      await client.query(`WITH inserted AS (
          INSERT INTO transactions (workspace_id, occurred_at, description, note, account_id, amount, type)
          VALUES ($1, $2, $3, $4, $5, $6::numeric / 100000000, $7) RETURNING id
        )
        INSERT INTO crypto_wallet_transactions (account_id, txid, workspace_id, transaction_id, net_sats, block_time)
        SELECT $5, $4, $1, id, $6, $2 FROM inserted`,
      [workspaceId, tx.blockTime.toISOString(), tx.netSats > 0 ? "Bitcoin received" : "Bitcoin sent", tx.txid, accountId, String(tx.netSats), tx.netSats > 0 ? "Income" : "Expense"]);
      imported += 1;
    }

    // History may be capped, so the opening balance absorbs whatever came before the oldest imported
    // transaction (and any deleted entries): the computed balance always equals the on-chain balance.
    await client.query(`UPDATE accounts SET opening_balance = $1::numeric / 100000000
        - COALESCE((SELECT SUM(amount) FROM transactions WHERE workspace_id=$2 AND account_id=$3), 0), updated_at=now()
      WHERE workspace_id=$2 AND id=$3`, [String(balanceSats), workspaceId, accountId]);
    await client.query("UPDATE crypto_wallets SET chain_balance_sats=$1, last_synced_at=now(), last_sync_error=NULL WHERE account_id=$2", [balanceSats, accountId]);
    await client.query("COMMIT");
    return { accountId, status: "synced", imported };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

/** Syncs one wallet, or every wallet in the workspace, one after another to stay gentle on the public API. */
export async function syncWorkspaceWallets(workspaceId: string, { accountId, force = false }: { accountId?: string; force?: boolean } = {}) {
  await ensureDatabaseSchema();
  const wallets = await db.query<{ account_id: string }>("SELECT account_id FROM crypto_wallets WHERE workspace_id=$1 AND ($2::uuid IS NULL OR account_id=$2) ORDER BY created_at", [workspaceId, accountId ?? null]);
  if (accountId && !wallets.rowCount) throw new Error("Wallet not found.");
  const results: WalletSyncResult[] = [];
  for (const wallet of wallets.rows) results.push(await syncWallet(workspaceId, wallet.account_id, { force }));
  return results;
}
