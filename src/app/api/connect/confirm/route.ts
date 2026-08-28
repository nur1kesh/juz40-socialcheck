import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createSession } from '@/lib/session';
import { rateLimit } from '@/lib/rateLimit';
import { profileFieldsSchema } from '@/lib/validation';

// This is the trust boundary: whatever OCR guessed, the student has now
// reviewed and explicitly confirmed it themselves (checkbox on /connect).
// That makes this equivalent in trust level to manual entry — OCR only
// saved typing, it did not add identity verification. Same as manual
// entry, this does not cryptographically prove the student's identity;
// real verification requires the JUZ40 API/SSO path. Email is the account
// identity key (upsert target) — a repeat visit with the same email
// updates the same user record instead of creating a duplicate.
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  if (!rateLimit(`connect-confirm:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Тым көп сұраныс' }, { status: 429 });
  }

  const parsed = profileFieldsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Барлық өрістерді дұрыс толтырыңыз.' },
      { status: 400 },
    );
  }

  const user = await prisma.user.upsert({
    where: { email: parsed.data.email },
    update: parsed.data,
    create: parsed.data,
  });

  await createSession(user.id);

  return NextResponse.json({ ok: true });
}
