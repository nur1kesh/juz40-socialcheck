import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/adminSession';

const GRANULARITIES = ['day', 'week', 'month'] as const;
type Granularity = (typeof GRANULARITIES)[number];

interface Row {
  period: Date;
  calls: bigint;
  total_tokens: bigint | null;
  cost_usd: number | null;
}

export async function GET(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Авторизация қажет' }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const granularityParam = params.get('granularity') ?? 'day';
  if (!GRANULARITIES.includes(granularityParam as Granularity)) {
    return NextResponse.json({ error: 'granularity дұрыс емес' }, { status: 400 });
  }
  const granularity = granularityParam as Granularity;

  const daysParam = Number(params.get('days') ?? '30');
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 730) : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // granularity is whitelist-checked above (never attacker-controlled SQL),
  // so it's safe to splice directly into date_trunc's first argument —
  // Prisma can't bind it as a query param there. created_at is stored as a
  // naive UTC timestamp (no tz in the column), so the double AT TIME ZONE
  // is the standard trick to bucket it by Almaty calendar day/week/month
  // instead of UTC's.
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT date_trunc('${granularity}', created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Almaty') AS period,
            COUNT(*)::bigint AS calls,
            COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
            COALESCE(SUM(cost_usd), 0)::float AS cost_usd
     FROM ai_usage_logs
     WHERE created_at >= $1
     GROUP BY period
     ORDER BY period ASC`,
    since,
  );

  return NextResponse.json({
    granularity,
    series: rows.map((r) => ({
      period: r.period.toISOString(),
      calls: Number(r.calls),
      totalTokens: Number(r.total_tokens ?? 0),
      costUsd: r.cost_usd ?? 0,
    })),
  });
}
