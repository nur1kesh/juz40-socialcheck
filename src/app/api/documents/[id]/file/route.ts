import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { getCurrentAdmin } from '@/lib/adminSession';
import { readDocumentFile } from '@/lib/storage';

// Documents are never served from a static/public path. Every request is
// authorized here: the caller must be either the owning student or an admin.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const [user, admin] = await Promise.all([getCurrentUser(), getCurrentAdmin()]);
  if (!user && !admin) {
    return NextResponse.json({ error: 'Табылмады' }, { status: 404 });
  }

  const document = await prisma.document.findUnique({
    where: { id: params.id },
    include: { application: true },
  });

  if (!document) {
    return NextResponse.json({ error: 'Табылмады' }, { status: 404 });
  }
  if (!admin && document.application.userId !== user?.id) {
    return NextResponse.json({ error: 'Табылмады' }, { status: 404 });
  }

  // The file can vanish between this read and now (rejection purge running
  // concurrently) — fail closed with the same 404 rather than an unhandled
  // 500 from a raw ENOENT.
  const buffer = await readDocumentFile(document.filePath).catch(() => null);
  if (!buffer) {
    return NextResponse.json({ error: 'Табылмады' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': document.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(document.originalFilename)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
