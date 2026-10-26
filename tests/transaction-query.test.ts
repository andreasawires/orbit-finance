import assert from "node:assert/strict";
import test from "node:test";
import { bucketStarts, DEFAULT_TRANSACTION_QUERY, parseReportQuery, parseTransactionQuery, resolveGranularity, transactionSearchParams } from "@/lib/transaction-query";

const account = "6f1c1d2e-8b7a-4c3d-9e0f-1a2b3c4d5e6f";

test("query params round-trip between client and server", () => {
  const query = { ...DEFAULT_TRANSACTION_QUERY, range: { preset: "custom" as const, from: "2026-01-01", to: "2026-03-31" }, q: "coffee", type: "Expense" as const, accountIds: [account], costCenterIds: ["uncategorized"], sort: "amount" as const, dir: "asc" as const, page: 3, pageSize: 50 };
  assert.deepEqual(parseTransactionQuery(transactionSearchParams(query)), query);
  assert.deepEqual(parseTransactionQuery(new URLSearchParams()), DEFAULT_TRANSACTION_QUERY);
});

test("invalid query params are rejected", () => {
  assert.throws(() => parseTransactionQuery(new URLSearchParams("sort=amount;drop")), /Invalid sort/);
  assert.throws(() => parseTransactionQuery(new URLSearchParams("dir=sideways")), /Invalid sort/);
  assert.throws(() => parseTransactionQuery(new URLSearchParams("page=0")), /Invalid page/);
  assert.throws(() => parseTransactionQuery(new URLSearchParams("pageSize=10000")), /Invalid page size/);
  assert.throws(() => parseTransactionQuery(new URLSearchParams("type=Refund")), /Invalid type filter/);
  assert.throws(() => parseTransactionQuery(new URLSearchParams("account=nope")), /Invalid account filter/);
  assert.throws(() => parseTransactionQuery(new URLSearchParams("costCenter=nope")), /Invalid cost center filter/);
});

test("buckets cover the range with Monday weeks and calendar months", () => {
  assert.deepEqual(bucketStarts({ from: "2026-10-01", to: "2026-10-03" }, "day"), ["2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.deepEqual(bucketStarts({ from: "2026-10-01", to: "2026-10-18" }, "week"), ["2026-09-28", "2026-10-05", "2026-10-12"]);
  assert.deepEqual(bucketStarts({ from: "2025-11-15", to: "2026-02-01" }, "month"), ["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
});

test("auto granularity follows the range length, and too many buckets are refused", () => {
  assert.equal(resolveGranularity({ from: "2026-09-01", to: "2026-09-30" }, "auto"), "day");
  assert.equal(resolveGranularity({ from: "2026-07-01", to: "2026-09-30" }, "auto"), "week");
  assert.equal(resolveGranularity({ from: "2026-01-01", to: "2026-12-31" }, "auto"), "month");
  assert.equal(resolveGranularity({ from: "2026-01-01", to: "2026-12-31" }, "day"), "day");
  assert.throws(() => resolveGranularity({ from: "2020-01-01", to: "2026-12-31" }, "day"), /Invalid granularity/);
  assert.throws(() => parseReportQuery(new URLSearchParams("granularity=hour")), /Invalid granularity/);
});
