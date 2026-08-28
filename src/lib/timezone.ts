// The whole product is for Kazakhstani students — every displayed date and
// every "which calendar day is this" computation should use Almaty time
// (UTC+5, no DST), not whatever timezone the server or admin's browser
// happens to be running in.
export const ALMATY_TZ = 'Asia/Almaty';

export function formatAlmatyDate(date: Date): string {
  return date.toLocaleDateString('kk-KZ', { timeZone: ALMATY_TZ });
}

export function formatAlmatyDateTime(date: Date): string {
  return date.toLocaleString('kk-KZ', { timeZone: ALMATY_TZ });
}

// Given a DD.MM.YYYY calendar date (as picked in an Almaty-local date
// input), returns the UTC instants for the start and end of that day *in
// Almaty time* — e.g. 25.08.2026 in Almaty (UTC+5) runs from
// 2026-08-24T19:00:00Z to 2026-08-25T18:59:59.999Z.
export function almatyDayBoundsUtc(dd: string, mm: string, yyyy: string): { start: Date; end: Date } {
  const start = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000+05:00`);
  const end = new Date(`${yyyy}-${mm}-${dd}T23:59:59.999+05:00`);
  return { start, end };
}

// Almaty-local {year, month} for a given instant — used for "how many
// calendar months away" computations (discountLimit.ts) so a document
// expiring right around midnight UTC isn't attributed to the wrong month.
export function almatyYearMonth(date: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ALMATY_TZ,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value) - 1; // 0-indexed, matches Date#getMonth
  return { year, month };
}

// Today's date in Almaty as YYYY-MM-DD, for prefilling <input type="date">.
export function todayAlmatyIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ALMATY_TZ }).format(new Date());
}

// Almaty-local calendar date as YYYY-MM-DD for any instant — ISO format
// sorts lexically, so two of these can be compared with plain `<`/`>`.
export function almatyDateIso(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ALMATY_TZ }).format(date);
}

// A document's expiryDate is stored as UTC-midnight of its printed calendar
// date (e.g. "27.08.2026" -> 2026-08-27T00:00:00Z), which is already
// Almaty-morning of that same day — so comparing it to `now` as raw
// instants makes the document "expire" at Almaty 05:00 on the printed day,
// roughly 19 hours before it should (it's meant to stay valid through the
// END of that Almaty calendar day). Comparing calendar-day strings instead
// gets this right regardless of what wall-clock time either instant falls on.
export function isPastAlmatyDay(date: Date, now: Date = new Date()): boolean {
  return almatyDateIso(now) > almatyDateIso(date);
}
