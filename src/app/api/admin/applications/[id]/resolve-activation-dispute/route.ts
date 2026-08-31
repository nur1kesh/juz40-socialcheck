import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/adminSession';

// Clears the flag once the admin has actually fixed the activation
// out-of-band (in Kaspi/the billing system) or confirmed with the student
// it was a false alarm — there's no automatic re-check here, this is
// purely "an admin looked at it and it's handled now".
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Авторизация қажет' }, { status: 401 });

  const application = await prisma.application.findUnique({ where: { id: params.id } });
  if (!application) return NextResponse.json({ error: 'Табылмады' }, { status: 404 });
  if (!application.activationDisputedAt) {
    return NextResponse.json({ error: 'Бұл өтінім бойынша шағым жоқ' }, { status: 409 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const app = await tx.application.update({
      where: { id: application.id },
      data: { activationDisputedAt: null },
    });
    await tx.applicationEvent.create({
      data: {
        applicationId: application.id,
        eventType: 'activation_dispute_resolved',
        actor: `admin:${admin.email}`,
      },
    });
    return app;
  });

  return NextResponse.json({ application: updated });
}
