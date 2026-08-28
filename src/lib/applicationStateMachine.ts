import { ApplicationStatus } from '@prisma/client';

// Deliberately minimal: draft -> pending_review -> approved/rejected, full
// stop. Only these transitions are legal — anything else is rejected
// server-side, regardless of what a client sends. A student who was
// rejected applies again by creating a brand new draft (see
// /api/applications/[id]/resubmit), not by reopening this one.
const ALLOWED_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  draft: ['pending_review'],
  pending_review: ['approved', 'rejected'],
  approved: [],
  rejected: [],
};

export class InvalidTransitionError extends Error {
  constructor(from: ApplicationStatus, to: ApplicationStatus) {
    super(`Тыйым салынған status ауысуы: ${from} -> ${to}`);
  }
}

export function assertTransition(from: ApplicationStatus, to: ApplicationStatus): void {
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}
