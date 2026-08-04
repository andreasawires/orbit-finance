import type {
  ImportBatch,
  ImportBatchDetail,
  ImportBatchSummary,
  ImportDocument,
  ImportEvent,
  ImportItem,
  JsonValue,
} from "@/lib/imports/types";

function readableStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function issueMessage(value: JsonValue) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.message === "string") {
    return value.message;
  }
  return JSON.stringify(value);
}

function eventMessage(event: ImportEvent) {
  if (event.eventName === "batch.created") return "File uploaded";
  if (event.eventName === "batch.status_changed" && event.toStatus) {
    return `Status changed to ${readableStatus(event.toStatus)}`;
  }
  if (event.eventName === "items.replaced") return "Transaction candidates extracted";
  if (event.eventName === "item.reviewed") return "Candidate reviewed";
  return readableStatus(event.eventName.replaceAll(".", " "));
}

function batchView(
  batch: ImportBatch,
  document: Pick<ImportDocument, "originalFilename" | "mediaType" | "sizeBytes">,
  account: { name: string },
  itemCount: number,
  approvedCount: number,
) {
  return {
    id: batch.id,
    accountId: batch.accountId,
    accountName: account.name,
    status: batch.status,
    originalFilename: document.originalFilename,
    mimeType: document.mediaType,
    byteSize: Number(document.sizeBytes),
    itemCount,
    approvedCount,
    errorMessage: batch.errorMessage ?? "",
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}

export function presentImportBatchSummary(summary: ImportBatchSummary) {
  return batchView(
    summary.batch,
    summary.document,
    summary.account,
    summary.counts.total,
    summary.counts.approved,
  );
}

function presentDocument(document: ImportDocument, batchId: string) {
  return {
    id: document.id,
    originalFilename: document.originalFilename,
    mimeType: document.mediaType,
    byteSize: Number(document.sizeBytes),
    sha256: document.sha256,
    pageCount: document.pageCount,
    metadata: document.metadata,
    originalUrl: `/api/imports/${batchId}/document`,
  };
}

export function presentImportItem(
  item: ImportItem,
  sourceKind: ImportBatch["sourceKind"],
  transactionId: string | null = null,
) {
  return {
    id: item.id,
    sourceKind: sourceKind === "csv" ? "csv_row" : sourceKind === "image" ? "image" : "pdf_page",
    sourcePage: item.sourcePage,
    sourceRow: item.sourceRow,
    sourceEvidence: item.sourceText,
    candidate: {
      occurredOn: item.occurredOn,
      description: item.description,
      note: item.note,
      amount: item.amount,
      currency: item.currency,
      type: item.transactionType,
      costCenterId: item.costCenterId,
      confidence: item.confidence == null ? null : Number(item.confidence),
    },
    validationStatus: item.validationStatus,
    validationErrors: item.validationErrors.map(issueMessage),
    validationWarnings: item.validationWarnings.map(issueMessage),
    reviewStatus: item.reviewStatus,
    transactionId: transactionId ?? "",
  };
}

export function presentImportDetail(
  detail: ImportBatchDetail,
  transactionMappings: readonly { importItemId: string; transactionId: string }[] = [],
) {
  const transactionIds = new Map(transactionMappings.map((mapping) => [mapping.importItemId, mapping.transactionId]));
  return {
    batch: batchView(detail.batch, detail.document, detail.account, detail.counts.total, detail.counts.approved),
    document: presentDocument(detail.document, detail.batch.id),
    items: detail.items.map((item) => presentImportItem(
      item,
      detail.batch.sourceKind,
      transactionIds.get(item.id) ?? null,
    )),
    counts: detail.counts,
    pagination: detail.pagination,
    reviewRevision: detail.reviewRevision,
    events: detail.events.map((event) => ({
      id: event.id,
      message: eventMessage(event),
      status: event.toStatus ?? event.eventName,
      createdAt: event.createdAt,
    })),
  };
}
