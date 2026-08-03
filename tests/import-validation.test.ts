import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { importConfig } from "@/lib/imports/config";
import { modelTransactionsSchema, transactionCandidateSchema, type TransactionCandidate } from "@/lib/imports/contracts";
import { extractImport } from "@/lib/imports/extract";
import { detectFile } from "@/lib/imports/file-types";
import { ollamaGenerationSchema } from "@/lib/imports/ollama-schema";
import { candidateFingerprint, validateCandidate } from "@/lib/imports/validate";

const candidate = (overrides: Partial<TransactionCandidate> = {}): TransactionCandidate => ({
  occurredOn: "2025-03-14",
  description: "Local market",
  note: "",
  amount: "-42.50",
  currency: "EUR",
  type: "Expense",
  confidence: 0.95,
  ...overrides,
});

test("ledger amount contract accepts numeric(16,2) and rejects wider values", () => {
  assert.equal(transactionCandidateSchema.safeParse(candidate({ amount: "-99999999999999.99" })).success, true);
  assert.equal(transactionCandidateSchema.safeParse(candidate({ amount: "-100000000000000.00" })).success, false);
  assert.equal(transactionCandidateSchema.safeParse(candidate({ amount: "-1.001" })).success, false);
  assert.equal(transactionCandidateSchema.safeParse(candidate({ amount: "+1.00" })).success, false);
});

test("Ollama receives a structural schema while Zod retains semantic validation", () => {
  const generationSchema = ollamaGenerationSchema(modelTransactionsSchema);
  const serialized = JSON.stringify(generationSchema);
  for (const unsupported of ["pattern", "minLength", "maxLength", "minimum", "maximum"]) {
    assert.equal(serialized.includes(`\"${unsupported}\"`), false);
  }

  const properties = generationSchema.properties as Record<string, Record<string, unknown>>;
  assert.equal(properties.transactions.type, "array");
  const transaction = properties.transactions.items as {
    properties: Record<string, Record<string, unknown>>;
  };
  assert.deepEqual(transaction.properties.type.enum, ["Income", "Expense"]);

  assert.equal(modelTransactionsSchema.safeParse({
    transactions: [{
      ...candidate({ amount: "1.001", currency: "EURO" }),
      sourceEvidence: "row",
    }],
    warnings: [],
  }).success, false);
});

test("deterministic validation rejects zero, sign mismatches, and currency mismatches", () => {
  assert.deepEqual(validateCandidate(candidate(), "EUR"), []);
  assert.match(validateCandidate(candidate({ amount: "0", type: "Income" }), "EUR").join(" "), /non-zero/i);
  assert.match(validateCandidate(candidate({ amount: "42.50" }), "EUR").join(" "), /negative/i);
  assert.match(validateCandidate(candidate(), "USD").join(" "), /differs/i);
});

test("duplicate fingerprints canonicalize decimal scale and Unicode descriptions", () => {
  const first = candidateFingerprint("account", candidate({ amount: "-42.5", description: "Cafe\u0301  Central" }));
  const second = candidateFingerprint("account", candidate({ amount: "-42.50", description: "CAFÉ—CENTRAL" }));
  assert.equal(first, second);
});

test("file detection trusts magic bytes before the declared filename or MIME type", () => {
  const detected = detectFile(Buffer.from("%PDF-1.7\nbody"), "statement.csv", "text/csv");
  assert.equal(detected.kind, "pdf");
  assert.equal(detected.mimeType, "application/pdf");
});

test("CSV detection rejects binary data disguised as text", () => {
  assert.throws(
    () => detectFile(Buffer.from([0, 1, 2, 44, 5]), "statement.csv", "text/csv"),
    /Unsupported file/,
  );
});

test("CSV extraction retains malformed and ambiguous rows for review", async () => {
  const id = randomUUID();
  const prefix = id.slice(0, 2);
  const storageKey = `${prefix}/${id}.csv`;
  const directory = path.join(importConfig.storagePath, prefix);
  const filename = path.join(importConfig.storagePath, storageKey);
  await mkdir(directory, { recursive: true });
  await writeFile(filename, [
    "Date,Description,Amount,Currency",
    "01/02/2026,Coffee,-12.00,EUR",
    ",,not-money,EURO",
  ].join("\n"));
  try {
    const result = await extractImport({ storageKey, kind: "csv", accountCurrency: "EUR" });
    assert.equal(result.candidates.length, 2);
    assert.equal(result.candidates[1].candidate.amount, "0");
    assert.ok(result.warnings.some((warning) => /ambiguous/i.test(warning)));
    assert.ok(result.warnings.some((warning) => /not a readable non-zero amount/i.test(warning)));
  } finally {
    await unlink(filename).catch(() => undefined);
    await rmdir(directory).catch(() => undefined);
  }
});
