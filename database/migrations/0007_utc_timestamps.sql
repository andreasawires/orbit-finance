-- Transactions become UTC instants. Existing calendar dates are anchored at 12:00 local time
-- in their workspace's timezone, so they keep showing on the same day for that workspace.

UPDATE workspace_preferences
SET timezone = 'UTC', updated_at = now()
WHERE timezone NOT IN (SELECT name FROM pg_timezone_names);

ALTER TABLE transactions ADD COLUMN occurred_at timestamptz;

UPDATE transactions t
SET occurred_at = (t.occurred_on + time '12:00') AT TIME ZONE COALESCE(p.timezone, 'UTC')
FROM workspaces w
LEFT JOIN workspace_preferences p ON p.workspace_id = w.id
WHERE w.id = t.workspace_id;

UPDATE transactions SET occurred_at = (occurred_on + time '12:00') AT TIME ZONE 'UTC' WHERE occurred_at IS NULL;

ALTER TABLE transactions ALTER COLUMN occurred_at SET DEFAULT now();
ALTER TABLE transactions ALTER COLUMN occurred_at SET NOT NULL;

DROP INDEX IF EXISTS transactions_occurred_on_idx;
DROP INDEX IF EXISTS transactions_workspace_occurred_on_idx;
ALTER TABLE transactions DROP COLUMN occurred_on;
CREATE INDEX transactions_workspace_occurred_at_idx ON transactions(workspace_id, occurred_at DESC);

-- import_items.occurred_on stays a calendar date as printed on the statement; the batch records
-- which timezone the statement is in, and the date is converted to UTC when the batch is approved.
ALTER TABLE import_batches ADD COLUMN statement_timezone text;

UPDATE import_batches b
SET statement_timezone = COALESCE(p.timezone, 'UTC')
FROM workspaces w
LEFT JOIN workspace_preferences p ON p.workspace_id = w.id
WHERE w.id = b.workspace_id;

UPDATE import_batches SET statement_timezone = 'UTC' WHERE statement_timezone IS NULL;

ALTER TABLE import_batches ALTER COLUMN statement_timezone SET DEFAULT 'UTC';
ALTER TABLE import_batches ALTER COLUMN statement_timezone SET NOT NULL;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_statement_timezone_check CHECK (length(btrim(statement_timezone)) > 0);
