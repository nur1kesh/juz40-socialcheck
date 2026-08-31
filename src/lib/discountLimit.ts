import { almatyYearMonth, isPastAlmatyDay } from '@/lib/timezone';

// "1 лимит = 1 ай" — a document expiring anywhere within the current
// calendar month (Almaty time) still counts as limit 1, not 0. Counts
// whole calendar months from now through the expiry month, inclusive.
export function monthsUntilExpiry(expiryDate: Date, now: Date = new Date()): number {
  const e = almatyYearMonth(expiryDate);
  const n = almatyYearMonth(now);
  const months = (e.year - n.year) * 12 + (e.month - n.month) + 1;
  return Math.max(0, months);
}

const STUDENT_CERTIFICATE_EXCEPTION_LIMIT_MONTHS = 5;

interface LimitDoc {
  documentType: string;
  documentExpiryDate: Date | null;
  ocrStatus?: string;
  verificationStatus?: string;
}

function isExpired(d: LimitDoc, now: Date): boolean {
  return Boolean(d.documentExpiryDate && isPastAlmatyDay(d.documentExpiryDate, now));
}

// The application's overall discount limit is bounded by whichever
// document expires soonest — the discount can't outlive its shortest-lived
// supporting document. Documents with no expiry date don't constrain it.
// Returns null when no document has an expiry date at all (no limit to report).
//
// Exception: when an expired "many_children_family" document is covered by
// a student certificate (see decideAutomatically in autoDecision.ts — the
// certificate needs no detected expiry date, or one that hasn't passed
// yet), that pair gets a flat 5-month limit instead of whatever the
// expired date would compute to. A many_children_family document that
// isn't actually expired still uses its real expiry date, cert or no cert.
export function discountLimitMonths(documents: LimitDoc[], now: Date = new Date()): number | null {
  const studentCert = documents.find((d) => d.documentType === 'student_certificate');
  const studentCertCovers = Boolean(studentCert && !isExpired(studentCert, now));
  const exceptionActive =
    studentCertCovers && documents.some((d) => d.documentType === 'many_children_family' && isExpired(d, now));

  const isForgivenType = (d: LimitDoc) =>
    exceptionActive && (d.documentType === 'many_children_family' || d.documentType === 'student_certificate');

  const months = documents
    .map((d) => {
      if (isForgivenType(d)) return STUDENT_CERTIFICATE_EXCEPTION_LIMIT_MONTHS;
      // A student_certificate that isn't actively covering the exception
      // (e.g. left over from an earlier expired-card attempt, after the
      // student replaced it with a fresh valid card) is never itself the
      // required benefit document — its own expiry must not shorten the
      // limit computed from the document that actually qualifies.
      if (d.documentType === 'student_certificate') return null;
      return d.documentExpiryDate ? monthsUntilExpiry(d.documentExpiryDate, now) : null;
    })
    .filter((m): m is number => m !== null);

  if (months.length === 0) return null;

  return Math.min(...months);
}

const KAZAKH_MONTHS = [
  'қаңтар',
  'ақпан',
  'наурыз',
  'сәуір',
  'мамыр',
  'маусым',
  'шілде',
  'тамыз',
  'қыркүйек',
  'қазан',
  'қараша',
  'желтоқсан',
];

// `manualLimitMonths` is a FIXED count an admin typed at approval time
// ("valid for N months") — anchored to the approval date, unlike
// discountLimitMonths()'s result, which is already "months remaining as of
// now" and gets recomputed fresh on every call from each document's fixed
// expiry date. Passing manualLimitMonths directly wherever a "months
// remaining as of now" number is expected (discountValidUntilLabel, an
// `=== 0` "already expired" check, a renewal-reminder threshold) would be
// wrong: the displayed end date would silently slide later every time the
// page is viewed (it's always "N months from *today*" instead of a fixed
// point), and "already expired" would become unreachable since the fixed
// admin number never decreases.
//
// This resolves the actual fixed target month once (decidedAt +
// manualLimitMonths, inclusive — same "1 limit = 1 calendar month" rule as
// monthsUntilExpiry), then re-expresses it as months remaining from `now`
// — exactly the shape a real document expiry date would produce — so
// callers can treat a manually-approved and an auto-approved application
// identically from this point on.
export function manualLimitRemainingMonths(
  decidedAt: Date,
  manualLimitMonths: number,
  now: Date = new Date(),
): number {
  const d = almatyYearMonth(decidedAt);
  const targetMonthIndex = d.month + (manualLimitMonths - 1);
  const targetYear = d.year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  // Any day safely inside the target month works — only the year/month
  // bucket matters (see almatyYearMonth/monthsUntilExpiry), and day 15
  // keeps this away from any month-boundary timezone-offset edge case.
  const withinTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 15));
  return monthsUntilExpiry(withinTargetMonth, now);
}

// Renders a month-count limit as the actual calendar month it runs through
// — "1 лимит = 1 ай" means the limit expires at the END of that Nth month,
// not N months from today to the day, so a day-level date would overstate
// precision the underlying data doesn't have.
export function discountValidUntilLabel(months: number, now: Date = new Date()): string | null {
  if (months <= 0) return null;
  const { year, month } = almatyYearMonth(now);
  const targetMonthIndex = month + (months - 1);
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  return `${targetYear} жылдың ${KAZAKH_MONTHS[targetMonth]} айының соңына дейін`;
}
