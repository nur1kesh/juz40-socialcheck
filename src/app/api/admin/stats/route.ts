import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/adminSession';

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Авторизация қажет' }, { status: 401 });

  const counts = await prisma.application.groupBy({
    by: ['status'],
    _count: { _all: true },
  });

  const byStatus: Record<string, number> = {};
  for (const c of counts) byStatus[c.status] = c._count._all;

  return NextResponse.json({ byStatus });
}
