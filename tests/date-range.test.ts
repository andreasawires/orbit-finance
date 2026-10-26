import assert from "node:assert/strict";
import test from "node:test";
import { dateRangeBounds, daysInRange, parseDateRange, resolveDateRange } from "@/lib/date-range";

// Wednesday 2026-10-21, 10:00 UTC.
const now = new Date("2026-10-21T10:00:00Z");

test("presets resolve to inclusive calendar ranges", () => {
  assert.deepEqual(resolveDateRange({ preset: "today" }, "UTC", now), { from: "2026-10-21", to: "2026-10-21" });
  assert.deepEqual(resolveDateRange({ preset: "yesterday" }, "UTC", now), { from: "2026-10-20", to: "2026-10-20" });
  assert.deepEqual(resolveDateRange({ preset: "this-week" }, "UTC", now), { from: "2026-10-19", to: "2026-10-25" });
  assert.deepEqual(resolveDateRange({ preset: "last-week" }, "UTC", now), { from: "2026-10-12", to: "2026-10-18" });
  assert.deepEqual(resolveDateRange({ preset: "this-month" }, "UTC", now), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(resolveDateRange({ preset: "last-month" }, "UTC", now), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(resolveDateRange({ preset: "this-year" }, "UTC", now), { from: "2026-01-01", to: "2026-12-31" });
  assert.deepEqual(resolveDateRange({ preset: "last-year" }, "UTC", now), { from: "2025-01-01", to: "2025-12-31" });
});

test("weeks start on Monday, including when today is Sunday or Monday", () => {
  const sunday = new Date("2026-10-25T10:00:00Z");
  assert.deepEqual(resolveDateRange({ preset: "this-week" }, "UTC", sunday), { from: "2026-10-19", to: "2026-10-25" });
  assert.deepEqual(resolveDateRange({ preset: "last-week" }, "UTC", sunday), { from: "2026-10-12", to: "2026-10-18" });
  const monday = new Date("2026-10-26T10:00:00Z");
  assert.deepEqual(resolveDateRange({ preset: "this-week" }, "UTC", monday), { from: "2026-10-26", to: "2026-11-01" });
});

test("last month crosses year boundaries and handles leap years", () => {
  assert.deepEqual(resolveDateRange({ preset: "last-month" }, "UTC", new Date("2026-01-15T12:00:00Z")), { from: "2025-12-01", to: "2025-12-31" });
  assert.deepEqual(resolveDateRange({ preset: "last-month" }, "UTC", new Date("2024-03-10T12:00:00Z")), { from: "2024-02-01", to: "2024-02-29" });
  assert.deepEqual(resolveDateRange({ preset: "last-week" }, "UTC", new Date("2026-01-01T12:00:00Z")), { from: "2025-12-22", to: "2025-12-28" });
});

test("today is taken in the workspace timezone", () => {
  // 23:30 UTC on Oct 21 is already Oct 22 in Kiritimati (UTC+14) and still Oct 21 in Los Angeles.
  const late = new Date("2026-10-21T23:30:00Z");
  assert.deepEqual(resolveDateRange({ preset: "today" }, "Pacific/Kiritimati", late), { from: "2026-10-22", to: "2026-10-22" });
  assert.deepEqual(resolveDateRange({ preset: "today" }, "America/Los_Angeles", late), { from: "2026-10-21", to: "2026-10-21" });
});

test("bounds are local midnights as a half-open UTC interval, across DST", () => {
  assert.deepEqual(dateRangeBounds({ from: "2024-10-01", to: "2024-10-31" }, "Europe/Rome"), { start: "2024-09-30T22:00:00.000Z", end: "2024-10-31T23:00:00.000Z" });
  assert.deepEqual(dateRangeBounds({ from: "2024-03-31", to: "2024-03-31" }, "Europe/Rome"), { start: "2024-03-30T23:00:00.000Z", end: "2024-03-31T22:00:00.000Z" });
  assert.deepEqual(dateRangeBounds({ from: "2026-10-21", to: "2026-10-21" }, "UTC"), { start: "2026-10-21T00:00:00.000Z", end: "2026-10-22T00:00:00.000Z" });
});

test("custom ranges are validated", () => {
  assert.deepEqual(parseDateRange(new URLSearchParams("range=custom&from=2026-01-05&to=2026-02-10")), { preset: "custom", from: "2026-01-05", to: "2026-02-10" });
  assert.deepEqual(parseDateRange(new URLSearchParams()), { preset: "last-month" });
  assert.throws(() => parseDateRange(new URLSearchParams("range=custom&from=2026-02-10&to=2026-01-05")), /Invalid date range/);
  assert.throws(() => parseDateRange(new URLSearchParams("range=custom&from=2026-02-30&to=2026-03-01")), /Invalid date range/);
  assert.throws(() => parseDateRange(new URLSearchParams("range=custom&from=1990-01-01&to=2026-01-01")), /Invalid date range/);
  assert.throws(() => parseDateRange(new URLSearchParams("range=forever")), /Invalid date range/);
  assert.equal(daysInRange({ from: "2024-02-01", to: "2024-02-29" }), 29);
});
