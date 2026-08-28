import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/adminSession';

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Авторизация қажет' }, { status: 401 });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [totals, last30Days, byModel, byKind, distinctApplications, applicationCostAgg] = await Promise.all([
    prisma.aiUsageLog.aggregate({
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true, costUsd: true },
    }),
    prisma.aiUsageLog.aggregate({
      where: { createdAt: { gte: thirtyDaysAgo } },
      _count: { _all: true },
      _sum: { totalTokens: true, costUsd: true },
    }),
    prisma.aiUsageLog.groupBy({
      by: ['model'],
      _count: { _all: true },
      _sum: { totalTokens: true, costUsd: true },
      orderBy: { _sum: { costUsd: 'desc' } },
    }),
    prisma.aiUsageLog.groupBy({
      by: ['kind'],
      _count: { _all: true },
      _sum: { totalTokens: true, costUsd: true },
    }),
    prisma.aiUsageLog.findMany({
      where: { applicationId: { not: null } },
      select: { applicationId: true },
      distinct: ['applicationId'],
    }),
    // Cost strictly attributable to applications (document OCR only) — used
    // for "cost per application", separate from the grand total which also
    // includes profile-screenshot calls that never get an applicationId.
    prisma.aiUsageLog.aggregate({
      where: { applicationId: { not: null } },
      _sum: { costUsd: true },
    }),
  ]);

  const totalCostUsd = totals._sum.costUsd ?? 0;
  const applicationCount = distinctApplications.length;
  const applicationAttributedCostUsd = applicationCostAgg._sum.costUsd ?? 0;

  return NextResponse.json({
    totals: {
      calls: totals._count._all,
      promptTokens: totals._sum.promptTokens ?? 0,
      completionTokens: totals._sum.completionTokens ?? 0,
      totalTokens: totals._sum.totalTokens ?? 0,
      costUsd: totalCostUsd,
    },
    last30Days: {
      calls: last30Days._count._all,
      totalTokens: last30Days._sum.totalTokens ?? 0,
      costUsd: last30Days._sum.costUsd ?? 0,
    },
    byModel: byModel.map((m) => ({
      model: m.model,
      calls: m._count._all,
      totalTokens: m._sum.totalTokens ?? 0,
      costUsd: m._sum.costUsd ?? 0,
    })),
    byKind: byKind.map((k) => ({
      kind: k.kind,
      calls: k._count._all,
      totalTokens: k._sum.totalTokens ?? 0,
      costUsd: k._sum.costUsd ?? 0,
    })),
    avgCostPerApplication: applicationCount > 0 ? applicationAttributedCostUsd / applicationCount : null,
    applicationCount,
  });
}
