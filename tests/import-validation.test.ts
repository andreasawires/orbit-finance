import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { getModelProviderConfig, importConfig } from "@/lib/imports/config";
import { modelTransactionsSchema, reviewTransactionCandidateSchema, transactionCandidateSchema, type TransactionCandidate } from "@/lib/imports/contracts";
import { extractImport } from "@/lib/imports/extract";
import { detectFile } from "@/lib/imports/file-types";
import { modelGenerationSchema } from "@/lib/imports/model-schema";
import { convertWithModel } from "@/lib/imports/model";
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

test("review candidates accept an optional cost center id", () => {
  assert.equal(reviewTransactionCandidateSchema.safeParse({ ...candidate(), costCenterId: randomUUID() }).success, true);
  assert.equal(reviewTransactionCandidateSchema.safeParse({ ...candidate(), costCenterId: null }).success, true);
  assert.equal(reviewTransactionCandidateSchema.safeParse({ ...candidate(), costCenterId: "not-a-uuid" }).success, false);
});

test("model providers receive a structural schema while Zod retains semantic validation", () => {
  const generationSchema = modelGenerationSchema(modelTransactionsSchema);
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

test("remote model providers require an explicit acknowledgement", () => {
  const previous = {
    baseUrl: process.env.MODEL_BASE_URL,
    name: process.env.MODEL_NAME,
    allowRemote: process.env.MODEL_ALLOW_REMOTE,
  };
  process.env.MODEL_BASE_URL = "https://models.example/v1";
  process.env.MODEL_NAME = "test-vision";
  delete process.env.MODEL_ALLOW_REMOTE;
  try {
    assert.throws(() => getModelProviderConfig(), /MODEL_ALLOW_REMOTE=true/);
    process.env.MODEL_ALLOW_REMOTE = "true";
    assert.equal(getModelProviderConfig().isRemote, true);
  } finally {
    if (previous.baseUrl === undefined) delete process.env.MODEL_BASE_URL;
    else process.env.MODEL_BASE_URL = previous.baseUrl;
    if (previous.name === undefined) delete process.env.MODEL_NAME;
    else process.env.MODEL_NAME = previous.name;
    if (previous.allowRemote === undefined) delete process.env.MODEL_ALLOW_REMOTE;
    else process.env.MODEL_ALLOW_REMOTE = previous.allowRemote;
  }
});

test("model conversion sends Chat Completions JSON schema requests with image data", async () => {
  const previous = {
    baseUrl: process.env.MODEL_BASE_URL,
    apiKey: process.env.MODEL_API_KEY,
    name: process.env.MODEL_NAME,
    structuredOutput: process.env.MODEL_STRUCTURED_OUTPUT,
    allowRemote: process.env.MODEL_ALLOW_REMOTE,
  };
  const originalFetch = globalThis.fetch;
  const imagePath = path.join(importConfig.storagePath, `model-${randomUUID()}.png`);
  await mkdir(importConfig.storagePath, { recursive: true });
  await writeFile(imagePath, "image-data");
  process.env.MODEL_BASE_URL = "https://models.example/v1";
  process.env.MODEL_API_KEY = "test-key";
  process.env.MODEL_NAME = "test-vision";
  process.env.MODEL_STRUCTURED_OUTPUT = "json_schema";
  process.env.MODEL_ALLOW_REMOTE = "true";
  let request: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_url, init) => {
    request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        transactions: [{ ...candidate(), sourceEvidence: "Coffee -42.50" }],
        warnings: [],
      }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await convertWithModel({
      content: "Coffee -42.50",
      accountCurrency: "EUR",
      sourceLabel: "test image",
      imagePath,
    });
    assert.equal(result.transactions.length, 1);
    assert.equal((request?.model), "test-vision");
    assert.equal(((request?.response_format as { type?: string }).type), "json_schema");
    const messages = request?.messages as Array<Record<string, unknown>>;
    const userContent = messages[1].content as Array<Record<string, unknown>>;
    assert.match(String(((userContent[1].image_url as { url?: string }).url)), /^data:image\/png;base64,/);
  } finally {
    globalThis.fetch = originalFetch;
    await unlink(imagePath).catch(() => undefined);
    for (const [key, value] of Object.entries(previous)) {
      const name = `MODEL_${key === "baseUrl" ? "BASE_URL" : key === "apiKey" ? "API_KEY" : key === "name" ? "NAME" : key === "structuredOutput" ? "STRUCTURED_OUTPUT" : "ALLOW_REMOTE"}`;
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("model conversion falls back to JSON mode and does not retry timeouts inline", async () => {
  const previous = {
    baseUrl: process.env.MODEL_BASE_URL,
    apiKey: process.env.MODEL_API_KEY,
    name: process.env.MODEL_NAME,
    structuredOutput: process.env.MODEL_STRUCTURED_OUTPUT,
    allowRemote: process.env.MODEL_ALLOW_REMOTE,
  };
  const originalFetch = globalThis.fetch;
  process.env.MODEL_BASE_URL = "https://models.example/v1";
  process.env.MODEL_API_KEY = "";
  process.env.MODEL_NAME = "test-vision";
  process.env.MODEL_STRUCTURED_OUTPUT = "auto";
  process.env.MODEL_ALLOW_REMOTE = "true";
  const formats: string[] = [];
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { response_format: { type: string } };
    formats.push(body.response_format.type);
    if (formats.length === 1) {
      return new Response(JSON.stringify({ error: { message: "response_format json_schema is unsupported" } }), { status: 400 });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ transactions: [], warnings: [] }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await convertWithModel({ content: "No rows", accountCurrency: "EUR", sourceLabel: "test" });
    assert.deepEqual(formats, ["json_schema", "json_object"]);
    let timeoutCalls = 0;
    globalThis.fetch = (async () => {
      timeoutCalls += 1;
      throw new Error("The operation was aborted due to timeout");
    }) as typeof fetch;
    await assert.rejects(
      () => convertWithModel({ content: "No rows", accountCurrency: "EUR", sourceLabel: "test" }),
      /timed out after 300 seconds/i,
    );
    assert.equal(timeoutCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      const name = `MODEL_${key === "baseUrl" ? "BASE_URL" : key === "apiKey" ? "API_KEY" : key === "name" ? "NAME" : key === "structuredOutput" ? "STRUCTURED_OUTPUT" : "ALLOW_REMOTE"}`;
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
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
