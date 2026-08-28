import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { assertTransition, InvalidTransitionError } from '@/lib/applicationStateMachine';
import { decideAutomatically, rejectionReason } from '@/lib/autoDecision';
import { purgeRejectedDocuments } from '@/lib/rejectApplication';
import type { Application } from '@prisma/client';

// Thrown internally when the row's status changed between our read and our
// write (a double-submit from two tabs, or a retried request) — never
// escapes this module.
class StaleStatusError extends Error {}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Авторизация қажет' }, { status: 401 });

  const application = await prisma.application.findUnique({
    where: { id: params.id },
    include: { documents: true },
  });

  if (!application || application.userId !== user.id) {
    return NextResponse.json({ error: 'Табылмады' }, { status: 404 });
  }

  const uploadedTypes = new Set(application.documents.map((d) => d.documentType));
  const missing = application.benefitTypes.filter((b) => !uploadedTypes.has(b));
  if (missing.length > 0) {
    return NextResponse.json({ error: 'Құжатты жүктеу қажет.' }, { status: 400 });
  }

  const now = new Date();

  // Fully automated decision (OCR-scored per document, aggregated in
  // decideAutomatically): approved (discount granted, saved) or rejected
  // (no discount, documents purged) resolve immediately; pending_review is
  // the only case a human ever touches.
  const finalStatus = decideAutomatically(application.documents);

  try {
    assertTransition(application.status, 'pending_review');
    // When the AI itself lands on pending_review, that IS the final state
    // for this submit — no further transition needed (and 'pending_review
    // -> pending_review' isn't a transition the state machine allows,
    // since it's not really a transition at all).
    if (finalStatus !== 'pending_review') {
      assertTransition('pending_review', finalStatus);
    }
  } catch (e) {
    if (e instanceof InvalidTransitionError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }

  let updated: Application;
  try {
    updated = await prisma.$transaction(async (tx) => {
      // Compare-and-swap against the draft status we just read — closes
      // the window for a double-submit (two tabs, a slow first request
      // retried) to both pass the assertTransition check above and both
      // write + purge documents for the same application.
      const result = await tx.application.updateMany({
        where: { id: application.id, status: application.status },
        data: { status: finalStatus, submittedAt: now },
      });
      if (result.count === 0) {
        throw new StaleStatusError();
      }

      await tx.applicationEvent.createMany({
        data: [
          { applicationId: application.id, eventType: 'submitted', oldStatus: 'draft', newStatus: 'pending_review' },
          {
            applicationId: application.id,
            eventType: 'auto_decision',
            oldStatus: 'pending_review',
            newStatus: finalStatus,
            actor: 'ai',
            metadata: finalStatus === 'rejected' ? { reason: rejectionReason(application.documents) } : undefined,
          },
        ],
      });

      return tx.application.findUniqueOrThrow({ where: { id: application.id } });
    });
  } catch (e) {
    if (e instanceof StaleStatusError) {
      return NextResponse.json({ error: 'Бұл өтінім басқа сұраныспен өзгертілді. Қайта көріңіз.' }, { status: 409 });
    }
    throw e;
  }

  if (finalStatus === 'rejected') {
    await purgeRejectedDocuments(application.id);
  }

  return NextResponse.json({ application: updated });
}
