// Date range filters. A selection is either a named preset or a custom pair of calendar dates; it is resolved
// against "today" in the workspace timezone into an inclusive range of calendar dates (YYYY-MM-DD).

import { addDays, isIsoDate, todayInZone, zonedDateToUtc } from "@/lib/time";

export const DATE_RANGE_PRESETS = ["today", "yesterday", "this-week", "last-week", "this-month", "last-month", "this-year", "last-year", "custom"] as const;

export type DateRangePreset = typeof DATE_RANGE_PRESETS[number];
export type DateRangeSelection = { preset: DateRangePreset; from?: string; to?: string };
/** Inclusive calendar dates in the workspace timezone. */
export type DateRange = { from: string; to: string };

export const DEFAULT_DATE_RANGE: DateRangeSelection = { preset: "last-month" };

export const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "this-week": "This week",
  "last-week": "Last week",
  "this-month": "This month",
  "last-month": "Last month",
  "this-year": "This year",
  "last-year": "Last year",
  custom: "Custom range",
};

const MAX_RANGE_DAYS = 366 * 20;
const DAY_MS = 86_400_000;

export function isDateRangePreset(value: unknown): value is DateRangePreset {
  return typeof value === "string" && (DATE_RANGE_PRESETS as readonly string[]).includes(value);
}

/** Number of calendar days in an inclusive range. */
export function daysInRange(range: DateRange) {
  return Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** Days since Monday, so weeks run Monday to Sunday. */
function weekdayFromMonday(ymd: string) {
  return (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function monthStart(ymd: string, offset = 0) {
  const [year, month] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 10);
}

function customRange(from: unknown, to: unknown): DateRange {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new Error("Invalid date range.");
  const range = { from, to };
  if (daysInRange(range) > MAX_RANGE_DAYS) throw new Error("Invalid date range: choose twenty years or less.");
  return range;
}

export function resolveDateRange(selection: DateRangeSelection, timeZone: string, now = new Date()): DateRange {
  const today = todayInZone(timeZone, now);
  const year = Number(today.slice(0, 4));
  switch (selection.preset) {
    case "today": return { from: today, to: today };
    case "yesterday": { const day = addDays(today, -1); return { from: day, to: day }; }
    case "this-week": { const start = addDays(today, -weekdayFromMonday(today)); return { from: start, to: addDays(start, 6) }; }
    case "last-week": { const start = addDays(today, -weekdayFromMonday(today) - 7); return { from: start, to: addDays(start, 6) }; }
    case "this-month": return { from: monthStart(today), to: addDays(monthStart(today, 1), -1) };
    case "last-month": return { from: monthStart(today, -1), to: addDays(monthStart(today), -1) };
    case "this-year": return { from: `${year}-01-01`, to: `${year}-12-31` };
    case "last-year": return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    case "custom": return customRange(selection.from, selection.to);
    default: throw new Error("Invalid date range.");
  }
}

/** UTC instants bounding a range as a half-open interval: start <= occurredAt < end. */
export function dateRangeBounds(range: DateRange, timeZone: string) {
  return { start: zonedDateToUtc(range.from, timeZone, "00:00"), end: zonedDateToUtc(addDays(range.to, 1), timeZone, "00:00") };
}

export function dateRangeParams(selection: DateRangeSelection): Record<string, string> {
  return selection.preset === "custom" ? { range: "custom", from: selection.from ?? "", to: selection.to ?? "" } : { range: selection.preset };
}

export function parseDateRange(params: URLSearchParams): DateRangeSelection {
  const preset = params.get("range") ?? DEFAULT_DATE_RANGE.preset;
  if (!isDateRangePreset(preset)) throw new Error("Invalid date range.");
  if (preset !== "custom") return { preset };
  const range = customRange(params.get("from"), params.get("to"));
  return { preset, ...range };
}

export function formatDateRange(range: DateRange, locale = "en-US") {
  const from = new Date(`${range.from}T12:00:00Z`);
  const to = new Date(`${range.to}T12:00:00Z`);
  const format = (tag: string) => {
    const formatter = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeZone: "UTC" });
    return range.from === range.to ? formatter.format(from) : formatter.formatRange(from, to);
  };
  try { return format(locale); } catch { return format("en-US"); }
}
