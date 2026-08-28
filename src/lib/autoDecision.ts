import type { ApplicationStatus, Document } from '@prisma/client';
import { isPastAlmatyDay } from '@/lib/timezone';

export type AutoDecision = Extract<ApplicationStatus, 'approved' | 'rejected' | 'pending_review'>;
export type RejectionReason = 'expired' | 'type_mismatch';

// Shared by decideAutomatically and rejectionReason so the "what counts as
// expired/forgiven" rule can't drift between the decision itself and the
// explanation shown for it later.
function expiryHelpers(documents: Document[]) {
  const now = new Date();
  const isExpired = (d: Document) => Boolean(d.documentExpiryDate && isPastAlmatyDay(d.documentExpiryDate, now));

  const studentCert = documents.find((d) => d.documentType === 'student_certificate');
  // A student certificate with no detected expiry date is fine (isExpired
  // is false when documentExpiryDate is null) — but if it DOES have a date
  // and that date has passed, it no longer covers the exception. Its own
  // OCR confidence/verification isn't checked — presence and expiry are
  // all that matter for this exception.
  const studentCertCovers = Boolean(studentCert && !isExpired(studentCert));

  // Exception (спец. ереже): an expired "many_children_family" document is
  // still acceptable if a student certificate (18+ child still studying)
  // was uploaded alongside it — neither document's expiry blocks approval
  // in that case. That combination also gets a fixed 5-month discount
  // limit instead of one computed from the expired date — see
  // discountLimitMonths in discountLimit.ts.
  const isForgiven = (d: Document) =>
    studentCertCovers && (d.documentType === 'many_children_family' || d.documentType === 'student_certificate');

  return { isExpired, isForgiven };
}

// Decides an application's outcome from its documents' OCR results, without
// a human in the loop — a deliberate policy choice (the user asked for full
// automation, minimal statuses). Each document was already scored at
// upload time (see documents/route.ts): ocrStatus is 'needs_manual_review'
// whenever OCR wasn't confident enough to trust, and verificationStatus is
// 'rejected' only when OCR is confident the document does NOT match the
// claimed benefit category. This function just aggregates those
// already-cautious per-document signals — it doesn't re-interpret OCR
// itself. 'pending_review' is the only fallback for genuine uncertainty;
// everything else resolves straight to approved or rejected.
export function decideAutomatically(documents: Document[]): AutoDecision {
  if (documents.length === 0) return 'pending_review';

  const { isExpired, isForgiven } = expiryHelpers(documents);

  // An expired, unforgiven document is a hard rejection — no discount,
  // never a "maybe" for a human to weigh in on. student_certificate is
  // excluded here too (same reasoning as the type_mismatch check below):
  // it's never itself the required benefit document, so its own expiry
  // must never be what sinks an otherwise-valid application — it only
  // matters as forgiveness *cover* for an expired many_children_family
  // doc, which isForgiven() already accounts for.
  if (documents.some((d) => d.documentType !== 'student_certificate' && isExpired(d) && !isForgiven(d))) {
    return 'rejected';
  }

  // student_certificate is a supplementary, optional document (never a
  // BenefitType itself) — a mismatched OCR read on it shouldn't sink an
  // otherwise-fine application, same reasoning as its exclusion from
  // anyUncertain just below.
  if (documents.some((d) => d.documentType !== 'student_certificate' && d.verificationStatus === 'rejected')) {
    return 'rejected';
  }

  const anyUncertain = documents.some(
    (d) =>
      d.documentType !== 'student_certificate' &&
      (d.ocrStatus === 'needs_manual_review' || d.verificationStatus !== 'verified'),
  );
  if (anyUncertain) {
    return 'pending_review';
  }

  return 'approved';
}

// Only meaningful right when an application is being rejected — the caller
// stores this in the rejection ApplicationEvent's metadata, because the
// Document rows themselves get purged immediately after (data
// minimization), so this is the only surviving trace of *why*.
export function rejectionReason(documents: Document[]): RejectionReason | null {
  const { isExpired, isForgiven } = expiryHelpers(documents);
  if (documents.some((d) => d.documentType !== 'student_certificate' && isExpired(d) && !isForgiven(d))) {
    return 'expired';
  }
  if (documents.some((d) => d.documentType !== 'student_certificate' && d.verificationStatus === 'rejected')) {
    return 'type_mismatch';
  }
  return null;
}
