import { prisma } from '@/lib/db';
import { assertTransition, InvalidTransitionError } from '@/lib/applicationStateMachine';
import { purgeRejectedDocuments } from '@/lib/rejectApplication';
import { rejectionReason } from '@/lib/autoDecision';
import type { Application } from '@prisma/client';

export type AdminDecision = 'approve' | 'reject';

const DECISION_TO_STATUS = {
  approve: 'approved',
  reject: 'rejected',
} as const;

export type DecideApplicationResult =
  | { ok: true; application: Application }
  | { ok: false; error: string; status: number };

// Thrown internally when the row's status changed between our read and our
// write — never escapes this module.
class StaleStatusError extends Error {}

// Shared by the single-application and bulk decision endpoints — one place
// for the transition check, event logging (with rejection reason/note), and
// document purge-on-reject, so the two routes can't drift apart.
export async function decideApplicationAsAdmin(params: {
  applicationId: string;
  decision: AdminDecision;
  adminEmail: string;
  note?: string;
}): Promise<DecideApplicationResult> {
  const application = await prisma.application.findUnique({
    where: { id: params.applicationId },
    include: { documents: true },
  });
  if (!application) return { ok: false, error: 'Табылмады', status: 404 };

  const nextStatus = DECISION_TO_STATUS[params.decision];

  try {
    assertTransition(application.status, nextStatus);
  } catch (e) {
    if (e instanceof InvalidTransitionError) {
      return { ok: false, error: e.message, status: 409 };
    }
    throw e;
  }

  let updated: Application;
  try {
    updated = await prisma.$transaction(async (tx) => {
      // updateMany with the previously-read status in the WHERE clause
      // makes this a compare-and-swap: if two admins (or a duplicated id
      // in the same bulk batch) race to decide the same application, only
      // the first write's `count` comes back 1 — the second sees 0 and
      // backs off instead of silently overwriting the first admin's
      // decision with a contradictory event.
      const result = await tx.application.updateMany({
        where: { id: application.id, status: application.status },
        data: { status: nextStatus },
      });
      if (result.count === 0) {
        throw new StaleStatusError();
      }
      const app = await tx.application.findUniqueOrThrow({ where: { id: application.id } });
      await tx.applicationEvent.create({
        data: {
          applicationId: app.id,
          eventType: `admin_${params.decision}`,
          oldStatus: application.status,
          newStatus: nextStatus,
          actor: `admin:${params.adminEmail}`,
          metadata:
            params.note || nextStatus === 'rejected'
              ? {
                  ...(params.note ? { note: params.note } : {}),
                  ...(nextStatus === 'rejected' ? { reason: rejectionReason(application.documents) } : {}),
                }
              : undefined,
        },
      });
      return app;
    });
  } catch (e) {
    if (e instanceof StaleStatusError) {
      return {
        ok: false,
        error: 'Бұл өтінімнің мәртебесі басқа әрекетпен өзгертілді. Тізімді жаңартып, қайталаңыз.',
        status: 409,
      };
    }
    throw e;
  }

  if (nextStatus === 'rejected') {
    await purgeRejectedDocuments(application.id);
  }

  return { ok: true, application: updated };
}
