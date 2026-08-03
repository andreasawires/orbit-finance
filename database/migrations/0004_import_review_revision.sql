ALTER TABLE import_batches
  ADD COLUMN IF NOT EXISTS review_revision bigint NOT NULL DEFAULT 0;
