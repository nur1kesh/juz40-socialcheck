import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { deleteDocumentFile } from '@/lib/storage';

// Lets a student remove a document they just uploaded (e.g. to replace one
// the AI flagged as unreadable/mismatched) before the application is
// submitted. Only the owning student can do this, and only while the
// application is still a draft — once submitted, documents are locked.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Авторизация қажет' }, { status: 401 });

  const document = await prisma.document.findUnique({
    where: { id: params.id },
    include: { application: true },
  });

  if (!document || document.application.userId !== user.id) {
    return NextResponse.json({ error: 'Табылмады' }, { status: 404 });
  }
  if (document.application.status !== 'draft') {
    return NextResponse.json({ error: 'Бұл құжатты жоюға болмайды.' }, { status: 409 });
  }

  await prisma.document.delete({ where: { id: document.id } });
  await deleteDocumentFile(document.filePath);

  return NextResponse.json({ ok: true });
}
