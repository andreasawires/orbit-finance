import assert from "node:assert/strict";
import test from "node:test";
import { addDays, isIsoDate, isValidTimeZone, monthKeyInZone, requireUtcInstant, todayInZone, utcToZonedDate, zonedDateToUtc } from "@/lib/time";

test("calendar dates anchor at local noon and convert to UTC", () => {
  assert.equal(zonedDateToUtc("2024-01-15", "Europe/Rome"), "2024-01-15T11:00:00.000Z");
  assert.equal(zonedDateToUtc("2024-07-15", "Europe/Rome"), "2024-07-15T10:00:00.000Z");
  assert.equal(zonedDateToUtc("2024-07-15", "America/New_York"), "2024-07-15T16:00:00.000Z");
  assert.equal(zonedDateToUtc("2024-07-15", "UTC"), "2024-07-15T12:00:00.000Z");
  assert.equal(zonedDateToUtc("2024-03-15", "Asia/Tokyo"), "2024-03-15T03:00:00.000Z");
});

test("conversion handles DST transition days", () => {
  // Europe/Rome springs forward 2024-03-31 at 02:00 and falls back 2024-10-27 at 03:00.
  assert.equal(zonedDateToUtc("2024-03-31", "Europe/Rome"), "2024-03-31T10:00:00.000Z");
  assert.equal(zonedDateToUtc("2024-10-27", "Europe/Rome"), "2024-10-27T11:00:00.000Z");
  assert.equal(zonedDateToUtc("2024-03-10", "America/New_York"), "2024-03-10T16:00:00.000Z");
  assert.equal(zonedDateToUtc("2024-11-03", "America/New_York"), "2024-11-03T17:00:00.000Z");
  assert.equal(zonedDateToUtc("2024-03-31", "Europe/Rome", "00:00"), "2024-03-30T23:00:00.000Z");
});

test("noon anchor keeps the same calendar day across extreme zones", () => {
  for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Europe/Rome", "America/Los_Angeles", "Asia/Kolkata"]) {
    const instant = zonedDateToUtc("2024-02-29", zone);
    assert.equal(utcToZonedDate(instant, zone), "2024-02-29", zone);
  }
  const rome = zonedDateToUtc("2024-05-01", "Europe/Rome");
  assert.equal(utcToZonedDate(rome, "America/Los_Angeles"), "2024-05-01");
  assert.equal(utcToZonedDate(rome, "Asia/Tokyo"), "2024-05-01");
});

test("month keys and today follow the zone", () => {
  assert.equal(monthKeyInZone("2024-01-31T23:30:00Z", "Europe/Rome"), "2024-02");
  assert.equal(monthKeyInZone("2024-01-31T23:30:00Z", "UTC"), "2024-01");
  assert.equal(todayInZone("Asia/Tokyo", new Date("2024-06-30T20:00:00Z")), "2024-07-01");
  assert.equal(todayInZone("America/Los_Angeles", new Date("2024-07-01T03:00:00Z")), "2024-06-30");
});

test("validators", () => {
  assert.equal(isValidTimeZone("Europe/Rome"), true);
  assert.equal(isValidTimeZone("Mars/Olympus"), false);
  assert.equal(isValidTimeZone(""), false);
  assert.equal(isIsoDate("2024-02-29"), true);
  assert.equal(isIsoDate("2023-02-29"), false);
  assert.equal(addDays("2024-12-31", 1), "2025-01-01");
  assert.equal(requireUtcInstant("2024-07-15T12:00:00+02:00"), "2024-07-15T10:00:00.000Z");
  assert.throws(() => requireUtcInstant("2024-07-15"));
  assert.throws(() => requireUtcInstant("2024-07-15T12:00:00"));
});
