import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { prisma } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/adminSession';
import { discountPercentFor } from '@/lib/discount';
import { discountLimitMonths } from '@/lib/discountLimit';
import { almatyDayBoundsUtc, formatAlmatyDate } from '@/lib/timezone';
import type { ApplicationStatus } from '@prisma/client';

const VALID_STATUSES: ApplicationStatus[] = ['draft', 'pending_review', 'approved', 'rejected'];

const BENEFIT_LABELS: Record<string, string> = {
  many_children_family: 'Көпбалалы отбасы',
  incomplete_family: 'Толық емес отбасы',
  disability: 'Мүгедектік жағдайы бар',
};

function benefitLabels(types: string[]): string {
  return types.map((t) => BENEFIT_LABELS[t] ?? t).join(', ');
}

export async function GET(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Авторизация қажет' }, { status: 401 });

  const date = req.nextUrl.searchParams.get('date'); // DD.MM.YYYY
  const format = req.nextUrl.searchParams.get('format') ?? 'xlsx';
  const statusParam = req.nextUrl.searchParams.get('status');

  if (!date || !/^\d{2}\.\d{2}\.\d{4}$/.test(date)) {
    return NextResponse.json({ error: 'date форматы DD.MM.YYYY болуы керек' }, { status: 400 });
  }
  if (statusParam && !VALID_STATUSES.includes(statusParam as ApplicationStatus)) {
    return NextResponse.json({ error: 'status мәні дұрыс емес' }, { status: 400 });
  }

  const [dd, mm, yyyy] = date.split('.') as [string, string, string];
  const { start, end } = almatyDayBoundsUtc(dd, mm, yyyy);

  const applications = await prisma.application.findMany({
    where: {
      // "Жіберілген" is what this report is for — submittedAt, not
      // createdAt (draft-creation time), so an application started on one
      // day and submitted on another lands in the right day's export, and
      // vice versa.
      submittedAt: { gte: start, lte: end },
      // Drafts have no submittedAt (so a date-ranged filter already
      // excludes them), but an explicit status=draft request bypasses
      // that — and with no status filter at all ("Барлық статус"),
      // nothing here excluded them otherwise. Same exclusion the
      // applications-list endpoint already applies, for the same reason:
      // an abandoned draft's PII (name/email/WhatsApp) has no business in
      // an admin's downloaded report.
      status: statusParam ? (statusParam as ApplicationStatus) : { not: 'draft' },
    },
    include: {
      user: true,
      documents: {
        select: { documentType: true, documentExpiryDate: true, ocrStatus: true, verificationStatus: true },
      },
    },
    orderBy: { submittedAt: 'asc' },
  });

  if (format === 'json') {
    return NextResponse.json({
      date,
      count: applications.length,
      applications: applications.map((a) => ({
        date: a.submittedAt?.toISOString() ?? null,
        fullName: a.user.fullName,
        email: a.user.email,
        whatsapp: a.user.whatsapp,
        benefitTypes: a.benefitTypes,
        discountPercent: discountPercentFor(a.benefitTypes),
        discountLimitMonths: discountLimitMonths(a.documents),
        status: a.status,
      })),
    });
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Өтінімдер');
  sheet.columns = [
    { header: 'Дата', key: 'date', width: 12 },
    { header: 'ФИО', key: 'fullName', width: 28 },
    { header: 'Email', key: 'email', width: 26 },
    { header: 'WhatsApp', key: 'whatsapp', width: 16 },
    { header: 'Әлеуметтік статус', key: 'benefit', width: 30 },
    { header: 'Жеңілдік %', key: 'discount', width: 12 },
    { header: 'Жеңілдік лимиті (ай)', key: 'limit', width: 18 },
    { header: 'Статус', key: 'status', width: 22 },
  ];

  for (const a of applications) {
    const limit = discountLimitMonths(a.documents);
    sheet.addRow({
      date: a.submittedAt ? formatAlmatyDate(a.submittedAt) : '—',
      fullName: a.user.fullName,
      email: a.user.email,
      whatsapp: a.user.whatsapp,
      benefit: benefitLabels(a.benefitTypes),
      discount: `${discountPercentFor(a.benefitTypes)}%`,
      limit: limit ?? '—',
      status: a.status,
    });
  }
  sheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="socialcheck-${dd}${mm}${yyyy}.xlsx"`,
    },
  });
}
