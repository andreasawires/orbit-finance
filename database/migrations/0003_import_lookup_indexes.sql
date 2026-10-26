-- transaction_sources.account_id is provenance captured at import time. An
-- imported transaction may later move accounts, so duplicate checks join the
-- live transactions row and need lookup indexes independent of that snapshot.
CREATE INDEX transaction_sources_dedup_fingerprint_lookup_idx
  ON transaction_sources (deduplication_fingerprint)
  WHERE deduplication_fingerprint IS NOT NULL;

CREATE INDEX transaction_sources_external_lookup_idx
  ON transaction_sources (source_system, external_id)
  WHERE external_id IS NOT NULL;
