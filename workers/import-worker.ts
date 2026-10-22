import { createHash } from "node:crypto";
import type { Job } from "pg-boss";
import { db } from "@/lib/database";
import { importConfig } from "@/lib/imports/config";
import { IMPORT_QUEUE, type ImportJobData, transactionCandidateSchema } from "@/lib/imports/contracts";
import { extractImport } from "@/lib/imports/extract";
import { enqueueImport, getImportQueue } from "@/lib/imports/queue";
import {
  getImportBatch,
  getImportWork,
  findImportedFingerprints,
  listUnqueuedUploadBatchIds,
  replaceImportItems,
  updateImportBatchStatus,
  updateImportDocumentInspection,
} from "@/lib/imports/repository";
import type { ImportItemCandidate, ImportValidationStatus, JsonObject } from "@/lib/imports/types";
import { candidateFingerprint, validateCandidate } from "@/lib/imports/validate";

const validDate = /^\d{4}-\d{2}-\d{2}$/;
const validAmount = /^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/;
const visibleExtractionWarningLimit = 50;
const cancellationPollMs = 2_000;

function dateOrNull(value: string) {
  if (!validDate.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function decimalOrNull(value: string) {
  return validAmount.test(value) ? value : null;
}

function confidence(value: number) {
  return String(Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000);
}

function fingerprintDigest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function itemCandidate(
  ordinal: number,
  item: Awaited<ReturnType<typeof extractImport>>["candidates"][number],
  accountId: string,
  accountCurrency: string,
  statementTimezone: string,
): ImportItemCandidate {
  const errors = validateCandidate(item.candidate, accountCurrency, statementTimezone);
  const parsed = transactionCandidateSchema.safeParse(item.candidate);
  const validationStatus: ImportValidationStatus = errors.length
    ? "invalid"
    : item.candidate.confidence < 0.9 ? "needs_review" : "valid";
  const modelOutput = { candidate: item.candidate } as unknown as JsonObject;

  return {
    ordinal,
    validationStatus,
    sourcePage: item.sourcePage ?? null,
    sourceRow: item.sourceRow ?? null,
    sourceLocator: {
      kind: item.sourceKind,
      ...(item.sourcePage ? { page: item.sourcePage } : {}),
      ...(item.sourceRow ? { row: item.sourceRow } : {}),
    },
    sourceText: item.sourceEvidence,
    rawSource: {},
    modelOutput,
    occurredOn: dateOrNull(item.candidate.occurredOn),
    description: item.candidate.description.trim().slice(0, 500) || null,
    note: item.candidate.note.slice(0, 2_000),
    amount: decimalOrNull(item.candidate.amount),
    currency: /^[A-Z]{3}$/.test(item.candidate.currency) ? item.candidate.currency : null,
    transactionType: item.candidate.type === "Income" || item.candidate.type === "Expense"
      ? item.candidate.type
      : null,
    sourceSystem: "document-import",
    deduplicationFingerprint: parsed.success
      ? fingerprintDigest(candidateFingerprint(accountId, parsed.data))
      : null,
    confidence: Number.isFinite(item.candidate.confidence) ? confidence(item.candidate.confidence) : null,
    validationErrors: errors,
    validationWarnings: [],
  };
}

async function recoverBatch(workspaceId: string, batchId: string) {
  let batch = await getImportBatch(workspaceId, batchId);
  // Deleted batches can still have a queued retry; there is nothing left to process.
  if (!batch || ["awaiting_review", "completed", "cancelled"].includes(batch.status)) return null;

  if (["extracting", "converting", "validating"].includes(batch.status)) {
    batch = await updateImportBatchStatus(workspaceId, batchId, "failed", {
      actorType: "worker",
      errorCode: "INTERRUPTED_ATTEMPT",
      errorMessage: "A previous worker stopped before completing this import; processing was restarted.",
    });
  }
  if (batch.status === "uploaded" || batch.status === "failed") {
    batch = await updateImportBatchStatus(workspaceId, batchId, "queued", {
      actorType: "worker",
      details: { reason: "worker-attempt" },
    });
  }
  if (batch.status !== "queued") throw new Error(`Import batch cannot be processed while it is ${batch.status}.`);
  await updateImportBatchStatus(workspaceId, batchId, "extracting", { actorType: "worker" });
  return getImportWork(workspaceId, batchId);
}

async function processImport(job: Job<ImportJobData>) {
  const work = await recoverBatch(job.data.workspaceId, job.data.batchId);
  if (!work) {
    console.log(`[import] batch ${job.data.batchId}: already finished or removed, nothing to do`);
    return;
  }
  console.log(`[import] batch ${job.data.batchId}: extracting ${work.batch.sourceKind}`);
  if (job.signal.aborted) throw new Error("Import job was cancelled before extraction.");

  // Users cancel by changing the batch status; poll it so in-flight model calls stop promptly.
  const cancellation = new AbortController();
  const signal = AbortSignal.any([job.signal, cancellation.signal]);
  const cancellationWatch = setInterval(() => {
    void getImportBatch(job.data.workspaceId, work.batch.id)
      .then((batch) => { if (!batch || batch.status === "cancelled") cancellation.abort(); })
      .catch((error) => console.error("Could not check import cancellation", error));
  }, cancellationPollMs);

  try {
    let conversionStarted = false;
    const result = await extractImport({
      storageKey: work.document.storageKey,
      kind: work.batch.sourceKind,
      accountCurrency: work.account.currency,
      signal,
    }, async () => {
      if (conversionStarted) return;
      conversionStarted = true;
      await updateImportBatchStatus(job.data.workspaceId, work.batch.id, "converting", { actorType: "worker" });
    });
    if (signal.aborted) throw new Error("Import job was cancelled during extraction.");
    console.log(`[import] batch ${work.batch.id}: extracted ${result.candidates.length} candidates, ${result.warnings.length} warnings; validating`);

    const visibleWarnings = result.warnings.slice(0, visibleExtractionWarningLimit);
    if (result.warnings.length > visibleExtractionWarningLimit) {
      visibleWarnings.push(
        `${result.warnings.length - visibleExtractionWarningLimit} additional extraction warnings were summarized; review the paginated candidates against the original source.`,
      );
    }
    await updateImportDocumentInspection(job.data.workspaceId, work.document.id, {
      pageCount: result.pageCount,
      metadata: {
        extractionWarnings: visibleWarnings,
        extractionWarningCount: result.warnings.length,
        inspectedAt: new Date().toISOString(),
      },
    });
    await updateImportBatchStatus(job.data.workspaceId, work.batch.id, "validating", { actorType: "worker" });

    const candidates = result.candidates.map((item, index) => itemCandidate(
      index + 1,
      item,
      work.account.id,
      work.account.currency,
      work.batch.statementTimezone,
    ));
    const importedFingerprints = await findImportedFingerprints(
      job.data.workspaceId,
      work.account.id,
      candidates.flatMap((candidate) => candidate.deduplicationFingerprint ? [candidate.deduplicationFingerprint] : []),
    );
    const seenFingerprints = new Set<string>();
    for (const candidate of candidates) {
      const fingerprint = candidate.deduplicationFingerprint;
      if (!fingerprint) continue;
      if (importedFingerprints.has(fingerprint) || seenFingerprints.has(fingerprint)) {
        candidate.validationWarnings = [
          ...(candidate.validationWarnings ?? []),
          "Possible duplicate: the same date, amount, currency, and description were seen before.",
        ];
        if (candidate.validationStatus === "valid") candidate.validationStatus = "needs_review";
      }
      seenFingerprints.add(fingerprint);
    }
    await replaceImportItems(job.data.workspaceId, work.batch.id, candidates);
    await updateImportBatchStatus(job.data.workspaceId, work.batch.id, "awaiting_review", {
      actorType: "worker",
      details: {
        candidateCount: candidates.length,
        warningCount: result.warnings.length,
      },
    });
  } catch (error) {
    const current = await getImportBatch(job.data.workspaceId, work.batch.id).catch(() => null);
    // A user cancellation is a normal outcome, not a failure pg-boss should retry.
    if (cancellation.signal.aborted || current?.status === "cancelled") {
      console.log(`[import] batch ${work.batch.id}: cancelled, stopped processing`);
      return;
    }
    const message = error instanceof Error ? error.message : "Unknown import processing error.";
    if (current && !["failed", "completed", "cancelled"].includes(current.status)) {
      await updateImportBatchStatus(job.data.workspaceId, work.batch.id, "failed", {
        actorType: "worker",
        errorCode: "IMPORT_PROCESSING_FAILED",
        errorMessage: message.slice(0, 2_000),
      }).catch((transitionError) => console.error("Could not persist import failure", transitionError));
    }
    throw error;
  } finally {
    clearInterval(cancellationWatch);
  }
}

async function processImportWithLock(job: Job<ImportJobData>) {
  const client = await db.connect();
  let locked = false;
  try {
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      [job.data.batchId],
    );
    locked = result.rows[0]?.locked === true;
    if (!locked) {
      console.log(`[import] job ${job.id} batch ${job.data.batchId}: skipped, batch lock held by another worker`);
      return;
    }
    const startedAt = Date.now();
    console.log(`[import] job ${job.id} batch ${job.data.batchId}: started`);
    try {
      await processImport(job);
      console.log(`[import] job ${job.id} batch ${job.data.batchId}: finished in ${Date.now() - startedAt}ms`);
    } catch (error) {
      console.error(`[import] job ${job.id} batch ${job.data.batchId}: failed after ${Date.now() - startedAt}ms:`, error instanceof Error ? error.message : error);
      throw error;
    }
  } finally {
    if (locked) {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [job.data.batchId])
        .catch((error) => console.error("Could not release import batch lock", error));
    }
    client.release();
  }
}

async function main() {
  const boss = await getImportQueue();
  await boss.work<ImportJobData>(IMPORT_QUEUE, {
    batchSize: 1,
    heartbeatRefreshSeconds: 30,
    localConcurrency: importConfig.workerConcurrency,
    pollingIntervalSeconds: 1,
  }, async (jobs) => {
    for (const job of jobs) await processImportWithLock(job);
  });

  const recoverUploads = async () => {
    const batches = await listUnqueuedUploadBatchIds();
    await Promise.all(batches.map(({ batchId, workspaceId }) => enqueueImport(batchId, workspaceId)));
  };
  await recoverUploads();
  const recoveryInterval = setInterval(() => {
    void recoverUploads().catch((error) => console.error("Could not recover uploaded import batches", error));
  }, 60_000);
  recoveryInterval.unref();

  console.log(`Import worker ready (queue=${IMPORT_QUEUE}, concurrency=${importConfig.workerConcurrency}).`);
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    clearInterval(recoveryInterval);
    console.log(`Stopping import worker after ${signal}.`);
    await boss.stop({ graceful: true, timeout: 30_000 });
    await db.end();
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  await db.end().catch(() => undefined);
  process.exitCode = 1;
});
