/**
 * PostgreSQL numeric values must stay strings at the TypeScript boundary.
 * Converting money through JavaScript's `number` type can silently lose
 * precision. Repository functions validate the string before writing it.
 */
export type DecimalString = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const IMPORT_BATCH_STATUSES = [
  "uploaded",
  "queued",
  "extracting",
  "converting",
  "validating",
  "awaiting_review",
  "approving",
  "completed",
  "failed",
  "cancelled",
] as const;

export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

export const IMPORT_VALIDATION_STATUSES = [
  "pending",
  "valid",
  "needs_review",
  "invalid",
  "duplicate",
] as const;

export type ImportValidationStatus = (typeof IMPORT_VALIDATION_STATUSES)[number];

export const IMPORT_REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type ImportReviewStatus = (typeof IMPORT_REVIEW_STATUSES)[number];

export type ImportSourceKind = "csv" | "pdf" | "image";
export type ImportTransactionType = "Income" | "Expense";
export type ImportActorType = "system" | "worker" | "user";

export type ImportDocument = {
  id: string;
  workspaceId: string;
  sha256: string;
  storageKey: string;
  originalFilename: string;
  mediaType: string;
  sizeBytes: DecimalString;
  pageCount: number | null;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
};

export type ImportPipelineProvenance = {
  pipelineVersion: string;
  parserName?: string | null;
  parserVersion?: string | null;
  extractorName?: string | null;
  extractorVersion?: string | null;
  modelName?: string | null;
  modelVersion?: string | null;
  modelQuantization?: string | null;
  promptVersion?: string | null;
  settings?: JsonObject;
};

export type ImportBatch = ImportPipelineProvenance & {
  id: string;
  workspaceId: string;
  documentId: string;
  accountId: string;
  sourceKind: ImportSourceKind;
  status: ImportBatchStatus;
  idempotencyKey: string | null;
  /** IANA timezone the statement's calendar dates are in; dates become UTC instants on approval. */
  statementTimezone: string;
  errorCode: string | null;
  errorMessage: string | null;
  reviewRevision: string;
  createdAt: string;
  updatedAt: string;
  queuedAt: string | null;
  startedAt: string | null;
  reviewReadyAt: string | null;
  completedAt: string | null;
};

export type ImportItem = {
  id: string;
  workspaceId: string;
  batchId: string;
  ordinal: number;
  validationStatus: ImportValidationStatus;
  reviewStatus: ImportReviewStatus;
  sourcePage: number | null;
  sourceRow: number | null;
  sourceLocator: JsonObject;
  sourceText: string;
  rawSource: JsonObject;
  modelOutput: JsonObject;
  occurredOn: string | null;
  valueOn: string | null;
  description: string | null;
  note: string;
  amount: DecimalString | null;
  currency: string | null;
  transactionType: ImportTransactionType | null;
  costCenterId: string | null;
  sourceSystem: string;
  externalId: string | null;
  deduplicationFingerprint: string | null;
  confidence: DecimalString | null;
  validationErrors: JsonValue[];
  validationWarnings: JsonValue[];
  reviewedBy: string | null;
  reviewedAt: string | null;
  importedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ImportEvent = {
  id: string;
  workspaceId: string;
  batchId: string;
  itemId: string | null;
  eventName: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorType: ImportActorType;
  actorId: string | null;
  details: JsonObject;
  createdAt: string;
};

export type TransactionSource = {
  id: string;
  workspaceId: string;
  transactionId: string;
  importItemId: string;
  accountId: string;
  sourceSystem: string;
  externalId: string | null;
  deduplicationFingerprint: string | null;
  createdAt: string;
};

export type RegisterImportDocumentInput = {
  workspaceId: string;
  sha256: string;
  storageKey: string;
  originalFilename: string;
  mediaType: string;
  sizeBytes: DecimalString;
  pageCount?: number | null;
  metadata?: JsonObject;
};

export type CreateImportBatchInput = ImportPipelineProvenance & {
  workspaceId: string;
  documentId: string;
  accountId: string;
  sourceKind: ImportSourceKind;
  idempotencyKey?: string | null;
  statementTimezone: string;
};

export type ImportItemCandidate = {
  ordinal: number;
  validationStatus?: ImportValidationStatus;
  sourcePage?: number | null;
  sourceRow?: number | null;
  sourceLocator?: JsonObject;
  sourceText?: string;
  rawSource?: JsonObject;
  modelOutput?: JsonObject;
  occurredOn?: string | null;
  valueOn?: string | null;
  description?: string | null;
  note?: string;
  amount?: DecimalString | null;
  currency?: string | null;
  transactionType?: ImportTransactionType | null;
  costCenterId?: string | null;
  sourceSystem?: string;
  externalId?: string | null;
  deduplicationFingerprint?: string | null;
  confidence?: DecimalString | null;
  validationErrors?: JsonValue[];
  validationWarnings?: JsonValue[];
};

export type ApproveImportBatchInput = {
  workspaceId: string;
  batchId: string;
  /** Batch revision shown on the review screen; prevents stale-tab approval. */
  reviewRevision: string;
  approvedBy?: string | null;
  /** Overrides the batch's statement timezone before its dates are converted to UTC. */
  statementTimezone?: string;
};

export type ApproveImportBatchResult = {
  batchId: string;
  status: "completed";
  alreadyCompleted: boolean;
  approvedCount: number;
  rejectedCount: number;
  insertedCount: number;
};

export type ImportAccountReference = {
  id: string;
  name: string;
  currency: string;
};

export type ImportWork = {
  batch: ImportBatch;
  document: ImportDocument;
  account: ImportAccountReference;
};

export type ImportBatchSummary = {
  batch: ImportBatch;
  document: Pick<ImportDocument, "id" | "originalFilename" | "mediaType" | "sizeBytes">;
  account: ImportAccountReference;
  counts: {
    total: number;
    valid: number;
    needsReview: number;
    invalid: number;
    duplicate: number;
    approved: number;
    rejected: number;
    imported: number;
  };
};

export type ImportBatchDetail = ImportWork & {
  items: ImportItem[];
  events: ImportEvent[];
  counts: {
    total: number;
    approved: number;
    rejected: number;
    pending: number;
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  reviewRevision: string;
};

export type UpdateImportItemReviewInput = {
  occurredOn?: string | null;
  valueOn?: string | null;
  description?: string | null;
  note?: string;
  amount?: DecimalString | null;
  currency?: string | null;
  transactionType?: ImportTransactionType | null;
  costCenterId?: string | null;
  confidence?: DecimalString | null;
  deduplicationFingerprint?: string | null;
  validationStatus?: ImportValidationStatus;
  validationErrors?: JsonValue[];
  validationWarnings?: JsonValue[];
  reviewStatus?: ImportReviewStatus;
  reviewedBy?: string | null;
};
