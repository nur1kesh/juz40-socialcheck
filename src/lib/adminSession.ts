import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { randomToken, sha256Hex } from '@/lib/crypto';

// Deliberately separate from the student Session model/cookie so an admin
// session can never be confused with or escalate from a student session.
const ADMIN_COOKIE = 'sc_admin_session';
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours

export async function verifyAdminCredentials(email: string, password: string) {
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin) return null;
  const ok = await bcrypt.compare(password, admin.passwordHash);
  return ok ? admin : null;
}

export async function createAdminSession(adminId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS);

  await prisma.adminSession.create({
    data: { adminId, tokenHash: sha256Hex(token), expiresAt },
  });

  cookies().set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function getCurrentAdmin() {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.adminSession.findFirst({
    where: { tokenHash: sha256Hex(token), expiresAt: { gt: new Date() } },
    include: { admin: true },
  });

  return session?.admin ?? null;
}

export async function destroyAdminSession() {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  if (token) {
    await prisma.adminSession.deleteMany({ where: { tokenHash: sha256Hex(token) } });
  }
  cookies().delete(ADMIN_COOKIE);
}
