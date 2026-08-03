import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "@/lib/database";
import {
  type ApproveImportBatchInput,
  type ApproveImportBatchResult,
  type CreateImportBatchInput,
  type DecimalString,
  type ImportActorType,
  type ImportBatch,
  type ImportBatchDetail,
  type ImportBatchSummary,
  type ImportBatchStatus,
  type ImportDocument,
  type ImportEvent,
  type ImportItem,
  type ImportItemCandidate,
  type ImportWork,
  type JsonObject,
  type JsonValue,
  type RegisterImportDocumentInput,
  type UpdateImportItemReviewInput,
} from "@/lib/imports/types";

type Row = Record<string, unknown>;

const batchTransitions: Record<ImportBatchStatus, readonly ImportBatchStatus[]> = {
  uploaded: ["queued", "failed", "cancelled"],
  queued: ["extracting", "failed", "cancelled"],
  extracting: ["converting", "validating", "failed", "cancelled"],
  converting: ["validating", "failed", "cancelled"],
  validating: ["awaiting_review", "failed", "cancelled"],
  awaiting_review: ["approving", "failed", "cancelled"],
  approving: ["completed", "awaiting_review", "failed"],
  completed: [],
  failed: ["queued", "cancelled"],
  cancelled: [],
};

const sha256Pattern = /^[0-9a-f]{64}$/;
const decimalPattern = /^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/;
const confidencePattern = /^(?:0(?:\.\d{1,4})?|1(?:\.0{1,4})?)$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function assertNonEmpty(value: string, field: string) {
  if (!value.trim()) throw new Error(`${field} is required.`);
}

function assertDecimal(value: DecimalString, field: string) {
  if (!decimalPattern.test(value)) {
    throw new Error(`${field} must be a plain decimal string with at most 14 integer and two fractional digits.`);
  }
}

function assertIsoDate(value: string | null | undefined, field: string) {
  if (value == null) return;
  if (!isoDatePattern.test(value)) throw new Error(`${field} must use YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} is not a valid calendar date.`);
  }
}

function timestamp(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function date(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function decimal(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

function jsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function jsonArray(value: unknown): JsonValue[] {
  return Array.isArray(value) ? value as JsonValue[] : [];
}

function normalizeFingerprint(value: string | null | undefined) {
  if (!value) return null;
  return sha256Pattern.test(value)
    ? value
    : createHash("sha256").update(value).digest("hex");
}

function documentFromRow(row: Row): ImportDocument {
  return {
    id: String(row.id),
    sha256: String(row.sha256),
    storageKey: String(row.storage_key),
    originalFilename: String(row.original_filename),
    mediaType: String(row.media_type),
    sizeBytes: String(row.size_bytes),
    pageCount: row.page_count == null ? null : Number(row.page_count),
    metadata: jsonObject(row.metadata),
    createdAt: timestamp(row.created_at)!,
    updatedAt: timestamp(row.updated_at)!,
  };
}

function batchFromRow(row: Row): ImportBatch {
  return {
    id: String(row.id),
    documentId: String(row.document_id),
    accountId: String(row.account_id),
    sourceKind: row.source_kind as ImportBatch["sourceKind"],
    status: row.status as ImportBatchStatus,
    idempotencyKey: row.idempotency_key == null ? null : String(row.idempotency_key),
    pipelineVersion: String(row.pipeline_version),
    parserName: row.parser_name == null ? null : String(row.parser_name),
    parserVersion: row.parser_version == null ? null : String(row.parser_version),
    extractorName: row.extractor_name == null ? null : String(row.extractor_name),
    extractorVersion: row.extractor_version == null ? null : String(row.extractor_version),
    modelName: row.model_name == null ? null : String(row.model_name),
    modelVersion: row.model_version == null ? null : String(row.model_version),
    modelQuantization: row.model_quantization == null ? null : String(row.model_quantization),
    promptVersion: row.prompt_version == null ? null : String(row.prompt_version),
    settings: jsonObject(row.settings),
    errorCode: row.error_code == null ? null : String(row.error_code),
    errorMessage: row.error_message == null ? null : String(row.error_message),
    reviewRevision: String(row.review_revision ?? "0"),
    createdAt: timestamp(row.created_at)!,
    updatedAt: timestamp(row.updated_at)!,
    queuedAt: timestamp(row.queued_at),
    startedAt: timestamp(row.started_at),
    reviewReadyAt: timestamp(row.review_ready_at),
    completedAt: timestamp(row.completed_at),
  };
}

function itemFromRow(row: Row): ImportItem {
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    ordinal: Number(row.ordinal),
    validationStatus: row.validation_status as ImportItem["validationStatus"],
    reviewStatus: row.review_status as ImportItem["reviewStatus"],
    sourcePage: row.source_page == null ? null : Number(row.source_page),
    sourceRow: row.source_row == null ? null : Number(row.source_row),
    sourceLocator: jsonObject(row.source_locator),
    sourceText: String(row.source_text ?? ""),
    rawSource: jsonObject(row.raw_source),
    modelOutput: jsonObject(row.model_output),
    occurredOn: date(row.occurred_on),
    valueOn: date(row.value_on),
    description: row.description == null ? null : String(row.description),
    note: String(row.note ?? ""),
    amount: decimal(row.amount),
    currency: row.currency == null ? null : String(row.currency),
    transactionType: row.transaction_type == null ? null : row.transaction_type as ImportItem["transactionType"],
    costCenterId: row.cost_center_id == null ? null : String(row.cost_center_id),
    sourceSystem: String(row.source_system),
    externalId: row.external_id == null ? null : String(row.external_id),
    deduplicationFingerprint: row.deduplication_fingerprint == null ? null : String(row.deduplication_fingerprint),
    confidence: decimal(row.confidence),
    validationErrors: jsonArray(row.validation_errors),
    validationWarnings: jsonArray(row.validation_warnings),
    reviewedBy: row.reviewed_by == null ? null : String(row.reviewed_by),
    reviewedAt: timestamp(row.reviewed_at),
    importedAt: timestamp(row.imported_at),
    createdAt: timestamp(row.created_at)!,
    updatedAt: timestamp(row.updated_at)!,
  };
}

function eventFromRow(row: Row): ImportEvent {
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    itemId: row.item_id == null ? null : String(row.item_id),
    eventName: String(row.event_name),
    fromStatus: row.from_status == null ? null : String(row.from_status),
    toStatus: row.to_status == null ? null : String(row.to_status),
    actorType: row.actor_type as ImportActorType,
    actorId: row.actor_id == null ? null : String(row.actor_id),
    details: jsonObject(row.details),
    createdAt: timestamp(row.created_at)!,
  };
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function registerImportDocument(input: RegisterImportDocumentInput) {
  if (!sha256Pattern.test(input.sha256)) throw new Error("sha256 must be a lowercase hexadecimal SHA-256 digest.");
  assertNonEmpty(input.storageKey, "storageKey");
  assertNonEmpty(input.originalFilename, "originalFilename");
  assertNonEmpty(input.mediaType, "mediaType");
  if (!/^\d+$/.test(input.sizeBytes)) throw new Error("sizeBytes must be a non-negative integer string.");
  if (input.pageCount != null && (!Number.isInteger(input.pageCount) || input.pageCount < 1)) {
    throw new Error("pageCount must be a positive integer.");
  }

  const result = await db.query(`INSERT INTO import_documents
    (sha256, storage_key, original_filename, media_type, size_bytes, page_count, metadata)
    VALUES ($1, $2, $3, $4, $5::bigint, $6, $7::jsonb)
    ON CONFLICT (sha256) DO UPDATE SET sha256 = EXCLUDED.sha256
    RETURNING *`, [
    input.sha256,
    input.storageKey,
    input.originalFilename,
    input.mediaType,
    input.sizeBytes,
    input.pageCount ?? null,
    JSON.stringify(input.metadata ?? {}),
  ]);
  const document = documentFromRow(result.rows[0]);
  return { document, reused: document.storageKey !== input.storageKey };
}

export async function deleteUnreferencedImportDocument(documentId: string) {
  const result = await db.query<{ storage_key: string }>(`DELETE FROM import_documents d
    WHERE d.id = $1
      AND NOT EXISTS (SELECT 1 FROM import_batches b WHERE b.document_id = d.id)
    RETURNING d.storage_key`, [documentId]);
  return result.rowCount ? String(result.rows[0].storage_key) : null;
}

export async function updateImportDocumentInspection(
  documentId: string,
  input: { pageCount?: number | null; metadata?: JsonObject },
) {
  if (input.pageCount != null && (!Number.isInteger(input.pageCount) || input.pageCount < 1)) {
    throw new Error("pageCount must be a positive integer.");
  }
  const result = await db.query(`UPDATE import_documents SET
      page_count = CASE WHEN $2::boolean THEN $3 ELSE page_count END,
      metadata = CASE WHEN $4::boolean THEN metadata || $5::jsonb ELSE metadata END,
      updated_at = now()
    WHERE id = $1
    RETURNING *`, [
    documentId,
    Object.hasOwn(input, "pageCount"),
    input.pageCount ?? null,
    Object.hasOwn(input, "metadata"),
    JSON.stringify(input.metadata ?? {}),
  ]);
  if (!result.rowCount) throw new Error("Import document not found.");
  return documentFromRow(result.rows[0]);
}

export async function createImportBatch(input: CreateImportBatchInput): Promise<ImportBatch> {
  assertNonEmpty(input.pipelineVersion, "pipelineVersion");
  if (input.idempotencyKey != null) assertNonEmpty(input.idempotencyKey, "idempotencyKey");
  return inTransaction(async (client) => {
    const result = await client.query(`INSERT INTO import_batches (
        document_id, account_id, source_kind, idempotency_key, pipeline_version,
        parser_name, parser_version, extractor_name, extractor_version,
        model_name, model_version, model_quantization, prompt_version, settings
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
      ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
      RETURNING *`, [
      input.documentId,
      input.accountId,
      input.sourceKind,
      input.idempotencyKey ?? null,
      input.pipelineVersion,
      input.parserName ?? null,
      input.parserVersion ?? null,
      input.extractorName ?? null,
      input.extractorVersion ?? null,
      input.modelName ?? null,
      input.modelVersion ?? null,
      input.modelQuantization ?? null,
      input.promptVersion ?? null,
      JSON.stringify(input.settings ?? {}),
    ]);
    const batch = batchFromRow(result.rows[0]);
    if (batch.documentId !== input.documentId || batch.accountId !== input.accountId || batch.sourceKind !== input.sourceKind) {
      throw new Error("The idempotency key is already attached to a different import request.");
    }
    await client.query(`INSERT INTO import_events (batch_id, event_name, to_status, actor_type)
      SELECT $1, 'batch.created', 'uploaded', 'system'
      WHERE NOT EXISTS (
        SELECT 1 FROM import_events WHERE batch_id = $1 AND event_name = 'batch.created'
      )`, [batch.id]);
    return batch;
  });
}

export async function getImportBatch(batchId: string): Promise<ImportBatch | null> {
  const result = await db.query("SELECT * FROM import_batches WHERE id = $1", [batchId]);
  return result.rowCount ? batchFromRow(result.rows[0]) : null;
}

export async function listUnqueuedUploadBatchIds(limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("limit must be between 1 and 500.");
  const result = await db.query<{ id: string }>(`SELECT id
    FROM import_batches
    WHERE status = 'uploaded' AND updated_at < now() - interval '30 seconds'
    ORDER BY updated_at
    LIMIT $1`, [limit]);
  return result.rows.map((row) => String(row.id));
}

export async function getImportWork(batchId: string): Promise<ImportWork | null> {
  const result = await db.query(`SELECT
      b.*,
      row_to_json(d) AS document_record,
      a.id AS work_account_id,
      a.name AS work_account_name,
      a.currency AS work_account_currency
    FROM import_batches b
    JOIN import_documents d ON d.id = b.document_id
    JOIN accounts a ON a.id = b.account_id
    WHERE b.id = $1`, [batchId]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    batch: batchFromRow(row),
    document: documentFromRow(jsonObject(row.document_record) as Row),
    account: {
      id: String(row.work_account_id),
      name: String(row.work_account_name),
      currency: String(row.work_account_currency),
    },
  };
}

export async function listImportBatches(limit = 50): Promise<ImportBatchSummary[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("limit must be between 1 and 200.");
  const result = await db.query(`SELECT
      b.*,
      d.original_filename AS summary_original_filename,
      d.media_type AS summary_media_type,
      d.size_bytes AS summary_size_bytes,
      a.name AS summary_account_name,
      a.currency AS summary_account_currency,
      count(i.id)::int AS item_total,
      count(i.id) FILTER (WHERE i.validation_status = 'valid')::int AS item_valid,
      count(i.id) FILTER (WHERE i.validation_status = 'needs_review')::int AS item_needs_review,
      count(i.id) FILTER (WHERE i.validation_status = 'invalid')::int AS item_invalid,
      count(i.id) FILTER (WHERE i.validation_status = 'duplicate')::int AS item_duplicate,
      count(i.id) FILTER (WHERE i.review_status = 'approved')::int AS item_approved,
      count(i.id) FILTER (WHERE i.review_status = 'rejected')::int AS item_rejected,
      count(i.id) FILTER (WHERE i.imported_at IS NOT NULL)::int AS item_imported
    FROM import_batches b
    JOIN import_documents d ON d.id = b.document_id
    JOIN accounts a ON a.id = b.account_id
    LEFT JOIN import_items i ON i.batch_id = b.id
    GROUP BY b.id, d.id, a.id
    ORDER BY b.created_at DESC
    LIMIT $1`, [limit]);
  return result.rows.map((row) => ({
    batch: batchFromRow(row),
    document: {
      id: String(row.document_id),
      originalFilename: String(row.summary_original_filename),
      mediaType: String(row.summary_media_type),
      sizeBytes: String(row.summary_size_bytes),
    },
    account: {
      id: String(row.account_id),
      name: String(row.summary_account_name),
      currency: String(row.summary_account_currency),
    },
    counts: {
      total: Number(row.item_total),
      valid: Number(row.item_valid),
      needsReview: Number(row.item_needs_review),
      invalid: Number(row.item_invalid),
      duplicate: Number(row.item_duplicate),
      approved: Number(row.item_approved),
      rejected: Number(row.item_rejected),
      imported: Number(row.item_imported),
    },
  }));
}

export async function getImportBatchDetail(
  batchId: string,
  options: { page?: number; pageSize?: number } = {},
): Promise<ImportBatchDetail | null> {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 100;
  if (!Number.isInteger(page) || page < 1) throw new Error("page must be a positive integer.");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    throw new Error("pageSize must be between 1 and 200.");
  }

  const client = await db.connect();
  try {
    // The revision and visible rows must come from the same snapshot; otherwise
    // a concurrent edit could be approved even though the tab never displayed it.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const workResult = await client.query(`SELECT
        b.*,
        row_to_json(d) AS document_record,
        a.id AS work_account_id,
        a.name AS work_account_name,
        a.currency AS work_account_currency
      FROM import_batches b
      JOIN import_documents d ON d.id = b.document_id
      JOIN accounts a ON a.id = b.account_id
      WHERE b.id = $1`, [batchId]);
    if (!workResult.rowCount) {
      await client.query("COMMIT");
      return null;
    }
    const row = workResult.rows[0];
    const work: ImportWork = {
      batch: batchFromRow(row),
      document: documentFromRow(jsonObject(row.document_record) as Row),
      account: {
        id: String(row.work_account_id),
        name: String(row.work_account_name),
        currency: String(row.work_account_currency),
      },
    };
    const countsResult = await client.query(`SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE review_status = 'approved')::int AS approved,
        count(*) FILTER (WHERE review_status = 'rejected')::int AS rejected,
        count(*) FILTER (WHERE review_status = 'pending')::int AS pending
      FROM import_items WHERE batch_id = $1`, [batchId]);
    const counts = {
      total: Number(countsResult.rows[0].total),
      approved: Number(countsResult.rows[0].approved),
      rejected: Number(countsResult.rows[0].rejected),
      pending: Number(countsResult.rows[0].pending),
    };
    const totalPages = Math.max(1, Math.ceil(counts.total / pageSize));
    const safePage = Math.min(page, totalPages);
    const [itemResult, eventResult] = await Promise.all([
      client.query("SELECT * FROM import_items WHERE batch_id = $1 ORDER BY ordinal LIMIT $2 OFFSET $3", [
        batchId,
        pageSize,
        (safePage - 1) * pageSize,
      ]),
      client.query(`SELECT * FROM (
          SELECT * FROM import_events WHERE batch_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100
        ) AS recent ORDER BY created_at, id`, [batchId]),
    ]);
    await client.query("COMMIT");
    return {
      ...work,
      items: itemResult.rows.map(itemFromRow),
      events: eventResult.rows.map(eventFromRow),
      counts,
      pagination: { page: safePage, pageSize, total: counts.total, totalPages },
      reviewRevision: work.batch.reviewRevision,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export type TransitionImportBatchInput = {
  status: ImportBatchStatus;
  actorType?: ImportActorType;
  actorId?: string | null;
  details?: JsonObject;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export async function transitionImportBatch(batchId: string, input: TransitionImportBatchInput) {
  return inTransaction(async (client) => {
    const currentResult = await client.query("SELECT * FROM import_batches WHERE id = $1 FOR UPDATE", [batchId]);
    if (!currentResult.rowCount) throw new Error("Import batch not found.");
    const current = batchFromRow(currentResult.rows[0]);
    if (current.status === input.status) return current;
    if (!batchTransitions[current.status].includes(input.status)) {
      throw new Error(`Import batch cannot transition from ${current.status} to ${input.status}.`);
    }
    const updated = await client.query(`UPDATE import_batches SET
        status = next.status,
        error_code = CASE WHEN next.status = 'failed' THEN $3 ELSE NULL END,
        error_message = CASE WHEN next.status = 'failed' THEN $4 ELSE NULL END,
        queued_at = CASE WHEN next.status = 'queued' THEN COALESCE(queued_at, now()) ELSE queued_at END,
        started_at = CASE WHEN next.status = 'extracting' THEN COALESCE(started_at, now()) ELSE started_at END,
        review_ready_at = CASE WHEN next.status = 'awaiting_review' THEN COALESCE(review_ready_at, now()) ELSE review_ready_at END,
        completed_at = CASE WHEN next.status = 'completed' THEN COALESCE(completed_at, now()) ELSE completed_at END,
        updated_at = now()
      FROM (SELECT $2::varchar(24) AS status) AS next
      WHERE id = $1
      RETURNING *`, [batchId, input.status, input.errorCode ?? null, input.errorMessage ?? null]);
    await client.query(`INSERT INTO import_events
        (batch_id, event_name, from_status, to_status, actor_type, actor_id, details)
      VALUES ($1, 'batch.status_changed', $2, $3, $4, $5, $6::jsonb)`, [
      batchId,
      current.status,
      input.status,
      input.actorType ?? "system",
      input.actorId ?? null,
      JSON.stringify(input.details ?? {}),
    ]);
    return batchFromRow(updated.rows[0]);
  });
}

export function updateImportBatchStatus(
  batchId: string,
  status: ImportBatchStatus,
  options: Omit<TransitionImportBatchInput, "status"> = {},
) {
  return transitionImportBatch(batchId, { ...options, status });
}

function normalizeCandidate(candidate: ImportItemCandidate) {
  if (!Number.isInteger(candidate.ordinal) || candidate.ordinal < 1) {
    throw new Error("Every import item ordinal must be a positive integer.");
  }
  assertIsoDate(candidate.occurredOn, "occurredOn");
  assertIsoDate(candidate.valueOn, "valueOn");
  if (candidate.amount != null) assertDecimal(candidate.amount, "amount");
  if (candidate.currency != null && !/^[A-Z]{3}$/.test(candidate.currency)) {
    throw new Error("currency must be a three-letter uppercase code.");
  }
  if (candidate.confidence != null && !confidencePattern.test(candidate.confidence)) {
    throw new Error("confidence must be a decimal string between zero and one with at most four decimal places.");
  }
  if (candidate.sourcePage != null && (!Number.isInteger(candidate.sourcePage) || candidate.sourcePage < 1)) {
    throw new Error("sourcePage must be a positive integer.");
  }
  if (candidate.sourceRow != null && (!Number.isInteger(candidate.sourceRow) || candidate.sourceRow < 1)) {
    throw new Error("sourceRow must be a positive integer.");
  }
  if (candidate.sourceSystem != null) assertNonEmpty(candidate.sourceSystem, "sourceSystem");
  return {
    ordinal: candidate.ordinal,
    validationStatus: candidate.validationStatus ?? "pending",
    sourcePage: candidate.sourcePage ?? null,
    sourceRow: candidate.sourceRow ?? null,
    sourceLocator: candidate.sourceLocator ?? {},
    sourceText: candidate.sourceText ?? "",
    rawSource: candidate.rawSource ?? {},
    modelOutput: candidate.modelOutput ?? {},
    occurredOn: candidate.occurredOn ?? null,
    valueOn: candidate.valueOn ?? null,
    description: candidate.description ?? null,
    note: candidate.note ?? "",
    amount: candidate.amount ?? null,
    currency: candidate.currency ?? null,
    transactionType: candidate.transactionType ?? null,
    costCenterId: candidate.costCenterId ?? null,
    sourceSystem: candidate.sourceSystem ?? "document-import",
    externalId: candidate.externalId ?? null,
    deduplicationFingerprint: normalizeFingerprint(candidate.deduplicationFingerprint),
    confidence: candidate.confidence ?? null,
    validationErrors: candidate.validationErrors ?? [],
    validationWarnings: candidate.validationWarnings ?? [],
  };
}

export async function replaceImportItems(batchId: string, candidates: readonly ImportItemCandidate[]) {
  const ordinals = new Set<number>();
  for (const candidate of candidates) {
    if (!Number.isInteger(candidate.ordinal) || candidate.ordinal < 1) {
      throw new Error("Every import item ordinal must be a positive integer.");
    }
    if (ordinals.has(candidate.ordinal)) throw new Error(`Import item ordinal ${candidate.ordinal} is duplicated.`);
    ordinals.add(candidate.ordinal);
  }

  return inTransaction(async (client) => {
    const batchResult = await client.query<{ status: ImportBatchStatus }>(
      "SELECT status FROM import_batches WHERE id = $1 FOR UPDATE",
      [batchId],
    );
    if (!batchResult.rowCount) throw new Error("Import batch not found.");
    if (!["extracting", "converting", "validating"].includes(batchResult.rows[0].status)) {
      throw new Error(`Import items cannot be replaced while the batch is ${batchResult.rows[0].status}.`);
    }
    const protectedItems = await client.query(`SELECT count(*)::int AS count FROM import_items i
      WHERE i.batch_id = $1 AND (i.review_status <> 'pending' OR i.imported_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM transaction_sources s WHERE s.import_item_id = i.id))`, [batchId]);
    if (Number(protectedItems.rows[0].count) > 0) {
      throw new Error("Reviewed or imported items cannot be replaced.");
    }
    await client.query("DELETE FROM import_items WHERE batch_id = $1", [batchId]);
    const persistenceChunkSize = 1_000;
    for (let offset = 0; offset < candidates.length; offset += persistenceChunkSize) {
      const normalized = candidates.slice(offset, offset + persistenceChunkSize).map(normalizeCandidate);
      await client.query(`INSERT INTO import_items (
          batch_id, ordinal, validation_status, source_page, source_row, source_locator,
          source_text, raw_source, model_output, occurred_on, value_on, description, note,
          amount, currency, transaction_type, cost_center_id, source_system, external_id,
          deduplication_fingerprint, confidence, validation_errors, validation_warnings
        ) SELECT
          $1, c.ordinal, c."validationStatus", c."sourcePage", c."sourceRow", c."sourceLocator",
          c."sourceText", c."rawSource", c."modelOutput", c."occurredOn"::date,
          c."valueOn"::date, c.description, c.note, c.amount::numeric, c.currency,
          c."transactionType", c."costCenterId"::uuid, c."sourceSystem", c."externalId",
          c."deduplicationFingerprint", c.confidence::numeric, c."validationErrors",
          c."validationWarnings"
        FROM jsonb_to_recordset($2::jsonb) AS c(
          ordinal integer,
          "validationStatus" text,
          "sourcePage" integer,
          "sourceRow" integer,
          "sourceLocator" jsonb,
          "sourceText" text,
          "rawSource" jsonb,
          "modelOutput" jsonb,
          "occurredOn" text,
          "valueOn" text,
          description text,
          note text,
          amount text,
          currency text,
          "transactionType" text,
          "costCenterId" text,
          "sourceSystem" text,
          "externalId" text,
          "deduplicationFingerprint" text,
          confidence text,
          "validationErrors" jsonb,
          "validationWarnings" jsonb
        )`, [batchId, JSON.stringify(normalized)]);
    }
    await client.query(`INSERT INTO import_events (batch_id, event_name, actor_type, details)
      VALUES ($1, 'items.replaced', 'worker', jsonb_build_object('count', $2::integer))`, [batchId, candidates.length]);
    return candidates.length;
  });
}

export async function listImportItems(
  batchId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<ImportItem[]> {
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("limit must be between 1 and 200.");
  if (!Number.isInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer.");
  const result = await db.query(
    "SELECT * FROM import_items WHERE batch_id = $1 ORDER BY ordinal LIMIT $2 OFFSET $3",
    [batchId, limit, offset],
  );
  return result.rows.map(itemFromRow);
}

export async function listImportEvents(batchId: string, limit = 100): Promise<ImportEvent[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("limit must be between 1 and 500.");
  const result = await db.query(`SELECT * FROM (
      SELECT * FROM import_events WHERE batch_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2
    ) AS recent ORDER BY created_at, id`, [batchId, limit]);
  return result.rows.map(eventFromRow);
}

export async function listImportTransactionMappings(batchId: string, itemIds?: readonly string[]) {
  if (itemIds && !itemIds.length) return [];
  const result = await db.query(`SELECT s.import_item_id, s.transaction_id
    FROM transaction_sources s
    JOIN import_items i ON i.id = s.import_item_id
    WHERE i.batch_id = $1
      AND ($2::uuid[] IS NULL OR i.id = ANY($2::uuid[]))
    ORDER BY i.ordinal`, [batchId, itemIds ? [...itemIds] : null]);
  return result.rows.map((row) => ({
    importItemId: String(row.import_item_id),
    transactionId: String(row.transaction_id),
  }));
}

export async function findImportedFingerprints(accountId: string, fingerprints: readonly string[]) {
  const normalized = [...new Set(fingerprints.map(normalizeFingerprint).filter((value): value is string => !!value))];
  if (!normalized.length) return new Set<string>();
  const result = await db.query<{ deduplication_fingerprint: string }>(`SELECT DISTINCT s.deduplication_fingerprint
    FROM transaction_sources s
    JOIN transactions t ON t.id = s.transaction_id
    WHERE t.account_id = $1 AND s.deduplication_fingerprint = ANY($2::char(64)[])`, [accountId, normalized]);
  return new Set(result.rows.map((row) => String(row.deduplication_fingerprint)));
}

export async function importBatchHasFingerprint(batchId: string, itemId: string, fingerprint: string) {
  const normalized = normalizeFingerprint(fingerprint);
  if (!normalized) return false;
  const result = await db.query(`SELECT 1 FROM import_items
    WHERE batch_id = $1 AND id <> $2 AND deduplication_fingerprint = $3
    LIMIT 1`, [batchId, itemId, normalized]);
  return !!result.rowCount;
}

export async function updateImportItemReview(
  batchId: string,
  itemId: string,
  input: UpdateImportItemReviewInput,
  expectedReviewRevision: string,
): Promise<{ item: ImportItem; reviewRevision: string }> {
  if (!/^\d+$/.test(expectedReviewRevision)) throw new Error("A valid review revision is required.");
  if (Object.hasOwn(input, "occurredOn")) assertIsoDate(input.occurredOn, "occurredOn");
  if (Object.hasOwn(input, "valueOn")) assertIsoDate(input.valueOn, "valueOn");
  if (input.amount != null) assertDecimal(input.amount, "amount");
  if (input.currency != null && !/^[A-Z]{3}$/.test(input.currency)) {
    throw new Error("currency must be a three-letter uppercase code.");
  }
  if (input.confidence != null && !confidencePattern.test(input.confidence)) {
    throw new Error("confidence must be a decimal string between zero and one with at most four decimal places.");
  }
  if (input.deduplicationFingerprint != null && !sha256Pattern.test(input.deduplicationFingerprint)) {
    throw new Error("deduplicationFingerprint must be a lowercase hexadecimal SHA-256 digest.");
  }

  return inTransaction(async (client) => {
    const batchResult = await client.query<{ status: ImportBatchStatus; review_revision: string }>(
      "SELECT status, review_revision FROM import_batches WHERE id = $1 FOR UPDATE",
      [batchId],
    );
    if (!batchResult.rowCount) throw new Error("Import batch not found.");
    if (batchResult.rows[0].status !== "awaiting_review") {
      throw new Error(`Import items cannot be reviewed while the batch is ${batchResult.rows[0].status}.`);
    }
    if (String(batchResult.rows[0].review_revision) !== expectedReviewRevision) {
      throw new Error("The review changed before this candidate update. Refresh the batch and try again.");
    }
    const existing = await client.query(
      "SELECT * FROM import_items WHERE id = $1 AND batch_id = $2 FOR UPDATE",
      [itemId, batchId],
    );
    if (!existing.rowCount) throw new Error("Import item not found.");
    if (existing.rows[0].imported_at != null) throw new Error("An imported item can no longer be edited.");

    const values: unknown[] = [itemId, batchId];
    const assignments: string[] = [];
    const changedFields: string[] = [];
    const add = (column: string, field: keyof UpdateImportItemReviewInput, value: unknown, cast = "") => {
      values.push(value);
      assignments.push(`${column} = $${values.length}${cast}`);
      changedFields.push(field);
    };
    if (Object.hasOwn(input, "occurredOn")) add("occurred_on", "occurredOn", input.occurredOn ?? null, "::date");
    if (Object.hasOwn(input, "valueOn")) add("value_on", "valueOn", input.valueOn ?? null, "::date");
    if (Object.hasOwn(input, "description")) add("description", "description", input.description ?? null);
    if (Object.hasOwn(input, "note")) add("note", "note", input.note ?? "");
    if (Object.hasOwn(input, "amount")) add("amount", "amount", input.amount ?? null, "::numeric");
    if (Object.hasOwn(input, "currency")) add("currency", "currency", input.currency ?? null);
    if (Object.hasOwn(input, "transactionType")) add("transaction_type", "transactionType", input.transactionType ?? null);
    if (Object.hasOwn(input, "costCenterId")) add("cost_center_id", "costCenterId", input.costCenterId ?? null, "::uuid");
    if (Object.hasOwn(input, "confidence")) add("confidence", "confidence", input.confidence ?? null, "::numeric");
    if (Object.hasOwn(input, "deduplicationFingerprint")) {
      add("deduplication_fingerprint", "deduplicationFingerprint", input.deduplicationFingerprint ?? null);
    }
    if (Object.hasOwn(input, "validationStatus")) add("validation_status", "validationStatus", input.validationStatus);
    if (Object.hasOwn(input, "validationErrors")) {
      add("validation_errors", "validationErrors", JSON.stringify(input.validationErrors ?? []), "::jsonb");
    }
    if (Object.hasOwn(input, "validationWarnings")) {
      add("validation_warnings", "validationWarnings", JSON.stringify(input.validationWarnings ?? []), "::jsonb");
    }
    if (Object.hasOwn(input, "reviewStatus")) {
      add("review_status", "reviewStatus", input.reviewStatus);
      values.push(input.reviewedBy ?? null);
      assignments.push(`reviewed_by = $${values.length}`, "reviewed_at = now()");
    } else if (changedFields.length) {
      assignments.push("review_status = 'pending'", "reviewed_by = NULL", "reviewed_at = NULL");
    }
    if (!assignments.length) throw new Error("No import item changes were provided.");
    assignments.push("updated_at = now()");

    const updated = await client.query(`UPDATE import_items SET ${assignments.join(", ")}
      WHERE id = $1 AND batch_id = $2
      RETURNING *`, values);
    const revision = await client.query<{ review_revision: string }>(`UPDATE import_batches
      SET updated_at = clock_timestamp(), review_revision = review_revision + 1
      WHERE id = $1
      RETURNING review_revision`, [batchId]);
    await client.query(`INSERT INTO import_events
        (batch_id, item_id, event_name, from_status, to_status, actor_type, actor_id, details)
      VALUES ($1, $2, 'item.reviewed', $3, $4, 'user', $5,
        jsonb_build_object('changedFields', $6::jsonb))`, [
      batchId,
      itemId,
      String(existing.rows[0].review_status),
      input.reviewStatus ?? "pending",
      input.reviewedBy ?? null,
      JSON.stringify(changedFields),
    ]);
    return {
      item: itemFromRow(updated.rows[0]),
      reviewRevision: String(revision.rows[0].review_revision),
    };
  });
}

type ApprovalItem = Pick<ImportItem,
  "id" | "ordinal" | "validationStatus" | "reviewStatus" | "occurredOn" | "description" | "amount"
  | "currency" | "transactionType" | "sourceSystem" | "externalId" | "deduplicationFingerprint" | "validationWarnings"
> & { accountCurrency: string };

function ledgerAmountProblem(item: ApprovalItem) {
  if (!item.occurredOn) return "date is missing";
  if (!item.description?.trim()) return "description is missing";
  if (!item.amount) return "amount is missing";
  if (!item.currency) return "currency is missing";
  if (!item.transactionType) return "transaction type is missing";
  if (!["valid", "needs_review"].includes(item.validationStatus)) return `validation status is ${item.validationStatus}`;
  if (!decimalPattern.test(item.amount)) return "amount is not a valid decimal";
  const [integerPart, fraction = ""] = item.amount.replace(/^-/, "").split(".");
  if (fraction.length > 2) return "the current ledger supports at most two decimal places";
  if (integerPart.replace(/^0+/, "").length > 14) return "amount exceeds the current ledger precision";
  if (/^-?0(?:\.0+)?$/.test(item.amount)) return "amount is zero";
  if (item.transactionType === "Expense" && !item.amount.startsWith("-")) return "expense amount is not negative";
  if (item.transactionType === "Income" && item.amount.startsWith("-")) return "income amount is not positive";
  if (item.currency !== item.accountCurrency) return `currency ${item.currency} differs from account currency ${item.accountCurrency}`;
  return null;
}

async function completedApprovalResult(
  client: PoolClient,
  batchId: string,
  alreadyCompleted: boolean,
  insertedCount: number,
): Promise<ApproveImportBatchResult> {
  const counts = await client.query(`SELECT
      count(*) FILTER (WHERE review_status = 'approved')::int AS approved_count,
      count(*) FILTER (WHERE review_status = 'rejected')::int AS rejected_count
    FROM import_items WHERE batch_id = $1`, [batchId]);
  return {
    batchId,
    status: "completed",
    alreadyCompleted,
    approvedCount: Number(counts.rows[0].approved_count),
    rejectedCount: Number(counts.rows[0].rejected_count),
    insertedCount,
  };
}

/**
 * Finalizes a reviewed batch and inserts its ledger rows atomically.
 *
 * The batch row is locked and each ledger transaction gets a unique
 * transaction_sources.import_item_id. Repeating this operation after a
 * successful commit only returns the original mappings; it never inserts the
 * same import item twice.
 */
export async function approveImportBatch(input: ApproveImportBatchInput): Promise<ApproveImportBatchResult> {
  if (!/^\d+$/.test(input.reviewRevision)) {
    throw new Error("A valid review revision is required.");
  }
  const result = await inTransaction<ApproveImportBatchResult | { reviewChangedOrdinals: number[] }>(async (client) => {
    const batchResult = await client.query("SELECT * FROM import_batches WHERE id = $1 FOR UPDATE", [input.batchId]);
    if (!batchResult.rowCount) throw new Error("Import batch not found.");
    const batch = batchFromRow(batchResult.rows[0]);
    if (batch.status === "completed") return completedApprovalResult(client, batch.id, true, 0);
    if (batch.status !== "awaiting_review" && batch.status !== "approving") {
      throw new Error(`Import batch cannot be approved while it is ${batch.status}.`);
    }
    if (batch.reviewRevision !== input.reviewRevision) {
      throw new Error("The review changed before approval. Refresh the batch and try again.");
    }

    // Serialize approvals for the same account so strong external identifiers
    // can be checked without a race between two batches.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [batch.accountId]);
    const itemResult = await client.query(`SELECT
        i.id, i.ordinal, i.validation_status, i.review_status, i.occurred_on,
        i.description, i.amount, i.currency, i.transaction_type, i.source_system,
        i.external_id, i.deduplication_fingerprint, i.validation_warnings,
        a.currency AS account_currency
      FROM import_items i
      JOIN import_batches b ON b.id = i.batch_id
      JOIN accounts a ON a.id = b.account_id
      WHERE i.batch_id = $1
      ORDER BY i.ordinal
      FOR UPDATE OF i`, [batch.id]);
    const items: ApprovalItem[] = itemResult.rows.map((row) => ({
      id: String(row.id),
      ordinal: Number(row.ordinal),
      validationStatus: row.validation_status as ImportItem["validationStatus"],
      reviewStatus: row.review_status as ImportItem["reviewStatus"],
      occurredOn: date(row.occurred_on),
      description: row.description == null ? null : String(row.description),
      amount: decimal(row.amount),
      currency: row.currency == null ? null : String(row.currency),
      transactionType: row.transaction_type == null ? null : row.transaction_type as ImportItem["transactionType"],
      sourceSystem: String(row.source_system),
      externalId: row.external_id == null ? null : String(row.external_id),
      deduplicationFingerprint: row.deduplication_fingerprint == null ? null : String(row.deduplication_fingerprint),
      validationWarnings: jsonArray(row.validation_warnings),
      accountCurrency: String(row.account_currency),
    }));
    const approvedItems = items.filter((item) => item.reviewStatus === "approved");
    const approvedItemsById = new Map(approvedItems.map((item) => [item.id, item]));
    const approvedItemIds = approvedItems.map((item) => item.id);
    const pendingCount = items.filter((item) => item.reviewStatus === "pending").length;
    if (pendingCount) throw new Error(`Review every candidate before insertion (${pendingCount} remaining).`);
    for (const item of approvedItems) {
      const problem = ledgerAmountProblem(item);
      if (problem) throw new Error(`Import item ${item.ordinal} cannot be approved: ${problem}.`);
    }

    const selectedExternalIds = new Set<string>();
    for (const item of approvedItems) {
      if (!item.externalId) continue;
      const key = `${item.sourceSystem}\u0000${item.externalId}`;
      if (selectedExternalIds.has(key)) {
        throw new Error(`Import item ${item.ordinal} repeats an external transaction id in this batch.`);
      }
      selectedExternalIds.add(key);
    }
    if (approvedItemIds.length) {
      const duplicate = await client.query(`SELECT i.ordinal
        FROM import_items i
        JOIN import_batches b ON b.id = i.batch_id
        JOIN transaction_sources s
          ON s.source_system = i.source_system
          AND s.external_id = i.external_id
        JOIN transactions source_transaction
          ON source_transaction.id = s.transaction_id
          AND source_transaction.account_id = b.account_id
        WHERE i.batch_id = $1 AND i.id = ANY($2::uuid[]) AND i.external_id IS NOT NULL
        LIMIT 1`, [batch.id, approvedItemIds]);
      if (duplicate.rowCount) {
        throw new Error(`Import item ${duplicate.rows[0].ordinal} has already been imported from this source.`);
      }

      // Fingerprints are intentionally warnings, not unique constraints: two
      // genuinely equal card payments can exist. If the warning was already on
      // screen, approval acknowledges it. A conflict that appeared after review
      // is returned to pending so it cannot slip through a stale tab.
      const fingerprintConflicts = await client.query<{ id: string; ordinal: number }>(`SELECT DISTINCT i.id, i.ordinal
        FROM import_items i
        JOIN import_batches b ON b.id = i.batch_id
        JOIN transaction_sources s ON s.deduplication_fingerprint = i.deduplication_fingerprint
        JOIN transactions source_transaction
          ON source_transaction.id = s.transaction_id
          AND source_transaction.account_id = b.account_id
        WHERE i.batch_id = $1
          AND i.id = ANY($2::uuid[])
          AND i.deduplication_fingerprint IS NOT NULL`, [batch.id, approvedItemIds]);
      const newlyConflicting = fingerprintConflicts.rows.filter((conflict) => {
        const item = approvedItemsById.get(String(conflict.id));
        return !item?.validationWarnings.some((warning) => (
          typeof warning === "string" && warning.startsWith("Possible duplicate:")
        ));
      });
      if (newlyConflicting.length) {
        const ids = newlyConflicting.map((conflict) => String(conflict.id));
        await client.query(`UPDATE import_items SET
            review_status = 'pending',
            reviewed_by = NULL,
            reviewed_at = NULL,
            validation_status = CASE WHEN validation_status = 'valid' THEN 'needs_review' ELSE validation_status END,
            validation_warnings = validation_warnings || jsonb_build_array(
              'Possible duplicate: the same date, amount, currency, and description were seen before.'
            ),
            updated_at = clock_timestamp()
          WHERE id = ANY($1::uuid[])`, [ids]);
        await client.query(`UPDATE import_batches
          SET updated_at = clock_timestamp(), review_revision = review_revision + 1
          WHERE id = $1`, [batch.id]);
        await client.query(`INSERT INTO import_events
            (batch_id, event_name, actor_type, actor_id, details)
          VALUES ($1, 'review.duplicate_changed', 'system', $2,
            jsonb_build_object('ordinals', $3::jsonb))`, [
          batch.id,
          input.approvedBy ?? null,
          JSON.stringify(newlyConflicting.map((conflict) => Number(conflict.ordinal))),
        ]);
        return { reviewChangedOrdinals: newlyConflicting.map((conflict) => Number(conflict.ordinal)) };
      }
    }

    await client.query("UPDATE import_batches SET status = 'approving', updated_at = now() WHERE id = $1", [batch.id]);
    await client.query(`INSERT INTO import_events
        (batch_id, event_name, from_status, to_status, actor_type, actor_id, details)
      VALUES ($1, 'batch.status_changed', $2, 'approving', 'user', $3,
        jsonb_build_object('approvedItemCount', $4::integer))`, [
      batch.id,
      batch.status,
      input.approvedBy ?? null,
      approvedItemIds.length,
    ]);

    await client.query(`UPDATE import_items SET
        review_status = CASE WHEN id = ANY($2::uuid[]) THEN 'approved' ELSE 'rejected' END,
        reviewed_by = $3,
        reviewed_at = COALESCE(reviewed_at, now()),
        updated_at = now()
      WHERE batch_id = $1 AND imported_at IS NULL`, [batch.id, approvedItemIds, input.approvedBy ?? null]);

    let insertedCount = 0;
    if (approvedItemIds.length) {
      const inserted = await client.query(`WITH candidates AS MATERIALIZED (
          SELECT
            i.id AS import_item_id,
            gen_random_uuid() AS transaction_id,
            b.account_id,
            i.occurred_on,
            i.description,
            i.note,
            i.cost_center_id,
            i.amount,
            i.transaction_type,
            i.source_system,
            i.external_id,
            i.deduplication_fingerprint
          FROM import_items i
          JOIN import_batches b ON b.id = i.batch_id
          LEFT JOIN transaction_sources existing ON existing.import_item_id = i.id
          WHERE i.batch_id = $1 AND i.id = ANY($2::uuid[]) AND existing.id IS NULL
        ), inserted_transactions AS (
          INSERT INTO transactions (
            id, occurred_on, description, note, account_id, cost_center_id, amount, type
          )
          SELECT
            transaction_id, occurred_on, description, note, account_id, cost_center_id, amount, transaction_type
          FROM candidates
          RETURNING id
        )
        INSERT INTO transaction_sources (
          transaction_id, import_item_id, account_id, source_system, external_id, deduplication_fingerprint
        )
        SELECT
          c.transaction_id, c.import_item_id, c.account_id, c.source_system, c.external_id,
          c.deduplication_fingerprint
        FROM candidates c
        JOIN inserted_transactions t ON t.id = c.transaction_id
        RETURNING import_item_id, transaction_id`, [batch.id, approvedItemIds]);
      insertedCount = inserted.rowCount ?? inserted.rows.length;
      await client.query(`UPDATE import_items SET imported_at = COALESCE(imported_at, now()), updated_at = now()
        WHERE batch_id = $1 AND id = ANY($2::uuid[])`, [batch.id, approvedItemIds]);
    }

    await client.query(`UPDATE import_batches SET
        status = 'completed', completed_at = COALESCE(completed_at, now()), updated_at = now()
      WHERE id = $1`, [batch.id]);
    await client.query(`INSERT INTO import_events
        (batch_id, event_name, from_status, to_status, actor_type, actor_id, details)
      VALUES ($1, 'batch.status_changed', 'approving', 'completed', 'user', $2,
        jsonb_build_object('insertedTransactionCount', $3::integer))`, [
      batch.id,
      input.approvedBy ?? null,
      insertedCount,
    ]);
    return completedApprovalResult(client, batch.id, false, insertedCount);
  });
  if ("reviewChangedOrdinals" in result) {
    throw new Error(`The review changed because possible duplicates appeared for item${result.reviewChangedOrdinals.length === 1 ? "" : "s"} ${result.reviewChangedOrdinals.join(", ")}. Review them again.`);
  }
  return result;
}
