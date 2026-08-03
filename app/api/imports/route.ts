import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/database";
import { importConfig } from "@/lib/imports/config";
import { acquireImportStorageReadLock } from "@/lib/imports/locks";
import { presentImportBatchSummary, presentImportDetail } from "@/lib/imports/presentation";
import { enqueueImport } from "@/lib/imports/queue";
import {
  createImportBatch,
  deleteUnreferencedImportDocument,
  getImportBatch,
  getImportBatchDetail,
  listImportBatches,
  listImportTransactionMappings,
  registerImportDocument,
  updateImportBatchStatus,
} from "@/lib/imports/repository";
import { deleteStoredFile, storeUpload, type StoredUpload } from "@/lib/imports/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeFilename(value: string | null) {
  if (!value) throw new Error("X-File-Name is required.");
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new Error("X-File-Name is invalid.");
  }
  const filename = decoded.replaceAll("\\", "/").split("/").at(-1)?.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!filename) throw new Error("X-File-Name is invalid.");
  return filename.slice(0, 255);
}

function statusForError(error: unknown) {
  const message = error instanceof Error ? error.message : "Import request failed.";
  if (/exceeds|too large/i.test(message)) return 413;
  if (/unsupported file/i.test(message)) return 415;
  if (/required|invalid|empty|account/i.test(message)) return 400;
  return 503;
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Import request failed.";
  console.error("Import API error", error);
  return NextResponse.json({ error: message }, { status: statusForError(error) });
}

export async function GET() {
  try {
    const batches = await listImportBatches();
    return NextResponse.json({
      batches: batches.map(presentImportBatchSummary),
      limits: {
        maxPdfBytes: importConfig.maxPdfBytes,
        maxCsvBytes: importConfig.maxCsvBytes,
        maxImageBytes: importConfig.maxImageBytes,
        maxPdfPages: importConfig.maxPdfPages,
      },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  let stored: StoredUpload | null = null;
  let storageWasRegistered = false;
  let registeredDocumentId: string | null = null;
  let batchWasRegistered = false;
  let releaseStorageGuard: (() => Promise<void>) | null = null;
  try {
    releaseStorageGuard = await acquireImportStorageReadLock();
    const accountId = request.headers.get("x-account-id")?.trim() ?? "";
    if (!uuid.test(accountId)) throw new Error("A valid destination account is required.");
    const account = await db.query<{ id: string; name: string; currency: string }>(
      "SELECT id, name, currency FROM accounts WHERE id = $1",
      [accountId],
    );
    if (!account.rowCount) throw new Error("The destination account does not exist.");
    const canonicalAccountId = String(account.rows[0].id);

    if (!request.body) throw new Error("The uploaded file is empty.");
    const contentLength = Number(request.headers.get("content-length"));
    const absoluteLimit = Math.max(importConfig.maxPdfBytes, importConfig.maxCsvBytes, importConfig.maxImageBytes);
    if (Number.isFinite(contentLength) && contentLength > absoluteLimit) {
      throw new Error(`File exceeds the ${absoluteLimit / 1024 / 1024} MiB upload limit.`);
    }

    const originalFilename = safeFilename(request.headers.get("x-file-name"));
    stored = await storeUpload(request.body, originalFilename, request.headers.get("content-type"));
    const registered = await registerImportDocument({
      sha256: stored.sha256,
      storageKey: stored.storageKey,
      originalFilename,
      mediaType: stored.detected.mimeType,
      sizeBytes: String(stored.byteSize),
      metadata: { detectedKind: stored.detected.kind },
    });
    storageWasRegistered = !registered.reused;
    registeredDocumentId = registered.document.id;
    if (registered.reused) await deleteStoredFile(stored.storageKey);

    const idempotencyKey = `document-account:${createHash("sha256")
      .update(`${registered.document.sha256}:${canonicalAccountId}`)
      .digest("hex")}`;
    let batch = await createImportBatch({
      documentId: registered.document.id,
      accountId: canonicalAccountId,
      sourceKind: stored.detected.kind,
      idempotencyKey,
      pipelineVersion: "1",
      parserName: stored.detected.kind === "pdf"
        ? "@firecrawl/pdf-inspector"
        : stored.detected.kind === "csv" ? "csv-parse" : "sharp",
      parserVersion: stored.detected.kind === "pdf" ? "1.11.2" : stored.detected.kind === "csv" ? "6.1.0" : "0.35.3",
      extractorName: "orbit-local-import-worker",
      extractorVersion: "1",
      modelName: importConfig.model,
      promptVersion: "transactions-v1",
      settings: {
        maxPdfPages: importConfig.maxPdfPages,
        maxCsvRows: importConfig.maxCsvRows,
        maxCsvColumns: importConfig.maxCsvColumns,
        maxImagePixels: importConfig.maxImagePixels,
        maxRenderedPixels: importConfig.maxRenderedPixels,
        modelContext: importConfig.modelContext,
      },
    });
    batchWasRegistered = true;

    if (batch.status === "cancelled") {
      return NextResponse.json({ error: "This exact document import was cancelled and cannot be queued again." }, { status: 409 });
    }
    if (["uploaded", "failed", "queued"].includes(batch.status)) {
      try {
        await enqueueImport(batch.id);
        const latest = await getImportBatch(batch.id);
        if (latest && (latest.status === "uploaded" || latest.status === "failed")) {
          try {
            batch = await updateImportBatchStatus(batch.id, "queued", {
              details: { reason: "upload" },
            });
          } catch {
            batch = await getImportBatch(batch.id) ?? batch;
          }
        } else if (latest) {
          batch = latest;
        }
      } catch (error) {
        throw error;
      }
    }

    const detail = await getImportBatchDetail(batch.id);
    if (!detail) throw new Error("The import batch could not be loaded after upload.");
    const mappings = await listImportTransactionMappings(batch.id, detail.items.map((item) => item.id));
    const response = presentImportDetail(detail, mappings);
    const processing = ["uploaded", "queued", "extracting", "converting", "validating"].includes(detail.batch.status);
    return NextResponse.json(response, { status: processing ? 202 : 200 });
  } catch (error) {
    if (stored && storageWasRegistered && registeredDocumentId && !batchWasRegistered) {
      const storageKey = await deleteUnreferencedImportDocument(registeredDocumentId).catch(() => null);
      if (storageKey) await deleteStoredFile(storageKey).catch(() => undefined);
    } else if (stored && !storageWasRegistered) {
      await deleteStoredFile(stored.storageKey).catch(() => undefined);
    }
    return failure(error);
  } finally {
    if (releaseStorageGuard) await releaseStorageGuard()
      .catch((unlockError) => console.error("Could not release import storage lock", unlockError));
  }
}
