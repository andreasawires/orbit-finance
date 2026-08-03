CREATE TABLE import_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256 char(64) NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text NOT NULL UNIQUE CHECK (length(btrim(storage_key)) > 0),
  original_filename text NOT NULL CHECK (length(btrim(original_filename)) > 0),
  media_type text NOT NULL CHECK (length(btrim(media_type)) > 0),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  page_count integer CHECK (page_count IS NULL OR page_count > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES import_documents(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_kind varchar(8) NOT NULL CHECK (source_kind IN ('csv', 'pdf', 'image')),
  status varchar(24) NOT NULL DEFAULT 'uploaded' CHECK (status IN (
    'uploaded', 'queued', 'extracting', 'converting', 'validating',
    'awaiting_review', 'approving', 'completed', 'failed', 'cancelled'
  )),
  idempotency_key text UNIQUE CHECK (idempotency_key IS NULL OR length(btrim(idempotency_key)) > 0),
  pipeline_version text NOT NULL CHECK (length(btrim(pipeline_version)) > 0),
  parser_name text,
  parser_version text,
  extractor_name text,
  extractor_version text,
  model_name text,
  model_version text,
  model_quantization text,
  prompt_version text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  queued_at timestamptz,
  started_at timestamptz,
  review_ready_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX import_batches_document_id_idx ON import_batches (document_id);
CREATE INDEX import_batches_account_id_idx ON import_batches (account_id);
CREATE INDEX import_batches_status_created_at_idx ON import_batches (status, created_at);

CREATE TABLE import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  validation_status varchar(16) NOT NULL DEFAULT 'pending' CHECK (validation_status IN (
    'pending', 'valid', 'needs_review', 'invalid', 'duplicate'
  )),
  review_status varchar(12) NOT NULL DEFAULT 'pending' CHECK (review_status IN (
    'pending', 'approved', 'rejected'
  )),
  source_page integer CHECK (source_page IS NULL OR source_page > 0),
  source_row integer CHECK (source_row IS NULL OR source_row > 0),
  source_locator jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_locator) = 'object'),
  source_text text NOT NULL DEFAULT '',
  raw_source jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_source) = 'object'),
  model_output jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(model_output) = 'object'),
  occurred_on date,
  value_on date,
  description text,
  note text NOT NULL DEFAULT '',
  amount numeric(30, 12),
  currency varchar(3) CHECK (currency IS NULL OR currency = upper(currency)),
  transaction_type varchar(12) CHECK (transaction_type IS NULL OR transaction_type IN ('Income', 'Expense')),
  cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL,
  source_system text NOT NULL DEFAULT 'document-import' CHECK (length(btrim(source_system)) > 0),
  external_id text,
  deduplication_fingerprint char(64) CHECK (
    deduplication_fingerprint IS NULL OR deduplication_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  confidence numeric(5, 4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(validation_errors) = 'array'),
  validation_warnings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(validation_warnings) = 'array'),
  reviewed_by text,
  reviewed_at timestamptz,
  imported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, ordinal)
);

CREATE INDEX import_items_batch_review_idx ON import_items (batch_id, review_status, ordinal);
CREATE INDEX import_items_batch_validation_idx ON import_items (batch_id, validation_status, ordinal);
CREATE INDEX import_items_external_id_idx ON import_items (source_system, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX import_items_fingerprint_idx ON import_items (deduplication_fingerprint) WHERE deduplication_fingerprint IS NOT NULL;

CREATE TABLE import_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  item_id uuid REFERENCES import_items(id) ON DELETE CASCADE,
  event_name text NOT NULL CHECK (length(btrim(event_name)) > 0),
  from_status text,
  to_status text,
  actor_type varchar(12) NOT NULL DEFAULT 'system' CHECK (actor_type IN ('system', 'worker', 'user')),
  actor_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX import_events_batch_created_at_idx ON import_events (batch_id, created_at, id);
CREATE INDEX import_events_item_created_at_idx ON import_events (item_id, created_at, id) WHERE item_id IS NOT NULL;

CREATE TABLE transaction_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  import_item_id uuid NOT NULL UNIQUE REFERENCES import_items(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_system text NOT NULL CHECK (length(btrim(source_system)) > 0),
  external_id text,
  deduplication_fingerprint char(64) CHECK (
    deduplication_fingerprint IS NULL OR deduplication_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX transaction_sources_transaction_id_idx ON transaction_sources (transaction_id);
CREATE INDEX transaction_sources_account_id_idx ON transaction_sources (account_id);
CREATE INDEX transaction_sources_external_id_idx
  ON transaction_sources (account_id, source_system, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX transaction_sources_fingerprint_idx
  ON transaction_sources (account_id, deduplication_fingerprint)
  WHERE deduplication_fingerprint IS NOT NULL;
