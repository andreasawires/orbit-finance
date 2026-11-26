-- Bitcoin wallet accounts. A wallet is an ordinary BTC account whose transactions are imported from the
-- blockchain (mempool.space / Esplora) instead of typed in. Amounts need satoshi precision (8 decimals).

ALTER TABLE transactions ALTER COLUMN amount TYPE numeric(24, 8);
ALTER TABLE accounts ALTER COLUMN opening_balance TYPE numeric(24, 8);
ALTER TABLE accounts ALTER COLUMN balance TYPE numeric(24, 8);

CREATE TABLE IF NOT EXISTS crypto_wallets (
  account_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  network text NOT NULL DEFAULT 'bitcoin' CHECK (network = 'bitcoin'),
  address text NOT NULL CHECK (length(address) BETWEEN 14 AND 100),
  chain_balance_sats bigint,
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, account_id) REFERENCES accounts (workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, address)
);

-- One row per on-chain transaction that touched the wallet; (account_id, txid) is the dedupe key.
CREATE TABLE IF NOT EXISTS crypto_wallet_transactions (
  account_id uuid NOT NULL REFERENCES crypto_wallets (account_id) ON DELETE CASCADE,
  txid text NOT NULL CHECK (txid ~ '^[0-9a-f]{64}$'),
  workspace_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  net_sats bigint NOT NULL,
  block_time timestamptz NOT NULL,
  PRIMARY KEY (account_id, txid),
  FOREIGN KEY (workspace_id, transaction_id) REFERENCES transactions (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS crypto_wallet_transactions_latest_idx ON crypto_wallet_transactions (account_id, block_time DESC);

-- Wallet ledgers mirror the blockchain, so only the sync (which sets orbit.wallet_sync for its transaction)
-- may add or change their amounts. Manual entries, transfers and statement imports are rejected.
-- Deleting stays allowed so removing the account (or a single entry) works; the next sync re-reconciles.
CREATE OR REPLACE FUNCTION reject_manual_wallet_transactions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('orbit.wallet_sync', true) IS NOT DISTINCT FROM 'on' THEN
    RETURN NEW;
  END IF;
  -- Editing the description, note or cost center of a synced entry is fine.
  IF TG_OP = 'UPDATE' AND (NEW.amount, NEW.account_id, NEW.type, NEW.transfer_id, NEW.transfer_account_id, NEW.occurred_at)
      IS NOT DISTINCT FROM (OLD.amount, OLD.account_id, OLD.type, OLD.transfer_id, OLD.transfer_account_id, OLD.occurred_at) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM crypto_wallets w
    WHERE w.account_id IN (NEW.account_id, NEW.transfer_account_id)
       OR (TG_OP = 'UPDATE' AND w.account_id IN (OLD.account_id, OLD.transfer_account_id))
  ) THEN
    RAISE EXCEPTION 'Wallet accounts are synced from the blockchain and cannot take manual amounts or transfers.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_reject_manual_wallet ON transactions;
CREATE TRIGGER transactions_reject_manual_wallet
  BEFORE INSERT OR UPDATE OF amount, account_id, type, transfer_id, transfer_account_id, occurred_at ON transactions
  FOR EACH ROW EXECUTE FUNCTION reject_manual_wallet_transactions();
