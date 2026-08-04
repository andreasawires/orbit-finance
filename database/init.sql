CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  institution text NOT NULL DEFAULT '',
  last_four varchar(4) NOT NULL DEFAULT '',
  -- `balance` is kept for compatibility with databases created before the
  -- ledger migration. New application code uses `opening_balance` plus the
  -- transaction ledger to calculate the current balance.
  balance numeric(16, 2) NOT NULL DEFAULT 0,
  opening_balance numeric(16, 2) NOT NULL DEFAULT 0,
  currency varchar(3) NOT NULL DEFAULT 'USD',
  color varchar(7) NOT NULL DEFAULT '#573cf0',
  kind text NOT NULL DEFAULT 'Checking',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS currencies (
  code varchar(3) PRIMARY KEY CHECK (code = upper(code)),
  name text NOT NULL,
  symbol varchar(8) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO currencies (code, name, symbol) VALUES ('USD', 'US Dollar', '$') ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS cost_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  parent_id uuid REFERENCES cost_centers(id) ON DELETE CASCADE,
  color varchar(7) NOT NULL DEFAULT '#573cf0',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_id, name)
);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_on date NOT NULL DEFAULT current_date,
  description text NOT NULL,
  note text NOT NULL DEFAULT '',
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL,
  amount numeric(16, 2) NOT NULL,
  type varchar(12) NOT NULL CHECK (type IN ('Income', 'Expense', 'Transfer')),
  transfer_id uuid,
  transfer_account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS preferences (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  currency varchar(3) NOT NULL DEFAULT 'USD',
  timezone text NOT NULL DEFAULT 'UTC',
  locale text NOT NULL DEFAULT 'en-US',
  price_format varchar(20) NOT NULL DEFAULT 'symbol',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO preferences (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS transactions_occurred_on_idx ON transactions (occurred_on DESC);
CREATE INDEX IF NOT EXISTS transactions_account_id_idx ON transactions (account_id);
CREATE INDEX IF NOT EXISTS transactions_cost_center_id_idx ON transactions (cost_center_id);
CREATE INDEX IF NOT EXISTS transactions_transfer_id_idx ON transactions (transfer_id);

CREATE OR REPLACE FUNCTION prevent_account_currency_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'Account currency is locked. Create a new account to use another currency.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounts_currency_immutable ON accounts;
CREATE TRIGGER accounts_currency_immutable
  BEFORE UPDATE OF currency ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION prevent_account_currency_change();
