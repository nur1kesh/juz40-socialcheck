import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { randomToken, sha256Hex } from '@/lib/crypto';

const SESSION_COOKIE = 'sc_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export async function createSession(userId: string) {
  const token = randomToken();
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: { userId, tokenHash, expiresAt },
  });

  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function getCurrentUser() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const tokenHash = sha256Hex(token);
  const session = await prisma.session.findFirst({
    where: { tokenHash, expiresAt: { gt: new Date() } },
    include: { user: true },
  });

  return session?.user ?? null;
}

export async function destroySession() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) {
    const tokenHash = sha256Hex(token);
    await prisma.session.deleteMany({ where: { tokenHash } });
  }
  cookies().delete(SESSION_COOKIE);
}
