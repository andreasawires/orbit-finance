-- Cached result of the optional update check (see lib/update-check). A single row: the server
-- overwrites it after each check. Nothing here identifies the installation.

CREATE TABLE IF NOT EXISTS update_check (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  checked_at timestamptz NOT NULL,
  current_version text NOT NULL,
  manifest jsonb,
  error text
);
