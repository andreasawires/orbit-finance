CREATE TABLE app_users (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role varchar(12) NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

-- Orbit is local-first today. Keeping this durable identity/membership shape
-- makes an authentication layer additive instead of another data migration.
INSERT INTO app_users (id, display_name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Local user')
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspaces (id, name)
VALUES ('00000000-0000-4000-8000-000000000002', 'Personal')
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspace_memberships (workspace_id, user_id, role)
VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'owner')
ON CONFLICT (workspace_id, user_id) DO NOTHING;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE currencies ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE import_documents ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE import_items ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE import_events ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE transaction_sources ADD COLUMN IF NOT EXISTS workspace_id uuid;

UPDATE accounts SET workspace_id = '00000000-0000-4000-8000-000000000002' WHERE workspace_id IS NULL;
UPDATE cost_centers SET workspace_id = '00000000-0000-4000-8000-000000000002' WHERE workspace_id IS NULL;
UPDATE transactions SET workspace_id = '00000000-0000-4000-8000-000000000002' WHERE workspace_id IS NULL;
UPDATE currencies SET workspace_id = '00000000-0000-4000-8000-000000000002' WHERE workspace_id IS NULL;
UPDATE import_documents SET workspace_id = '00000000-0000-4000-8000-000000000002' WHERE workspace_id IS NULL;
UPDATE import_batches b SET workspace_id = a.workspace_id FROM accounts a WHERE b.account_id = a.id AND b.workspace_id IS NULL;
UPDATE import_items i SET workspace_id = b.workspace_id FROM import_batches b WHERE i.batch_id = b.id AND i.workspace_id IS NULL;
UPDATE import_events e SET workspace_id = b.workspace_id FROM import_batches b WHERE e.batch_id = b.id AND e.workspace_id IS NULL;
UPDATE transaction_sources s SET workspace_id = t.workspace_id FROM transactions t WHERE s.transaction_id = t.id AND s.workspace_id IS NULL;

ALTER TABLE accounts ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE cost_centers ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE currencies ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE import_documents ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE import_batches ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE import_items ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE import_events ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE transaction_sources ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE accounts ADD CONSTRAINT accounts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE cost_centers ADD CONSTRAINT cost_centers_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE transactions ADD CONSTRAINT transactions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE currencies ADD CONSTRAINT currencies_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE import_documents ADD CONSTRAINT import_documents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE import_items ADD CONSTRAINT import_items_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE import_events ADD CONSTRAINT import_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE transaction_sources ADD CONSTRAINT transaction_sources_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE accounts ADD CONSTRAINT accounts_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE cost_centers ADD CONSTRAINT cost_centers_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE transactions ADD CONSTRAINT transactions_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE import_documents ADD CONSTRAINT import_documents_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE import_batches ADD CONSTRAINT import_batches_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE import_items ADD CONSTRAINT import_items_workspace_id_id_key UNIQUE (workspace_id, id);

ALTER TABLE currencies DROP CONSTRAINT IF EXISTS currencies_pkey;
ALTER TABLE currencies ADD CONSTRAINT currencies_pkey PRIMARY KEY (workspace_id, code);

ALTER TABLE cost_centers DROP CONSTRAINT IF EXISTS cost_centers_parent_id_fkey;
ALTER TABLE cost_centers DROP CONSTRAINT IF EXISTS cost_centers_parent_id_name_key;
ALTER TABLE cost_centers ADD CONSTRAINT cost_centers_workspace_parent_name_key UNIQUE (workspace_id, parent_id, name);
ALTER TABLE cost_centers ADD CONSTRAINT cost_centers_workspace_parent_fkey
  FOREIGN KEY (workspace_id, parent_id) REFERENCES cost_centers(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE accounts ADD CONSTRAINT accounts_workspace_currency_fkey
  FOREIGN KEY (workspace_id, currency) REFERENCES currencies(workspace_id, code);

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_account_id_fkey;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_cost_center_id_fkey;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_transfer_account_id_fkey;
ALTER TABLE transactions ADD CONSTRAINT transactions_workspace_account_fkey
  FOREIGN KEY (workspace_id, account_id) REFERENCES accounts(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE transactions ADD CONSTRAINT transactions_workspace_cost_center_fkey
  FOREIGN KEY (workspace_id, cost_center_id) REFERENCES cost_centers(workspace_id, id) ON DELETE SET NULL (cost_center_id);
ALTER TABLE transactions ADD CONSTRAINT transactions_workspace_transfer_account_fkey
  FOREIGN KEY (workspace_id, transfer_account_id) REFERENCES accounts(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE import_documents DROP CONSTRAINT IF EXISTS import_documents_sha256_key;
ALTER TABLE import_documents ADD CONSTRAINT import_documents_workspace_sha256_key UNIQUE (workspace_id, sha256);
ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_document_id_fkey;
ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_account_id_fkey;
ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_idempotency_key_key;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_workspace_document_fkey
  FOREIGN KEY (workspace_id, document_id) REFERENCES import_documents(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_workspace_account_fkey
  FOREIGN KEY (workspace_id, account_id) REFERENCES accounts(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_workspace_idempotency_key_key UNIQUE (workspace_id, idempotency_key);

ALTER TABLE import_items DROP CONSTRAINT IF EXISTS import_items_batch_id_fkey;
ALTER TABLE import_items DROP CONSTRAINT IF EXISTS import_items_cost_center_id_fkey;
ALTER TABLE import_items ADD CONSTRAINT import_items_workspace_batch_fkey
  FOREIGN KEY (workspace_id, batch_id) REFERENCES import_batches(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE import_items ADD CONSTRAINT import_items_workspace_cost_center_fkey
  FOREIGN KEY (workspace_id, cost_center_id) REFERENCES cost_centers(workspace_id, id) ON DELETE SET NULL (cost_center_id);

ALTER TABLE import_events DROP CONSTRAINT IF EXISTS import_events_batch_id_fkey;
ALTER TABLE import_events DROP CONSTRAINT IF EXISTS import_events_item_id_fkey;
ALTER TABLE import_events ADD CONSTRAINT import_events_workspace_batch_fkey
  FOREIGN KEY (workspace_id, batch_id) REFERENCES import_batches(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE import_events ADD CONSTRAINT import_events_workspace_item_fkey
  FOREIGN KEY (workspace_id, item_id) REFERENCES import_items(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE transaction_sources DROP CONSTRAINT IF EXISTS transaction_sources_transaction_id_fkey;
ALTER TABLE transaction_sources DROP CONSTRAINT IF EXISTS transaction_sources_import_item_id_fkey;
ALTER TABLE transaction_sources DROP CONSTRAINT IF EXISTS transaction_sources_account_id_fkey;
ALTER TABLE transaction_sources ADD CONSTRAINT transaction_sources_workspace_transaction_fkey
  FOREIGN KEY (workspace_id, transaction_id) REFERENCES transactions(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE transaction_sources ADD CONSTRAINT transaction_sources_workspace_import_item_fkey
  FOREIGN KEY (workspace_id, import_item_id) REFERENCES import_items(workspace_id, id) ON DELETE RESTRICT;
ALTER TABLE transaction_sources ADD CONSTRAINT transaction_sources_workspace_account_fkey
  FOREIGN KEY (workspace_id, account_id) REFERENCES accounts(workspace_id, id) ON DELETE CASCADE;

CREATE TABLE workspace_preferences (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  currency varchar(3) NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  locale text NOT NULL DEFAULT 'en-US',
  price_format varchar(20) NOT NULL DEFAULT 'symbol',
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, currency) REFERENCES currencies(workspace_id, code)
);

INSERT INTO workspace_preferences (workspace_id, currency, timezone, locale, price_format, updated_at)
SELECT '00000000-0000-4000-8000-000000000002', currency, timezone, locale, price_format, updated_at
FROM preferences WHERE id = 1
ON CONFLICT (workspace_id) DO NOTHING;

CREATE INDEX accounts_workspace_id_idx ON accounts(workspace_id);
CREATE INDEX cost_centers_workspace_id_idx ON cost_centers(workspace_id);
CREATE INDEX transactions_workspace_occurred_on_idx ON transactions(workspace_id, occurred_on DESC);
CREATE INDEX import_documents_workspace_id_idx ON import_documents(workspace_id);
CREATE INDEX import_batches_workspace_created_at_idx ON import_batches(workspace_id, created_at DESC);
CREATE INDEX import_items_workspace_batch_idx ON import_items(workspace_id, batch_id, ordinal);
CREATE INDEX import_events_workspace_batch_idx ON import_events(workspace_id, batch_id, created_at, id);
CREATE INDEX transaction_sources_workspace_account_idx ON transaction_sources(workspace_id, account_id);
