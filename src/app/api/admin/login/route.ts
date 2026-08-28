import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAdminCredentials, createAdminSession } from '@/lib/adminSession';
import { rateLimit } from '@/lib/rateLimit';

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  if (!rateLimit(`admin-login:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Тым көп сұраныс' }, { status: 429 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Деректер форматы дұрыс емес' }, { status: 400 });
  }

  const admin = await verifyAdminCredentials(parsed.data.email, parsed.data.password);
  if (!admin) {
    return NextResponse.json({ error: 'Email немесе құпия сөз қате' }, { status: 401 });
  }

  await createAdminSession(admin.id);
  return NextResponse.json({ ok: true });
}
