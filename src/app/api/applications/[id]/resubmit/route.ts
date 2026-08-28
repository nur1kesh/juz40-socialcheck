import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';

// Creates a new application/attempt from a rejected one; the old row stays
// exactly as it is (status 'rejected', its documents already purged),
// preserving history without an extra intermediate status.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Авторизация қажет' }, { status: 401 });

  const application = await prisma.application.findUnique({ where: { id: params.id } });
  if (!application || application.userId !== user.id) {
    return NextResponse.json({ error: 'Табылмады' }, { status: 404 });
  }

  if (application.status !== 'rejected') {
    return NextResponse.json({ error: 'Бұл өтінімді қайта жіберуге болмайды.' }, { status: 409 });
  }

  const newApplication = await prisma.application.create({
    data: {
      userId: user.id,
      benefitTypes: application.benefitTypes,
      status: 'draft',
      attemptNumber: application.attemptNumber + 1,
      previousApplicationId: application.id,
    },
  });

  return NextResponse.json({ application: newApplication });
}
