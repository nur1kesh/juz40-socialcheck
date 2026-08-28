import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';

const createSchema = z.object({
  benefitTypes: z
    .array(z.enum(['many_children_family', 'incomplete_family', 'disability']))
    .min(1, 'Кемінде бір жеңілдік түрін таңдаңыз')
    .max(3)
    .refine((arr) => new Set(arr).size === arr.length, 'Қайталанатын жеңілдік түрлері'),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Авторизация қажет' }, { status: 401 });

  const applications = await prisma.application.findMany({
    where: { userId: user.id },
    include: { documents: true },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ applications });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Авторизация қажет' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Деректер форматы дұрыс емес' }, { status: 400 });
  }

  const application = await prisma.application.create({
    data: {
      userId: user.id,
      benefitTypes: parsed.data.benefitTypes,
      status: 'draft',
    },
  });

  return NextResponse.json({ application });
}
