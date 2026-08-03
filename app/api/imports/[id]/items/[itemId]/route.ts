import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { transactionCandidateSchema } from "@/lib/imports/contracts";
import { presentImportItem } from "@/lib/imports/presentation";
import {
  findImportedFingerprints,
  getImportWork,
  importBatchHasFingerprint,
  updateImportItemReview,
} from "@/lib/imports/repository";
import { candidateFingerprint, validateCandidate } from "@/lib/imports/validate";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; itemId: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reviewSchema = z.object({
  reviewStatus: z.enum(["pending", "approved", "rejected"]),
  candidate: z.unknown(),
  reviewRevision: z.string().regex(/^\d+$/),
}).strict();

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id, itemId } = await context.params;
    if (!uuid.test(id) || !uuid.test(itemId)) {
      return NextResponse.json({ error: "Invalid import item id." }, { status: 400 });
    }
    const work = await getImportWork(id);
    if (!work) return NextResponse.json({ error: "Import batch not found." }, { status: 404 });

    const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({
        error: parsed.error.issues.map((issue) => issue.message).join(" "),
      }, { status: 400 });
    }
    if (parsed.data.reviewStatus === "rejected") {
      const updated = await updateImportItemReview(id, itemId, {
        reviewStatus: "rejected",
        reviewedBy: "local-user",
      }, parsed.data.reviewRevision);
      return NextResponse.json({
        item: presentImportItem(updated.item, work.batch.sourceKind),
        reviewRevision: updated.reviewRevision,
      });
    } else {
      const candidate = transactionCandidateSchema.safeParse(parsed.data.candidate);
      if (!candidate.success) {
        return NextResponse.json({
          error: candidate.error.issues.map((issue) => issue.message).join(" "),
        }, { status: 422 });
      }
      const errors = validateCandidate(candidate.data, work.account.currency);
      if (errors.length) {
        return NextResponse.json({ error: errors.join(" ") }, { status: 422 });
      }
      const fingerprint = createHash("sha256")
        .update(candidateFingerprint(work.account.id, candidate.data))
        .digest("hex");
      const [importedFingerprints, duplicatesBatchItem] = await Promise.all([
        findImportedFingerprints(work.account.id, [fingerprint]),
        importBatchHasFingerprint(id, itemId, fingerprint),
      ]);
      const duplicateWarning = importedFingerprints.has(fingerprint) || duplicatesBatchItem
        ? ["Possible duplicate: the same date, amount, currency, and description were seen before."]
        : [];
      const updated = await updateImportItemReview(id, itemId, {
        occurredOn: candidate.data.occurredOn,
        description: candidate.data.description,
        note: candidate.data.note,
        amount: candidate.data.amount,
        currency: candidate.data.currency,
        transactionType: candidate.data.type,
        confidence: String(Math.round(candidate.data.confidence * 10_000) / 10_000),
        deduplicationFingerprint: fingerprint,
        validationStatus: duplicateWarning.length ? "needs_review" : "valid",
        validationErrors: [],
        validationWarnings: duplicateWarning,
        reviewStatus: parsed.data.reviewStatus,
        reviewedBy: "local-user",
      }, parsed.data.reviewRevision);
      return NextResponse.json({
        item: presentImportItem(updated.item, work.batch.sourceKind),
        reviewRevision: updated.reviewRevision,
      });
    }
  } catch (error) {
    console.error("Could not update import item", error);
    const message = error instanceof Error ? error.message : "Could not update import item.";
    const status = /not found/i.test(message) ? 404
      : /cannot be reviewed|can no longer|review changed/i.test(message) ? 409
        : /plain decimal|currency|\bdate\b|\bdescription\b|\bamount\b/i.test(message) ? 422 : 503;
    return NextResponse.json({ error: message }, { status });
  }
}
