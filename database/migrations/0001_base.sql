CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  institution text NOT NULL DEFAULT '',
  last_four varchar(4) NOT NULL DEFAULT '',
  balance numeric(16, 2) NOT NULL DEFAULT 0,
  opening_balance numeric(16, 2) NOT NULL DEFAULT 0,
  currency varchar(3) NOT NULL DEFAULT 'USD',
  color varchar(7) NOT NULL DEFAULT '#573cf0',
  kind text NOT NULL DEFAULT 'Checking',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Adopt databases created by the original docker-entrypoint init script.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS opening_balance numeric(16, 2);
UPDATE accounts SET opening_balance = balance WHERE opening_balance IS NULL;
ALTER TABLE accounts ALTER COLUMN opening_balance SET DEFAULT 0;
ALTER TABLE accounts ALTER COLUMN opening_balance SET NOT NULL;

CREATE TABLE IF NOT EXISTS currencies (
  code varchar(3) PRIMARY KEY CHECK (code = upper(code)),
  name text NOT NULL,
  symbol varchar(8) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO currencies (code, name, symbol) VALUES ('USD', 'US Dollar', '$')
ON CONFLICT (code) DO NOTHING;

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

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_id uuid;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS preferences (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  currency varchar(3) NOT NULL DEFAULT 'USD',
  timezone text NOT NULL DEFAULT 'UTC',
  locale text NOT NULL DEFAULT 'en-US',
  price_format varchar(20) NOT NULL DEFAULT 'symbol',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO preferences (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

INSERT INTO currencies (code, name)
SELECT DISTINCT currency, currency FROM accounts
ON CONFLICT (code) DO NOTHING;

INSERT INTO currencies (code, name)
SELECT currency, currency FROM preferences WHERE id = 1
ON CONFLICT (code) DO NOTHING;

CREATE INDEX IF NOT EXISTS transactions_occurred_on_idx ON transactions (occurred_on DESC);
CREATE INDEX IF NOT EXISTS transactions_account_id_idx ON transactions (account_id);
CREATE INDEX IF NOT EXISTS transactions_cost_center_id_idx ON transactions (cost_center_id);
CREATE INDEX IF NOT EXISTS transactions_transfer_id_idx ON transactions (transfer_id);
