/**
 * Business time is Asia/Kolkata (UTC+05:30, no DST). Timestamps are stored as UTC epoch ms;
 * business dates (`txn_date`) are "YYYY-MM-DD" strings in IST.
 */
export const BUSINESS_TZ = "Asia/Kolkata";
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 86_400_000;

export type IsoDate = string; // YYYY-MM-DD

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** IST calendar date for a UTC timestamp. */
export function toIstDate(ms: number): IsoDate {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function todayIst(now: number = Date.now()): IsoDate {
  return toIstDate(now);
}

/** UTC ms of IST midnight at the start of `date`. */
export function istDayStartMs(date: IsoDate): number {
  return Date.parse(`${date}T00:00:00.000Z`) - IST_OFFSET_MS;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** UTC ms of IST midnight on the first day of the IST month containing `now`. */
export function istMonthStartMs(now: number = Date.now()): number {
  const first = `${toIstDate(now).slice(0, 7)}-01`;
  return istDayStartMs(first);
}

/** Inclusive number of days between two dates. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** Monday-based week start. */
export function startOfWeek(date: IsoDate): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  return addDays(date, -dow);
}

export function startOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: IsoDate): IsoDate {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/** Lists every date from `from` to `to` inclusive. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: BUSINESS_TZ, day: "numeric", month: "short", year: "numeric" });
const shortDateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: BUSINESS_TZ, day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: BUSINESS_TZ, hour: "numeric", minute: "2-digit", hour12: true });

/** "25 Sept 2026" */
export function formatDate(input: number | IsoDate): string {
  const ms = typeof input === "number" ? input : istDayStartMs(input) + 12 * 3600_000;
  return dateFmt.format(ms);
}

/** "25 Sept" */
export function formatShortDate(input: number | IsoDate): string {
  const ms = typeof input === "number" ? input : istDayStartMs(input) + 12 * 3600_000;
  return shortDateFmt.format(ms);
}

/** "10:32 am" */
export function formatTime(ms: number): string {
  return timeFmt.format(ms);
}

/** "Today 10:32 am", "Yesterday 6:05 pm", "12 Sept, 9:00 am". */
export function formatDateTime(ms: number, now: number = Date.now()): string {
  const d = toIstDate(ms);
  const today = toIstDate(now);
  if (d === today) return `Today ${formatTime(ms)}`;
  if (d === addDays(today, -1)) return `Yesterday ${formatTime(ms)}`;
  return `${formatShortDate(ms)}, ${formatTime(ms)}`;
}

/** Relative "2m ago" style labels for feeds. */
export function formatRelative(ms: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ms);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / 3_600_000)}h ago`;
  return formatDateTime(ms, now);
}

/** Hour of day (0–23) in IST — for greetings. */
export function istHour(now: number = Date.now()): number {
  return new Date(now + IST_OFFSET_MS).getUTCHours();
}

export function greeting(now: number = Date.now()): string {
  const h = istHour(now);
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
