import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';

// A narrower complaint than the ordinary manual-review queue: the student
// isn't disputing the *decision* (that's already 'approved' and final —
// see applicationStateMachine.ts, approved has no outgoing transitions),
// they're saying the downstream activation this app told them about isn't
// actually showing up. Deliberately doesn't touch `status` at all, so it
// can never collide with or be mistaken for pending_review.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Авторизация қажет' }, { status: 401 });

  const application = await prisma.application.findUnique({ where: { id: params.id } });
  if (!application || application.userId !== user.id) {
    return NextResponse.json({ error: 'Табылмады' }, { status: 404 });
  }
  if (!application.discountActivatedAt) {
    return NextResponse.json({ error: 'Бұл өтінім үшін жеңілдік әлі белсендірілмеген' }, { status: 409 });
  }

  // Idempotent — a second click (double-tap, refresh) just hands back the
  // already-reported state instead of logging a duplicate event.
  if (application.activationDisputedAt) {
    return NextResponse.json({ application });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const app = await tx.application.update({
      where: { id: application.id },
      data: { activationDisputedAt: new Date() },
    });
    await tx.applicationEvent.create({
      data: {
        applicationId: application.id,
        eventType: 'activation_disputed',
        actor: `user:${user.email}`,
      },
    });
    return app;
  });

  return NextResponse.json({ application: updated });
}
