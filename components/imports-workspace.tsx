"use client";

import Link from "next/link";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileSpreadsheet,
  FileText,
  ExternalLink,
  Image as ImageIcon,
  LoaderCircle,
  PencilLine,
  RefreshCw,
  RotateCcw,
  UploadCloud,
  X,
  XCircle,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { flattenCostCenters, type CostCenter } from "@/lib/data";
import { useFinanceData } from "@/lib/use-finance-data";
import { useWorkspace } from "@/components/workspace-provider";
import { TimeZoneSelect } from "@/components/time-zone-select";
import { isValidTimeZone } from "@/lib/time";

type UnknownRecord = Record<string, unknown>;

type ImportBatch = {
  id: string;
  accountId: string;
  accountName: string;
  status: string;
  statementTimezone: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  itemCount: number;
  approvedCount: number;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
};

type ImportDocument = {
  id: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  pageCount: number | null;
  originalUrl: string;
  extractionWarnings: string[];
};

type TransactionCandidate = UnknownRecord & {
  occurredOn?: string;
  description?: string;
  note?: string;
  amount?: string;
  currency?: string;
  type?: "Income" | "Expense";
  confidence?: number;
};

type ImportItem = {
  id: string;
  sourceKind: string;
  sourcePage: number | null;
  sourceRow: number | null;
  sourceEvidence: string;
  candidate: TransactionCandidate;
  validationErrors: string[];
  validationWarnings: string[];
  reviewStatus: string;
  transactionId: string;
};

type ImportEvent = {
  id: string;
  message: string;
  status: string;
  createdAt: string;
};

type ImportDetail = {
  batch: ImportBatch;
  document: ImportDocument | null;
  items: ImportItem[];
  events: ImportEvent[];
  counts: ReviewCounts;
  pagination: ImportPagination;
  reviewRevision: string;
};

type ReviewCounts = {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
};

type ImportPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type ImportLimits = {
  pdfBytes: number;
  csvBytes: number;
  imageBytes: number;
  pdfPages: number;
};

type CandidateDraft = {
  occurredOn: string;
  description: string;
  note: string;
  amount: string;
  currency: string;
  type: "Income" | "Expense";
  costCenterId: string;
};

const MIB = 1024 * 1024;
const DEFAULT_LIMITS: ImportLimits = {
  pdfBytes: 25 * MIB,
  csvBytes: 10 * MIB,
  imageBytes: 10 * MIB,
  pdfPages: 50,
};

const STATEMENT_TIMEZONE_KEY = "orbit-statement-timezone";
const REVIEW_PAGE_SIZE = 100;

const PROCESSING_STATUSES = new Set([
  "uploaded",
  "queued",
  "extracting",
  "converting",
  "validating",
  "processing",
  "approving",
]);

const READY_STATUSES = new Set(["awaiting_review", "ready_for_review", "review"]);
const COMPLETED_STATUSES = new Set(["completed", "approved", "inserted"]);
const FAILED_STATUSES = new Set(["failed", "cancelled", "canceled"]);

const isRecord = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const asString = (value: unknown, fallback = "") => typeof value === "string" ? value : value == null ? fallback : String(value);
const asNumber = (value: unknown, fallback = 0) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
};

function normalizeStatus(value: unknown) {
  return asString(value, "queued").trim().toLowerCase().replaceAll("-", " ").replaceAll(" ", "_");
}

function normalizeBatch(value: unknown): ImportBatch | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  if (!id) return null;
  return {
    id,
    accountId: asString(value.accountId ?? value.account_id),
    accountName: asString(value.accountName ?? value.account_name),
    status: normalizeStatus(value.status),
    statementTimezone: asString(value.statementTimezone ?? value.statement_timezone, "UTC"),
    originalFilename: asString(value.originalFilename ?? value.original_filename ?? value.fileName ?? value.filename, "Untitled import"),
    mimeType: asString(value.mimeType ?? value.mime_type ?? value.mediaType ?? value.media_type),
    byteSize: asNumber(value.byteSize ?? value.byte_size ?? value.sizeBytes ?? value.size_bytes),
    itemCount: asNumber(value.itemCount ?? value.item_count),
    approvedCount: asNumber(value.approvedCount ?? value.approved_count),
    errorMessage: asString(value.errorMessage ?? value.error_message ?? value.error),
    createdAt: asString(value.createdAt ?? value.created_at),
    updatedAt: asString(value.updatedAt ?? value.updated_at),
  };
}

function normalizeDocument(value: unknown): ImportDocument | null {
  if (!isRecord(value)) return null;
  const metadata = isRecord(value.metadata) ? value.metadata : null;
  const warnings = metadata?.extractionWarnings ?? metadata?.extraction_warnings;
  return {
    id: asString(value.id),
    originalFilename: asString(value.originalFilename ?? value.original_filename ?? value.fileName, "Untitled import"),
    mimeType: asString(value.mimeType ?? value.mime_type ?? value.mediaType ?? value.media_type),
    byteSize: asNumber(value.byteSize ?? value.byte_size ?? value.sizeBytes ?? value.size_bytes),
    sha256: asString(value.sha256),
    pageCount: value.pageCount == null && value.page_count == null ? null : asNumber(value.pageCount ?? value.page_count),
    originalUrl: asString(value.originalUrl ?? value.original_url),
    extractionWarnings: Array.isArray(warnings) ? warnings.map((warning) => asString(warning)).filter(Boolean) : [],
  };
}

function normalizeCandidate(value: unknown): TransactionCandidate {
  if (!isRecord(value)) return {};
  return {
    ...value,
    occurredOn: asString(value.occurredOn ?? value.occurred_on ?? value.date),
    description: asString(value.description ?? value.merchant),
    note: asString(value.note ?? value.detail),
    amount: asString(value.amount),
    currency: asString(value.currency).toUpperCase(),
    type: (value.type ?? value.transactionType ?? value.transaction_type) === "Income" ? "Income" : "Expense",
    confidence: value.confidence == null ? undefined : asNumber(value.confidence),
  };
}

function normalizeItem(value: unknown): ImportItem | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  if (!id) return null;
  const errors = value.validationErrors ?? value.validation_errors;
  const warnings = value.validationWarnings ?? value.validation_warnings;
  return {
    id,
    sourceKind: asString(value.sourceKind ?? value.source_kind ?? value.sourceSystem ?? value.source_system, "document"),
    sourcePage: value.sourcePage == null && value.source_page == null ? null : asNumber(value.sourcePage ?? value.source_page),
    sourceRow: value.sourceRow == null && value.source_row == null ? null : asNumber(value.sourceRow ?? value.source_row),
    sourceEvidence: asString(value.sourceEvidence ?? value.source_evidence ?? value.sourceText ?? value.source_text),
    candidate: normalizeCandidate(value.candidate ?? value),
    validationErrors: Array.isArray(errors) ? errors.map((item) => asString(item)).filter(Boolean) : [],
    validationWarnings: Array.isArray(warnings) ? warnings.map((item) => asString(item)).filter(Boolean) : [],
    reviewStatus: normalizeStatus(value.reviewStatus ?? value.review_status ?? "pending"),
    transactionId: asString(value.transactionId ?? value.transaction_id),
  };
}

function normalizeEvent(value: unknown, index: number): ImportEvent | null {
  if (!isRecord(value)) return null;
  return {
    id: asString(value.id, String(index)),
    message: asString(value.message ?? value.detail ?? value.eventName ?? value.event_name ?? value.eventType ?? value.event_type ?? value.status, "Import updated"),
    status: normalizeStatus(value.status ?? value.eventName ?? value.event_name ?? value.eventType ?? value.event_type),
    createdAt: asString(value.createdAt ?? value.created_at),
  };
}

function normalizeDetail(value: unknown): ImportDetail | null {
  if (!isRecord(value)) return null;
  const normalizedBatch = normalizeBatch(value.batch);
  if (!normalizedBatch) return null;
  const document = normalizeDocument(value.document);
  const account = isRecord(value.account) ? value.account : null;
  const batch = {
    ...normalizedBatch,
    originalFilename: document?.originalFilename || normalizedBatch.originalFilename,
    mimeType: document?.mimeType || normalizedBatch.mimeType,
    byteSize: document?.byteSize || normalizedBatch.byteSize,
    accountName: asString(account?.name, normalizedBatch.accountName),
  };
  const items = Array.isArray(value.items) ? value.items.map(normalizeItem).filter((item): item is ImportItem => !!item) : [];
  const paginationValue = isRecord(value.pagination) ? value.pagination : null;
  const countsValue = isRecord(value.counts) ? value.counts : null;
  const total = asNumber(paginationValue?.total ?? countsValue?.total, items.length);
  const approved = asNumber(countsValue?.approved, batch.approvedCount || items.filter((item) => item.reviewStatus === "approved").length);
  const rejected = asNumber(countsValue?.rejected, items.filter((item) => item.reviewStatus === "rejected").length);
  const pending = asNumber(countsValue?.pending ?? countsValue?.unresolved, Math.max(0, total - approved - rejected));
  const pageSize = Math.max(1, asNumber(paginationValue?.pageSize ?? paginationValue?.page_size, REVIEW_PAGE_SIZE));
  const totalPages = asNumber(paginationValue?.totalPages ?? paginationValue?.total_pages, total ? Math.ceil(total / pageSize) : 0);
  return {
    batch,
    document,
    items,
    events: Array.isArray(value.events) ? value.events.map(normalizeEvent).filter((event): event is ImportEvent => !!event) : [],
    counts: { total, approved, rejected, pending },
    pagination: {
      page: Math.max(1, asNumber(paginationValue?.page, 1)),
      pageSize,
      total,
      totalPages: Math.max(0, totalPages),
    },
    reviewRevision: asString(value.reviewRevision ?? value.review_revision),
  };
}

function getBatches(value: unknown) {
  const source = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.batches) ? value.batches : isRecord(value) && value.batch ? [value.batch] : [];
  return source.map((entry) => {
    if (!isRecord(entry) || !isRecord(entry.batch)) return normalizeBatch(entry);
    const batch = normalizeBatch(entry.batch);
    if (!batch) return null;
    const document = normalizeDocument(entry.document);
    const account = isRecord(entry.account) ? entry.account : null;
    const counts = isRecord(entry.counts) ? entry.counts : null;
    return {
      ...batch,
      originalFilename: document?.originalFilename || batch.originalFilename,
      mimeType: document?.mimeType || batch.mimeType,
      byteSize: document?.byteSize || batch.byteSize,
      accountName: asString(account?.name, batch.accountName),
      itemCount: asNumber(counts?.total, batch.itemCount),
      approvedCount: asNumber(counts?.approved, batch.approvedCount),
    };
  }).filter((batch): batch is ImportBatch => !!batch);
}

function errorFromBody(value: unknown, fallback: string) {
  if (!isRecord(value)) return fallback;
  return asString(value.error ?? value.message, fallback);
}

async function responseBody(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function positiveInteger(value: unknown, fallback: number) {
  const number = asNumber(value, fallback);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizeLimits(value: unknown): ImportLimits {
  if (!isRecord(value)) return DEFAULT_LIMITS;
  const pdf = isRecord(value.pdf) ? value.pdf : null;
  const csv = isRecord(value.csv) ? value.csv : null;
  const image = isRecord(value.image) ? value.image : null;
  return {
    pdfBytes: positiveInteger(value.maxPdfBytes ?? value.pdfBytes ?? pdf?.maxBytes, DEFAULT_LIMITS.pdfBytes),
    csvBytes: positiveInteger(value.maxCsvBytes ?? value.csvBytes ?? csv?.maxBytes, DEFAULT_LIMITS.csvBytes),
    imageBytes: positiveInteger(value.maxImageBytes ?? value.imageBytes ?? image?.maxBytes, DEFAULT_LIMITS.imageBytes),
    pdfPages: positiveInteger(value.maxPdfPages ?? value.pdfPages ?? pdf?.maxPages, DEFAULT_LIMITS.pdfPages),
  };
}

async function fetchBatches(workspaceFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const response = await workspaceFetch("/api/imports", { cache: "no-store" });
  const body = await responseBody(response);
  if (!response.ok) throw new Error(errorFromBody(body, "Could not load imports."));
  return {
    batches: getBatches(body),
    limits: isRecord(body) ? normalizeLimits(body.limits) : DEFAULT_LIMITS,
    remoteModelEnabled: isRecord(body) && body.remoteModelEnabled === true,
  };
}

function formatBytes(bytes: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MIB) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / MIB).toFixed(1)} MiB`;
}

function formatDate(value: string, includeTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(date);
}

function statusLabel(status: string) {
  const aliases: Record<string, string> = {
    awaiting_review: "Ready for review",
    ready_for_review: "Ready for review",
    uploaded: "Uploaded",
    queued: "Queued",
    extracting: "Extracting",
    converting: "Converting",
    validating: "Validating",
    approving: "Saving",
    completed: "Completed",
    failed: "Failed",
    pending: "Needs review",
    approved: "Approved",
    rejected: "Rejected",
  };
  return aliases[status] || status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status: string) {
  if (COMPLETED_STATUSES.has(status) || status === "approved") return "success";
  if (FAILED_STATUSES.has(status) || status === "rejected") return "danger";
  if (READY_STATUSES.has(status)) return "ready";
  if (PROCESSING_STATUSES.has(status)) return "working";
  return "pending";
}

function sourceLabel(item: ImportItem) {
  if (item.sourcePage != null) return `Page ${item.sourcePage}`;
  if (item.sourceRow != null) return `Row ${item.sourceRow}`;
  return item.sourceKind === "csv" ? "CSV row" : "Document source";
}

function fileKind(filename: string, mimeType: string) {
  if (mimeType.includes("csv") || filename.toLowerCase().endsWith(".csv")) return "csv";
  if (mimeType.startsWith("image/")) return "image";
  return "pdf";
}

function validateFile(file: File, limits: ImportLimits) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const rules: Record<string, { bytes: number; label: string }> = {
    pdf: { bytes: limits.pdfBytes, label: "PDF" },
    csv: { bytes: limits.csvBytes, label: "CSV" },
    jpg: { bytes: limits.imageBytes, label: "image" },
    jpeg: { bytes: limits.imageBytes, label: "image" },
    png: { bytes: limits.imageBytes, label: "image" },
    webp: { bytes: limits.imageBytes, label: "image" },
  };
  const rule = extension ? rules[extension] : undefined;
  if (!rule) return "Choose a PDF, CSV, JPG, PNG, or WebP file.";
  if (file.size > rule.bytes) return `${rule.label} files can be at most ${formatBytes(rule.bytes)}.`;
  return "";
}

function candidateDraft(candidate: TransactionCandidate): CandidateDraft {
  return {
    occurredOn: candidate.occurredOn || "",
    description: candidate.description || "",
    note: candidate.note || "",
    amount: candidate.amount || "",
    currency: candidate.currency || "",
    type: candidate.type === "Income" ? "Income" : "Expense",
    costCenterId: typeof candidate.costCenterId === "string" ? candidate.costCenterId : "",
  };
}

function candidatePayload(original: TransactionCandidate, draft: CandidateDraft): TransactionCandidate {
  return {
    ...original,
    occurredOn: draft.occurredOn,
    description: draft.description.trim(),
    note: draft.note.trim(),
    amount: draft.amount.trim(),
    currency: draft.currency.trim().toUpperCase(),
    type: draft.type,
    costCenterId: draft.costCenterId || null,
  };
}

function ImportFileIcon({ filename, mimeType, size = 19 }: { filename: string; mimeType: string; size?: number }) {
  const kind = fileKind(filename, mimeType);
  if (kind === "csv") return <FileSpreadsheet size={size} />;
  if (kind === "image") return <ImageIcon size={size} />;
  return <FileText size={size} />;
}

function StatusPill({ status }: { status: string }) {
  return <span className={`import-status-pill ${statusTone(status)}`}><i />{statusLabel(status)}</span>;
}

function CandidateEditor({
  item,
  onOpenOriginal,
  costCenters,
  disabled,
  onAction,
}: {
  item: ImportItem;
  onOpenOriginal: ((page: number | null) => void) | null;
  costCenters: Array<CostCenter & { path: string }>;
  disabled: boolean;
  onAction: (reviewStatus: string, candidate: TransactionCandidate) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => candidateDraft(item.candidate));
  const [dirty, setDirty] = useState(false);
  const [localError, setLocalError] = useState("");

  const update = (field: keyof CandidateDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setLocalError("");
  };

  const act = async (reviewStatus: string) => {
    if (reviewStatus !== "rejected") {
      if (!draft.occurredOn || !draft.description.trim() || !draft.amount.trim() || !draft.currency.trim()) {
        setLocalError("Date, description, amount, and currency are required.");
        return;
      }
      if (!/^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/.test(draft.amount.trim())) {
        setLocalError("Amount must have up to 14 integer digits and 2 decimal places, for example -42.50.");
        return;
      }
    }
    try {
      await onAction(reviewStatus, candidatePayload(item.candidate, draft));
      setDirty(false);
      setLocalError("");
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "Could not update this candidate.");
    }
  };

  const confidence = item.candidate.confidence;
  const confidencePercent = confidence == null ? null : Math.round(confidence <= 1 ? confidence * 100 : confidence);

  return <article className={`import-candidate ${item.reviewStatus}`}>
    <div className="import-candidate-head">
      <div className="import-source-label">
        <span><ImportFileIcon filename={item.sourceKind} mimeType={item.sourceKind.includes("csv") ? "text/csv" : item.sourceKind === "image" ? "image/png" : "application/pdf"} size={16} /></span>
        <div><strong>{onOpenOriginal ? <button className="import-source-link" onClick={() => onOpenOriginal(item.sourcePage)}>{sourceLabel(item)} <ExternalLink size={11} /></button> : sourceLabel(item)}</strong><small>{confidencePercent == null ? "Model confidence unavailable" : `${confidencePercent}% model confidence`}</small></div>
      </div>
      <StatusPill status={item.reviewStatus} />
    </div>

    {(item.validationErrors.length > 0 || localError) && <div className="import-item-errors"><AlertCircle size={16} /><div>{localError && <span>{localError}</span>}{item.validationErrors.map((error, index) => <span key={`${error}-${index}`}>{error}</span>)}</div></div>}
    {item.validationWarnings.length > 0 && <div className="import-item-warnings"><AlertCircle size={16} /><div>{item.validationWarnings.map((warning, index) => <span key={`${warning}-${index}`}>{warning}</span>)}</div></div>}

    <div className="import-candidate-form">
      <label><span>Date</span><input type="date" value={draft.occurredOn} onChange={(event) => update("occurredOn", event.target.value)} disabled={disabled} /></label>
      <label className="description"><span>Description</span><input value={draft.description} onChange={(event) => update("description", event.target.value)} placeholder="Transaction description" disabled={disabled} /></label>
      <label><span>Amount</span><input inputMode="decimal" value={draft.amount} onChange={(event) => update("amount", event.target.value)} placeholder="-42.50" pattern="-?(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,2})?" disabled={disabled} /></label>
      <label><span>Currency</span><input value={draft.currency} onChange={(event) => update("currency", event.target.value.slice(0, 3))} placeholder="EUR" maxLength={3} disabled={disabled} /></label>
      <label><span>Type</span><select value={draft.type} onChange={(event) => update("type", event.target.value)} disabled={disabled}><option value="Expense">Expense</option><option value="Income">Income</option></select></label>
      <label className="cost-center"><span>Cost center</span><select value={draft.costCenterId} onChange={(event) => update("costCenterId", event.target.value)} disabled={disabled}><option value="">Uncategorized</option>{costCenters.map((center) => <option key={center.id} value={center.id}>{center.path}</option>)}</select></label>
      <label className="note"><span>Note</span><input value={draft.note} onChange={(event) => update("note", event.target.value)} placeholder="Optional note" disabled={disabled} /></label>
    </div>

    {item.sourceEvidence && <details className="import-evidence"><summary>View source evidence</summary><pre>{item.sourceEvidence}</pre></details>}

    <div className="import-candidate-actions">
      {item.transactionId && <Link href="/transactions" className="import-inserted-link"><CheckCircle2 size={15} /> View saved transaction</Link>}
      <span />
      {dirty && <button className="button ghost small" disabled={disabled} onClick={() => { setDraft(candidateDraft(item.candidate)); setDirty(false); setLocalError(""); }}><RotateCcw size={15} /> Reset</button>}
      <button className="button secondary small reject" disabled={disabled || (item.reviewStatus === "rejected" && !dirty)} onClick={() => void act("rejected")}><X size={15} /> Reject</button>
      {dirty && <button className="button secondary small" disabled={disabled} onClick={() => void act("pending")}><PencilLine size={15} /> Save edit</button>}
      <button className="button primary small" disabled={disabled || (item.reviewStatus === "approved" && !dirty)} onClick={() => void act("approved")}><Check size={15} /> Approve</button>
    </div>
  </article>;
}

function BatchList({
  batches,
  selectedId,
  loading,
  onSelect,
  onRefresh,
}: {
  batches: ImportBatch[];
  selectedId: string;
  loading: boolean;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  return <aside className="panel import-batches">
    <div className="import-batches-head"><div><h2>Import history</h2><span>{batches.length} batch{batches.length === 1 ? "" : "es"}</span></div><button className="icon-button" onClick={onRefresh} disabled={loading} aria-label="Refresh imports"><RefreshCw size={16} className={loading ? "spin" : ""} /></button></div>
    <div className="import-batch-list">
      {batches.map((batch) => <button key={batch.id} className={selectedId === batch.id ? "selected" : ""} onClick={() => onSelect(batch.id)}>
        <span className={`import-file-icon ${fileKind(batch.originalFilename, batch.mimeType)}`}><ImportFileIcon filename={batch.originalFilename} mimeType={batch.mimeType} /></span>
        <span className="import-batch-copy"><strong title={batch.originalFilename}>{batch.originalFilename}</strong><small>{formatDate(batch.createdAt)} · {batch.itemCount} item{batch.itemCount === 1 ? "" : "s"}</small><StatusPill status={batch.status} /></span>
        <ChevronRight size={16} />
      </button>)}
      {!loading && batches.length === 0 && <div className="import-list-empty"><FileText size={23} /><strong>No imports yet</strong><span>Your uploaded statements will appear here.</span></div>}
      {loading && batches.length === 0 && <div className="import-list-empty"><LoaderCircle className="spin" size={23} /><span>Loading imports…</span></div>}
    </div>
  </aside>;
}

function BatchDetail({
  detail,
  loading,
  actionError,
  busyItemIds,
  approving,
  costCenters,
  onItemAction,
  onApproveBatch,
  onPageChange,
  onRetry,
  onOpenOriginal,
  statementTimezone,
  onStatementTimezoneChange,
}: {
  detail: ImportDetail | null;
  loading: boolean;
  actionError: string;
  busyItemIds: Set<string>;
  approving: boolean;
  costCenters: Array<CostCenter & { path: string }>;
  onItemAction: (itemId: string, reviewStatus: string, candidate: TransactionCandidate) => Promise<void>;
  onApproveBatch: () => Promise<void>;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  onOpenOriginal: ((page: number | null) => void) | null;
  statementTimezone: string;
  onStatementTimezoneChange: (timeZone: string) => void;
}) {
  if (loading && !detail) return <section className="panel import-detail-empty"><LoaderCircle className="spin" size={28} /><strong>Loading import…</strong></section>;
  if (!detail) return <section className="panel import-detail-empty"><UploadCloud size={31} /><strong>Select an import</strong><span>Choose a batch to inspect its status and review candidates.</span></section>;

  const { batch, document, items, events, counts, pagination } = detail;
  const status = batch.status;
  const processing = PROCESSING_STATUSES.has(status);
  const failed = FAILED_STATUSES.has(status);
  const completed = COMPLETED_STATUSES.has(status);
  const { total, approved, rejected, pending: unresolved } = counts;
  const stageOrder = ["queued", "extracting", "converting", "validating", "awaiting_review"];
  const stageAliases: Record<string, string> = { uploaded: "queued", processing: "extracting", ready_for_review: "awaiting_review", review: "awaiting_review" };
  const currentStage = stageAliases[status] || status;
  const stageIndex = stageOrder.indexOf(currentStage);
  const canInsert = !completed && !processing && !failed && total > 0 && unresolved === 0 && !!detail.reviewRevision;

  return <section className="panel import-detail">
    <div className="import-detail-head">
      <div className={`import-file-icon large ${fileKind(batch.originalFilename, batch.mimeType)}`}><ImportFileIcon filename={batch.originalFilename} mimeType={batch.mimeType} size={22} /></div>
      <div className="import-detail-title"><h2>{batch.originalFilename}</h2><p>{batch.accountName || "Financial account"} · {formatBytes(document?.byteSize || batch.byteSize)}{document?.pageCount ? ` · ${document.pageCount} pages` : ""} · uploaded {formatDate(batch.createdAt, true)} · statement timezone {completed ? batch.statementTimezone : statementTimezone}</p></div>
      {document && onOpenOriginal && <button className="button secondary small import-original-link" onClick={() => onOpenOriginal(null)}><ExternalLink size={14} /> Open original</button>}
      <StatusPill status={status} />
    </div>

    {processing && <div className="import-processing">
      <div className="import-processing-copy"><LoaderCircle className="spin" size={20} /><div><strong>{statusLabel(status)} your statement</strong><span>You can leave this page. The worker will continue locally in the background.</span></div></div>
      <div className="import-stage-track">{stageOrder.map((stage, index) => <div key={stage} className={index < stageIndex ? "done" : index === stageIndex ? "active" : ""}><i>{index < stageIndex ? <Check size={12} /> : index + 1}</i><span>{statusLabel(stage)}</span></div>)}</div>
    </div>}

    {failed && <div className="import-failed"><XCircle size={21} /><div><strong>Import failed</strong><span>{batch.errorMessage || "The worker could not process this file. Check the worker logs for more detail."}</span></div><button className="button secondary small" onClick={onRetry}><RotateCcw size={15} /> Retry import</button></div>}
    {actionError && <div className="import-action-error"><AlertCircle size={17} /><span>{actionError}</span></div>}
    {!!document?.extractionWarnings.length && <div className="import-extraction-warnings"><AlertCircle size={17} /><div><strong>Extraction needs attention</strong>{document.extractionWarnings.map((warning, index) => <span key={`${warning}-${index}`}>{warning}</span>)}</div></div>}

    {!processing && !failed && <>
      <div className="import-review-summary">
        <div><small>Candidates</small><strong>{total}</strong></div>
        <div className="approved"><small>Approved</small><strong>{approved}</strong></div>
        <div className="rejected"><small>Rejected</small><strong>{rejected}</strong></div>
        <div className="unresolved"><small>Needs review</small><strong>{unresolved}</strong></div>
      </div>

      {total > 0 ? <div className="import-candidates">
        <div className="import-candidates-heading"><div><h3>{completed ? "Imported transactions" : "Review candidates"}</h3><p>{completed ? "These candidates were committed to your ledger with their source provenance." : "Check every value against its source, then approve or reject it."}</p></div>{document?.sha256 && <span title={document.sha256}>SHA-256 · {document.sha256.slice(0, 10)}…</span>}</div>
        <div className="import-candidate-scroll">{items.map((item) => <CandidateEditor key={item.id} item={item} onOpenOriginal={document ? onOpenOriginal : null} costCenters={costCenters} disabled={completed || loading || busyItemIds.has(item.id)} onAction={(reviewStatus, candidate) => onItemAction(item.id, reviewStatus, candidate)} />)}</div>
        {pagination.totalPages > 1 && <nav className="import-pagination" aria-label="Candidate pages">
          <span>Showing {(pagination.page - 1) * pagination.pageSize + 1}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}</span>
          <div><button className="button secondary small" disabled={loading || pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)}><ChevronLeft size={15} /> Previous</button><strong>Page {pagination.page} of {pagination.totalPages}</strong><button className="button secondary small" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => onPageChange(pagination.page + 1)}>Next <ChevronRight size={15} /></button></div>
        </nav>}
      </div> : <div className="import-no-candidates"><FileText size={26} /><strong>No transaction candidates</strong><span>The extractor did not find any rows in this document.</span></div>}

      {!completed && total > 0 && <div className="import-approval-bar">
        <div>{unresolved > 0 ? <><Clock3 size={18} /><span><strong>{unresolved} candidate{unresolved === 1 ? "" : "s"} still need a decision</strong><small>Approve or reject every row before finishing the batch.</small></span></> : <><CheckCircle2 size={18} /><span><strong>Review complete</strong><small>{approved ? `${approved} approved candidate${approved === 1 ? "" : "s"} will be inserted; ` : "No transactions will be inserted; "}{rejected} will be kept only in the audit trail.</small></span></>}</div>
        <label className="import-timezone-select"><span>Statement timezone<small>Dates are saved as 12:00 in this timezone, stored in UTC.</small></span><TimeZoneSelect value={statementTimezone} onChange={onStatementTimezoneChange} disabled={approving} /></label>
        <button className="button primary" disabled={!canInsert || approving} onClick={() => void onApproveBatch()}>{approving ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />} {approved ? `Insert ${approved} transaction${approved === 1 ? "" : "s"}` : "Finish review"}</button>
      </div>}

      {completed && <div className="import-completed"><CheckCircle2 size={19} /><div><strong>Import completed</strong><span>{approved || batch.approvedCount} transaction{(approved || batch.approvedCount) === 1 ? "" : "s"} saved to the ledger.</span></div><Link href="/transactions" className="button secondary small">View transactions <ChevronRight size={15} /></Link></div>}
    </>}

    {events.length > 0 && <details className="import-events"><summary>Processing history · {events.length} event{events.length === 1 ? "" : "s"}</summary><div>{events.map((event) => <div key={event.id}><i /><span><strong>{event.message}</strong><small>{formatDate(event.createdAt, true)}</small></span></div>)}</div></details>}
  </section>;
}

export function ImportsWorkspace() {
  const { accounts, costCenters, preferences, loading: accountsLoading, error: financeError, reload: reloadFinance } = useFinanceData();
  const { workspaceId, workspaceFetch } = useWorkspace();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [limits, setLimits] = useState<ImportLimits>(DEFAULT_LIMITS);
  const [remoteModelEnabled, setRemoteModelEnabled] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [reviewPage, setReviewPage] = useState(1);
  const [detail, setDetail] = useState<ImportDetail | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(true);
  const [actionError, setActionError] = useState("");
  const [busyItemIds, setBusyItemIds] = useState<Set<string>>(() => new Set());
  const [approving, setApproving] = useState(false);
  const [uploadTimezoneChoice, setUploadTimezoneChoice] = useState("");
  const [approvalTimezones, setApprovalTimezones] = useState<Record<string, string>>({});
  const uploadTimezone = uploadTimezoneChoice || preferences.timezone;
  const selectedBatch = detail?.batch.id === selectedId ? detail.batch : null;
  const approvalTimezone = (selectedId && approvalTimezones[selectedId]) || selectedBatch?.statementTimezone || uploadTimezone;
  const selectedAccountId = accountId && accounts.some((account) => account.id === accountId) ? accountId : accounts[0]?.id || "";
  const activeAccount = useMemo(() => accounts.find((account) => account.id === selectedAccountId), [accounts, selectedAccountId]);
  const importCostCenters = useMemo(() => flattenCostCenters(costCenters), [costCenters]);

  useEffect(() => {
    let stored = "";
    try { stored = localStorage.getItem(STATEMENT_TIMEZONE_KEY) ?? ""; } catch { stored = ""; }
    if (!isValidTimeZone(stored)) return;
    const frame = window.requestAnimationFrame(() => setUploadTimezoneChoice(stored));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const chooseUploadTimezone = (timeZone: string) => {
    setUploadTimezoneChoice(timeZone);
    try { localStorage.setItem(STATEMENT_TIMEZONE_KEY, timeZone); } catch { /* remembering the choice is optional */ }
  };

  const loadBatches = useCallback(async () => {
    setListLoading(true);
    try {
      const next = await fetchBatches(workspaceFetch);
      setBatches(next.batches);
      setLimits(next.limits);
      setRemoteModelEnabled(next.remoteModelEnabled);
      setSelectedId((current) => current || next.batches[0]?.id || "");
      setActionError("");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not load imports.");
    } finally {
      setListLoading(false);
    }
  }, [workspaceFetch]);

  const getDetail = useCallback(async (id: string, page: number) => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(REVIEW_PAGE_SIZE) });
    const response = await workspaceFetch(`/api/imports/${encodeURIComponent(id)}?${params}`, { cache: "no-store" });
    const body = await responseBody(response);
    if (!response.ok) throw new Error(errorFromBody(body, "Could not load this import."));
    const next = normalizeDetail(body);
    if (!next) throw new Error("The import response was incomplete.");
    return next;
  }, [workspaceFetch]);

  const acceptDetail = useCallback((next: ImportDetail) => {
    setDetail(next);
    setReviewPage(next.pagination.page);
    setBatches((current) => {
      const exists = current.some((batch) => batch.id === next.batch.id);
      const merged = exists ? current.map((batch) => batch.id === next.batch.id ? next.batch : batch) : [next.batch, ...current];
      return merged.sort((a, b) => new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf());
    });
  }, []);

  const refreshDetail = useCallback(async (id = selectedId, page = reviewPage) => {
    if (!id) return;
    const next = await getDetail(id, page);
    acceptDetail(next);
  }, [acceptDetail, getDetail, reviewPage, selectedId]);

  useEffect(() => {
    let active = true;
    fetchBatches(workspaceFetch)
      .then((next) => {
        if (!active) return;
        setBatches(next.batches);
        setLimits(next.limits);
        setRemoteModelEnabled(next.remoteModelEnabled);
        setSelectedId((current) => current || next.batches[0]?.id || "");
        setActionError("");
      })
      .catch((caught) => { if (active) setActionError(caught instanceof Error ? caught.message : "Could not load imports."); })
      .finally(() => { if (active) setListLoading(false); });
    return () => { active = false; };
  }, [workspaceFetch]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    getDetail(selectedId, reviewPage)
      .then((next) => { if (active) acceptDetail(next); })
      .catch((caught) => { if (active) setActionError(caught instanceof Error ? caught.message : "Could not load this import."); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [acceptDetail, getDetail, reviewPage, selectedId]);

  const selectedStatus = detail?.batch.id === selectedId ? detail.batch.status : "";
  useEffect(() => {
    if (!selectedId || !PROCESSING_STATUSES.has(selectedStatus)) return;
    let active = true;
    const interval = window.setInterval(() => {
      getDetail(selectedId, reviewPage)
        .then((next) => { if (active) { acceptDetail(next); setActionError(""); } })
        .catch((caught) => { if (active) setActionError(caught instanceof Error ? caught.message : "Could not refresh this import."); });
    }, 2200);
    return () => { active = false; window.clearInterval(interval); };
  }, [acceptDetail, getDetail, reviewPage, selectedId, selectedStatus]);

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    const error = validateFile(file, limits);
    if (error) { setPendingFile(null); setUploadError(error); return; }
    setPendingFile(file);
    setUploadError("");
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!uploading) chooseFile(event.dataTransfer.files[0]);
  };

  const dropKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInputRef.current?.click(); }
  };

  const upload = () => {
    if (!pendingFile || !selectedAccountId || uploading || !workspaceId) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadError("");

    const request = new XMLHttpRequest();
    request.open("POST", "/api/imports");
    request.setRequestHeader("Content-Type", pendingFile.type || "application/octet-stream");
    request.setRequestHeader("X-File-Name", encodeURIComponent(pendingFile.name));
    request.setRequestHeader("X-Account-Id", selectedAccountId);
    request.setRequestHeader("X-Statement-Timezone", uploadTimezone);
    request.setRequestHeader("X-Orbit-Workspace-Id", workspaceId);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => {
      setUploadError("The upload could not reach the local server.");
      setUploading(false);
    };
    request.onload = () => {
      let body: unknown = null;
      try { body = request.responseText ? JSON.parse(request.responseText) : null; } catch { body = null; }
      if (request.status < 200 || request.status >= 300) {
        setUploadError(errorFromBody(body, "The file could not be uploaded."));
        setUploading(false);
        return;
      }
      const batch = isRecord(body) ? normalizeBatch(body.batch) : null;
      if (!batch) {
        setUploadError("The server accepted the file but did not return an import batch.");
        setUploading(false);
        return;
      }
      setUploadProgress(100);
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setBatches((current) => [batch, ...current.filter((item) => item.id !== batch.id)]);
      setDetailLoading(true);
      setReviewPage(1);
      setSelectedId(batch.id);
      setUploading(false);
      void loadBatches();
    };
    request.send(pendingFile);
  };

  const updateItem = async (itemId: string, reviewStatus: string, candidate: TransactionCandidate) => {
    if (!selectedId) return;
    const reviewRevision = detail?.batch.id === selectedId ? detail.reviewRevision : "";
    if (!reviewRevision) throw new Error("Refresh this import before reviewing candidates.");
    const priorStatus = detail?.batch.id === selectedId
      ? detail.items.find((item) => item.id === itemId)?.reviewStatus
      : undefined;
    setBusyItemIds((current) => new Set(current).add(itemId));
    setActionError("");
    try {
      const response = await workspaceFetch(`/api/imports/${encodeURIComponent(selectedId)}/items/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewStatus, candidate, reviewRevision }),
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(errorFromBody(body, "Could not update this candidate."));
      const presented = isRecord(body) ? normalizeItem(body.item) : null;
      const responseRevision = isRecord(body) ? asString(body.reviewRevision ?? body.review_revision) : "";
      if (!presented || !responseRevision) throw new Error("The update response was incomplete. Refresh this import before continuing.");
      setDetail((current) => {
        if (!current || current.batch.id !== selectedId) return current;
        const previous = current.items.find((item) => item.id === itemId);
        if (!previous) return current;
        const counts = { ...current.counts };
        const decrement = previous.reviewStatus === "approved" ? "approved" : previous.reviewStatus === "rejected" ? "rejected" : "pending";
        const increment = presented.reviewStatus === "approved" ? "approved" : presented.reviewStatus === "rejected" ? "rejected" : "pending";
        counts[decrement] = Math.max(0, counts[decrement] - 1);
        counts[increment] += 1;
        return {
          ...current,
          batch: { ...current.batch, approvedCount: counts.approved },
          items: current.items.map((item) => item.id === itemId ? presented : item),
          counts,
          reviewRevision: responseRevision,
        };
      });
      const approvedDelta = (presented.reviewStatus === "approved" ? 1 : 0) - (priorStatus === "approved" ? 1 : 0);
      setBatches((current) => current.map((batch) => batch.id === selectedId
        ? { ...batch, approvedCount: Math.max(0, batch.approvedCount + approvedDelta) }
        : batch));
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not update this candidate.");
      throw caught;
    } finally {
      setBusyItemIds((current) => { const next = new Set(current); next.delete(itemId); return next; });
    }
  };

  const approveBatch = async () => {
    const reviewRevision = detail?.batch.id === selectedId ? detail.reviewRevision : "";
    if (!selectedId || !reviewRevision || approving) return;
    setApproving(true);
    setActionError("");
    try {
      const response = await workspaceFetch(`/api/imports/${encodeURIComponent(selectedId)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewRevision, statementTimezone: approvalTimezone }),
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(errorFromBody(body, "Could not insert this import."));
      await Promise.all([refreshDetail(selectedId), loadBatches(), reloadFinance()]);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not insert this import.");
      await refreshDetail(selectedId).catch(() => undefined);
    } finally {
      setApproving(false);
    }
  };

  const retryBatch = async () => {
    if (!selectedId) return;
    setDetailLoading(true);
    setActionError("");
    try {
      const response = await workspaceFetch(`/api/imports/${encodeURIComponent(selectedId)}/retry`, { method: "POST" });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(errorFromBody(body, "Could not retry this import."));
      await Promise.all([refreshDetail(selectedId), loadBatches()]);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not retry this import.");
    } finally {
      setDetailLoading(false);
    }
  };

  const openOriginal = useCallback(async (page: number | null) => {
    if (!selectedId) return;
    const response = await workspaceFetch(`/api/imports/${encodeURIComponent(selectedId)}/document`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not open the original document.");
    const url = URL.createObjectURL(await response.blob());
    window.open(page ? `${url}#page=${page}` : url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [selectedId, workspaceFetch]);

  const selectBatch = (id: string) => {
    setDetailLoading(true);
    setActionError("");
    setReviewPage(1);
    setSelectedId(id);
  };

  const selectReviewPage = (page: number) => {
    if (!selectedId || page === reviewPage || page < 1) return;
    setDetailLoading(true);
    setActionError("");
    setReviewPage(page);
  };

  return <div className="page imports-page">
    <div className="page-heading"><div><div className="eyebrow">Document intake</div><h1>Imports</h1><p>Turn statements into reviewable transaction drafts.</p></div></div>

    {financeError && <div className="data-error"><strong>Could not connect to PostgreSQL.</strong><span>{financeError}</span><code>docker compose up -d</code></div>}

    <section className="panel import-uploader">
      <div className="import-uploader-copy"><span><UploadCloud size={22} /></span><div><h2>Import a statement</h2><p>PDFs are inspected locally. Scanned pages and images are converted into reviewable transaction candidates.</p></div></div>
      <div className="import-upload-controls">
        <label className="import-account-select"><span>Destination account</span><select value={selectedAccountId} onChange={(event) => setAccountId(event.target.value)} disabled={accountsLoading || uploading || !accounts.length}><option value="" disabled>{accountsLoading ? "Loading accounts…" : "Select an account"}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label>
        <label className="import-account-select"><span>Statement timezone</span><TimeZoneSelect value={uploadTimezone} onChange={chooseUploadTimezone} disabled={uploading} /><small className="import-field-hint">The timezone the statement&apos;s dates are written in. Transactions are stored in UTC.</small></label>
        <div className={`import-dropzone ${dragging ? "dragging" : ""} ${pendingFile ? "has-file" : ""} ${!accounts.length ? "disabled" : ""}`} role="button" tabIndex={accounts.length && !uploading ? 0 : -1} onKeyDown={dropKey} onClick={() => { if (accounts.length && !uploading) fileInputRef.current?.click(); }} onDragEnter={(event) => { event.preventDefault(); if (!uploading) setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={drop}>
          <input ref={fileInputRef} type="file" accept=".pdf,.csv,.jpg,.jpeg,.png,.webp,application/pdf,text/csv,image/jpeg,image/png,image/webp" onChange={(event) => chooseFile(event.target.files?.[0])} disabled={!accounts.length || uploading} />
          {pendingFile ? <><span className={`import-file-icon ${fileKind(pendingFile.name, pendingFile.type)}`}><ImportFileIcon filename={pendingFile.name} mimeType={pendingFile.type} size={21} /></span><div><strong>{pendingFile.name}</strong><small>{formatBytes(pendingFile.size)} · ready for {activeAccount?.name || "the selected account"}</small></div><button onClick={(event) => { event.stopPropagation(); setPendingFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} aria-label="Remove selected file"><X size={16} /></button></> : <><UploadCloud size={23} /><div><strong>Drop a statement here, or choose a file</strong><small>PDF up to {formatBytes(limits.pdfBytes)} / {limits.pdfPages} pages · CSV up to {formatBytes(limits.csvBytes)} · image up to {formatBytes(limits.imageBytes)}</small></div></>}
        </div>
        {uploading && <div className="import-upload-progress"><span style={{ width: `${uploadProgress}%` }} /><small>{uploadProgress}% uploaded</small></div>}
        {remoteModelEnabled && <div className="import-remote-notice"><AlertCircle size={15} />This configuration sends statement contents to an external AI provider for conversion.</div>}
        {uploadError && <div className="import-upload-error"><AlertCircle size={15} />{uploadError}</div>}
        {!accountsLoading && !accounts.length && <div className="import-upload-error"><AlertCircle size={15} />Add a financial account before importing a statement. <Link href="/accounts">Go to accounts</Link></div>}
        <button className="button primary import-upload-button" disabled={!pendingFile || !selectedAccountId || uploading} onClick={upload}>{uploading ? <LoaderCircle className="spin" size={17} /> : <UploadCloud size={17} />} {uploading ? "Uploading…" : "Upload and process"}</button>
      </div>
    </section>

    <div className="imports-layout">
      <BatchList batches={batches} selectedId={selectedId} loading={listLoading} onSelect={selectBatch} onRefresh={() => { void loadBatches(); if (selectedId) void refreshDetail(selectedId); }} />
      <BatchDetail detail={detail?.batch.id === selectedId ? detail : null} loading={!!selectedId && detailLoading} actionError={actionError} busyItemIds={busyItemIds} approving={approving} costCenters={importCostCenters} onItemAction={updateItem} onApproveBatch={approveBatch} onPageChange={selectReviewPage} onRetry={() => void retryBatch()} statementTimezone={approvalTimezone} onStatementTimezoneChange={(timeZone) => { if (selectedId) setApprovalTimezones((current) => ({ ...current, [selectedId]: timeZone })); }} onOpenOriginal={(page) => { void openOriginal(page).catch((caught) => setActionError(caught instanceof Error ? caught.message : "Could not open the original document.")); }} />
    </div>
  </div>;
}
