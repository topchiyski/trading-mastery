/**
 * Date helpers. Timestamps are UTC ISO-8601 strings; trading-day logic uses
 * America/New_York calendar dates represented as plain `YYYY-MM-DD` strings.
 */
export type IsoDate = string;

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const nyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function parseTimestamp(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new RangeError(`Invalid timestamp: "${iso}"`);
  return t;
}

/** New York calendar date of a UTC timestamp. */
export function toNyDate(iso: string): IsoDate {
  const parts = nyFormatter.formatToParts(new Date(parseTimestamp(iso)));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function dateToMs(d: IsoDate): number {
  const ms = DATE_RE.test(d) ? Date.parse(`${d}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(ms) || msToDate(ms) !== d) throw new RangeError(`Invalid date: "${d}"`);
  return ms;
}

function msToDate(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Accepts a plain date (returned as-is) or a timestamp (converted to its NY date). */
export function nyDateOf(value: string): IsoDate {
  if (DATE_RE.test(value)) {
    dateToMs(value);
    return value;
  }
  return toNyDate(value);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  return msToDate(dateToMs(d) + n * DAY_MS);
}

export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((dateToMs(to) - dateToMs(from)) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(d: IsoDate): number {
  return new Date(dateToMs(d)).getUTCDay();
}

// ---------------------------------------------------------------------------
// NYSE calendar

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number): IsoDate => `${y}-${pad(m)}-${pad(d)}`;

/** n-th given weekday of a month (month 1-12); n = -1 means the last one. */
function nthWeekday(year: number, month: number, wd: number, n: number): IsoDate {
  if (n > 0) {
    const first = ymd(year, month, 1);
    return addDays(first, ((wd - weekday(first) + 7) % 7) + (n - 1) * 7);
  }
  const last = addDays(month === 12 ? ymd(year + 1, 1, 1) : ymd(year, month + 1, 1), -1);
  return addDays(last, -((weekday(last) - wd + 7) % 7));
}

function easterSunday(y: number): IsoDate {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(y, month, day);
}

/** Saturday holidays are observed on Friday, Sunday holidays on Monday. */
function observed(d: IsoDate): IsoDate {
  const wd = weekday(d);
  return wd === 6 ? addDays(d, -1) : wd === 0 ? addDays(d, 1) : d;
}

/** One-off market closures not covered by the regular rules. */
const SPECIAL_CLOSURES: ReadonlySet<IsoDate> = new Set([
  '2012-10-29', // Hurricane Sandy
  '2012-10-30',
  '2018-12-05', // President G.H.W. Bush
  '2025-01-09', // President Carter
]);

const holidayCache = new Map<number, ReadonlySet<IsoDate>>();

/** Regular NYSE full-day holidays for a year (observed dates). */
export function nyseHolidays(year: number): ReadonlySet<IsoDate> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const days: IsoDate[] = [];
  // New Year's Day: a Saturday holiday is NOT moved to the previous Friday (Dec 31).
  const newYear = ymd(year, 1, 1);
  if (weekday(newYear) !== 6) days.push(observed(newYear));
  days.push(nthWeekday(year, 1, 1, 3)); // Martin Luther King Jr. Day
  days.push(nthWeekday(year, 2, 1, 3)); // Washington's Birthday
  days.push(addDays(easterSunday(year), -2)); // Good Friday
  days.push(nthWeekday(year, 5, 1, -1)); // Memorial Day
  if (year >= 2022) days.push(observed(ymd(year, 6, 19))); // Juneteenth
  days.push(observed(ymd(year, 7, 4))); // Independence Day
  days.push(nthWeekday(year, 9, 1, 1)); // Labor Day
  days.push(nthWeekday(year, 11, 4, 4)); // Thanksgiving
  days.push(observed(ymd(year, 12, 25))); // Christmas
  const set = new Set(days);
  holidayCache.set(year, set);
  return set;
}

export function isTradingDay(d: IsoDate): boolean {
  const wd = weekday(d);
  if (wd === 0 || wd === 6) return false;
  if (SPECIAL_CLOSURES.has(d)) return false;
  return !nyseHolidays(Number(d.slice(0, 4))).has(d);
}

/** The first trading day on or after `d`. */
export function nextTradingDay(d: IsoDate): IsoDate {
  let cur = d;
  while (!isTradingDay(cur)) cur = addDays(cur, 1);
  return cur;
}

/** Trading days in [from, to], inclusive. */
export function tradingDaysInRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isTradingDay(d)) out.push(d);
  return out;
}

/** Number of trading days in (from, to]: Fri -> Mon is 1, same day is 0. */
export function tradingDaysBetween(from: IsoDate, to: IsoDate): number {
  if (to <= from) return 0;
  return tradingDaysInRange(addDays(from, 1), to).length;
}
