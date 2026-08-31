import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/adminSession';
import { almatyLocalToUtc } from '@/lib/timezone';
import type { ApplicationStatus, Prisma } from '@prisma/client';

const GRANULARITIES = ['day', 'week', 'month'] as const;
type Granularity = (typeof GRANULARITIES)[number];
const STATUSES: ApplicationStatus[] = ['draft', 'pending_review', 'approved', 'rejected'];
const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

interface SeriesRow {
  period: Date;
  status: ApplicationStatus;
  count: bigint;
}

// This tab is about overall activity in a window ("сколько вообще") rather
// than an official submission log — unlike the applications-list/export
// filters (which key on submittedAt, since those exist to answer "who
// submitted when"), everything here is anchored on createdAt so a draft
// that was started but never submitted still shows up. That's the only way
// the "Толтырылуда" (draft) bucket can ever be non-zero in a ranged view.
export async function GET(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Авторизация қажет' }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const dateFrom = params.get('dateFrom'); // YYYY-MM-DDTHH:mm, Almaty local
  const dateTo = params.get('dateTo');
  const granularityParam = params.get('granularity') ?? 'day';

  if (dateFrom && !DATETIME_LOCAL_RE.test(dateFrom)) {
    return NextResponse.json({ error: 'dateFrom форматы YYYY-MM-DDTHH:mm болуы керек' }, { status: 400 });
  }
  if (dateTo && !DATETIME_LOCAL_RE.test(dateTo)) {
    return NextResponse.json({ error: 'dateTo форматы YYYY-MM-DDTHH:mm болуы керек' }, { status: 400 });
  }
  if (!GRANULARITIES.includes(granularityParam as Granularity)) {
    return NextResponse.json({ error: 'granularity дұрыс емес' }, { status: 400 });
  }
  const granularity = granularityParam as Granularity;

  const where: Prisma.ApplicationWhereInput = {
    ...((dateFrom || dateTo) && {
      createdAt: {
        ...(dateFrom ? { gte: almatyLocalToUtc(dateFrom) } : {}),
        ...(dateTo ? { lte: almatyLocalToUtc(dateTo) } : {}),
      },
    }),
  };

  const [statusGroups, benefitRows] = await Promise.all([
    prisma.application.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.application.findMany({ where, select: { benefitTypes: true } }),
  ]);

  const statusCounts: Record<ApplicationStatus, number> = {
    draft: 0,
    pending_review: 0,
    approved: 0,
    rejected: 0,
  };
  for (const g of statusGroups) statusCounts[g.status] = g._count._all;
  const total = STATUSES.reduce((sum, s) => sum + statusCounts[s], 0);

  const decided = statusCounts.approved + statusCounts.rejected;
  const approvalRate = decided > 0 ? (statusCounts.approved / decided) * 100 : null;

  const benefitTypeCounts: Record<string, number> = {
    many_children_family: 0,
    incomplete_family: 0,
    disability: 0,
  };
  for (const row of benefitRows) {
    for (const t of row.benefitTypes) benefitTypeCounts[t] = (benefitTypeCounts[t] ?? 0) + 1;
  }

  // granularity is whitelist-checked above (never attacker-controlled SQL),
  // so it's safe to splice directly into date_trunc's first argument —
  // Prisma can't bind it as a query param there. created_at is stored as a
  // naive UTC timestamp (no tz in the column), so the double AT TIME ZONE
  // is the standard trick to bucket it by Almaty calendar day/week/month
  // instead of UTC's (see ai-usage/timeseries/route.ts for the same pattern).
  const conditions: string[] = [];
  const sqlParams: Date[] = [];
  if (dateFrom) {
    sqlParams.push(almatyLocalToUtc(dateFrom));
    conditions.push(`created_at >= $${sqlParams.length}`);
  }
  if (dateTo) {
    sqlParams.push(almatyLocalToUtc(dateTo));
    conditions.push(`created_at <= $${sqlParams.length}`);
  }
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await prisma.$queryRawUnsafe<SeriesRow[]>(
    `SELECT date_trunc('${granularity}', created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Almaty') AS period,
            status,
            COUNT(*)::bigint AS count
     FROM applications
     ${whereSql}
     GROUP BY period, status
     ORDER BY period ASC`,
    ...sqlParams,
  );

  const byPeriod = new Map<string, { period: string; draft: number; pending_review: number; approved: number; rejected: number; total: number }>();
  for (const r of rows) {
    const key = r.period.toISOString();
    if (!byPeriod.has(key)) {
      byPeriod.set(key, { period: key, draft: 0, pending_review: 0, approved: 0, rejected: 0, total: 0 });
    }
    const bucket = byPeriod.get(key)!;
    const count = Number(r.count);
    bucket[r.status] = count;
    bucket.total += count;
  }

  return NextResponse.json({
    granularity,
    total,
    statusCounts,
    approvalRate,
    benefitTypeCounts,
    series: [...byPeriod.values()],
  });
}
