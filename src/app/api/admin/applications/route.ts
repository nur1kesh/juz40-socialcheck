import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/adminSession';
import type { ApplicationStatus, BenefitType, Prisma } from '@prisma/client';
import { almatyDayBoundsUtc } from '@/lib/timezone';

const VALID_STATUSES: ApplicationStatus[] = ['draft', 'pending_review', 'approved', 'rejected'];
const VALID_BENEFIT_TYPES: BenefitType[] = ['many_children_family', 'incomplete_family', 'disability'];
const TAKE = 500;

export async function GET(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Авторизация қажет' }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const status = params.get('status');
  const benefitType = params.get('benefitType');
  const email = params.get('email');
  const date = params.get('date'); // YYYY-MM-DD

  if (status && !VALID_STATUSES.includes(status as ApplicationStatus)) {
    return NextResponse.json({ error: 'status мәні дұрыс емес' }, { status: 400 });
  }
  if (benefitType && !VALID_BENEFIT_TYPES.includes(benefitType as BenefitType)) {
    return NextResponse.json({ error: 'benefitType мәні дұрыс емес' }, { status: 400 });
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date форматы YYYY-MM-DD болуы керек' }, { status: 400 });
  }

  const where: Prisma.ApplicationWhereInput = {};
  // Drafts are unfinished, unsubmitted attempts — never meant to be
  // admin-visible (see the explicit exclusion in the export/status-tab
  // filters). Without this, the "Барлығы" tab (empty status = no filter)
  // would otherwise show them, indistinguishable in color from a genuinely
  // actionable pending_review row.
  where.status = status ? (status as ApplicationStatus) : { not: 'draft' };
  if (benefitType) where.benefitTypes = { has: benefitType as BenefitType };
  if (email) where.user = { email: { contains: email, mode: 'insensitive' } };
  if (date) {
    const [yyyy, mm, dd] = date.split('-') as [string, string, string];
    const { start, end } = almatyDayBoundsUtc(dd, mm, yyyy);
    // "Жіберілген" (submitted) is what the admin UI labels and sorts this
    // by — filtering on createdAt (draft-creation time) would silently
    // miss applications submitted on this date but started earlier, and
    // catch ones started on this date but submitted later.
    where.submittedAt = { gte: start, lte: end };
  }

  const [applications, totalCount] = await Promise.all([
    prisma.application.findMany({
      where,
      include: { user: true, documents: true, events: { orderBy: { createdAt: 'asc' } } },
      orderBy: { submittedAt: 'desc' },
      take: TAKE,
    }),
    prisma.application.count({ where }),
  ]);

  return NextResponse.json({ applications, totalCount, truncated: totalCount > TAKE });
}
