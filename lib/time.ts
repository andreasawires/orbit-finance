// Timezone helpers. The database and API only ever carry UTC instants (ISO strings ending in "Z");
// these helpers convert between those instants and calendar dates in a chosen IANA timezone.

export const DEFAULT_TIME_ZONE = "UTC";

/** Hour of the local day a bare calendar date is anchored to, so it stays on the same day for viewers within ±11h. */
export const DATE_ANCHOR_TIME = "12:00";

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const HM = /^(\d{2}):(\d{2})$/;

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(partsFormatter(timeZone).formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}

/** Offset of `timeZone` from UTC at `date`, in minutes (positive east of UTC). */
function offsetMinutes(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !timeZone.trim()) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone }); return true; } catch { return false; }
}

export function safeTimeZone(timeZone: unknown) {
  return isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = YMD.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

/** Converts a calendar date (and wall-clock time) in `timeZone` into a UTC ISO instant. */
export function zonedDateToUtc(ymd: string, timeZone: string, time = DATE_ANCHOR_TIME) {
  const date = YMD.exec(ymd);
  const clock = HM.exec(time);
  if (!date || !isIsoDate(ymd)) throw new Error(`Invalid date: ${ymd}`);
  if (!clock) throw new Error(`Invalid time: ${time}`);
  const zone = safeTimeZone(timeZone);
  const wallClock = Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]), Number(clock[1]), Number(clock[2]));
  // Two passes so the offset is the one in effect at the resulting instant (handles DST transitions).
  let instant = wallClock - offsetMinutes(new Date(wallClock), zone) * 60000;
  instant = wallClock - offsetMinutes(new Date(instant), zone) * 60000;
  return new Date(instant).toISOString();
}

/** Calendar date (YYYY-MM-DD) of a UTC instant as seen in `timeZone`. */
export function utcToZonedDate(iso: string, timeZone: string) {
  const p = zonedParts(new Date(iso), safeTimeZone(timeZone));
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

export function monthKeyInZone(iso: string, timeZone: string) {
  return utcToZonedDate(iso, timeZone).slice(0, 7);
}

export function todayInZone(timeZone: string, now = new Date()) {
  return utcToZonedDate(now.toISOString(), timeZone);
}

/** Adds whole days to a YYYY-MM-DD calendar date. */
export function addDays(ymd: string, days: number) {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatDate(iso: string, timeZone: string, locale = "en-US") {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try { return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: safeTimeZone(timeZone) }).format(date); }
  catch { return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: safeTimeZone(timeZone) }).format(date); }
}

export function formatMonth(monthKey: string, locale = "en-US") {
  const date = new Date(`${monthKey}-01T12:00:00Z`);
  try { return date.toLocaleString(locale, { month: "short", timeZone: "UTC" }); }
  catch { return date.toLocaleString("en-US", { month: "short", timeZone: "UTC" }); }
}

/** Requires an ISO-8601 instant with an explicit "Z" or offset and returns it normalized to UTC. */
export function requireUtcInstant(value: unknown, label = "Date") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`${label} must be an ISO timestamp with a timezone.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is invalid.`);
  return date.toISOString();
}

function offsetLabel(timeZone: string, now: Date) {
  const minutes = offsetMinutes(now, timeZone);
  if (!minutes) return "GMT";
  const sign = minutes > 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  return `GMT${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${pad(abs % 60)}` : ""}`;
}

export type TimeZoneOption = { value: string; label: string; region: string; offset: number };

export function listTimeZones(now = new Date()): TimeZoneOption[] {
  const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const zones = [...new Set([DEFAULT_TIME_ZONE, ...supported])].filter(isValidTimeZone);
  return zones.map((value) => ({
    value,
    label: `${value.replaceAll("_", " ")} (${offsetLabel(value, now)})`,
    region: value.includes("/") ? value.split("/")[0] : "Other",
    offset: offsetMinutes(now, value),
  })).sort((a, b) => a.region.localeCompare(b.region) || a.value.localeCompare(b.value));
}

/** Time zone options grouped by region, making sure `current` is present even if the runtime doesn't list it. */
export function groupedTimeZones(current?: string) {
  const options = listTimeZones();
  if (current && !options.some((option) => option.value === current) && isValidTimeZone(current)) {
    options.unshift({ value: current, label: current, region: "Other", offset: 0 });
  }
  const groups = new Map<string, TimeZoneOption[]>();
  for (const option of options) groups.set(option.region, [...(groups.get(option.region) ?? []), option]);
  return [...groups.entries()];
}

export function browserTimeZone() {
  try { return safeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { return DEFAULT_TIME_ZONE; }
}
