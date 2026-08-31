import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { prisma } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/adminSession';
import { discountPercentFor } from '@/lib/discount';
import { discountLimitMonths } from '@/lib/discountLimit';
import { almatyLocalToUtc, formatAlmatyDateTime } from '@/lib/timezone';
import type { ApplicationStatus } from '@prisma/client';

const VALID_STATUSES: ApplicationStatus[] = ['draft', 'pending_review', 'approved', 'rejected'];

// Excel report fallback for an unknown discount limit (no document expiry
// date, no manual override) — requested explicitly so the sheet always has
// a concrete number to work with instead of a blank dash.
const DEFAULT_UNKNOWN_LIMIT_MONTHS = 7;

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

  const dateFrom = req.nextUrl.searchParams.get('dateFrom'); // YYYY-MM-DDTHH:mm, Almaty local
  const dateTo = req.nextUrl.searchParams.get('dateTo');
  const format = req.nextUrl.searchParams.get('format') ?? 'xlsx';
  const statusParam = req.nextUrl.searchParams.get('status');
  const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

  if (dateFrom && !DATETIME_LOCAL_RE.test(dateFrom)) {
    return NextResponse.json({ error: 'dateFrom форматы YYYY-MM-DDTHH:mm болуы керек' }, { status: 400 });
  }
  if (dateTo && !DATETIME_LOCAL_RE.test(dateTo)) {
    return NextResponse.json({ error: 'dateTo форматы YYYY-MM-DDTHH:mm болуы керек' }, { status: 400 });
  }
  if (statusParam && !VALID_STATUSES.includes(statusParam as ApplicationStatus)) {
    return NextResponse.json({ error: 'status мәні дұрыс емес' }, { status: 400 });
  }

  if (format !== 'xlsx' && format !== 'pf') {
    return NextResponse.json({ error: 'format мәні "xlsx" немесе "pf" болуы керек' }, { status: 400 });
  }

  const applications = await prisma.application.findMany({
    where: {
      // "Жіберілген" is what this report is for — submittedAt, not
      // createdAt (draft-creation time), so an application started on one
      // day and submitted on another lands in the right range's export,
      // and vice versa. Either end of the range can be omitted.
      ...((dateFrom || dateTo) && {
        submittedAt: {
          ...(dateFrom ? { gte: almatyLocalToUtc(dateFrom) } : {}),
          ...(dateTo ? { lte: almatyLocalToUtc(dateTo) } : {}),
        },
      }),
      // Drafts have no submittedAt (so a date-ranged filter already
      // excludes them), but an explicit status=draft request bypasses
      // that — and with no status filter at all ("Барлық статус") and no
      // date range either, nothing here excluded them otherwise. Same
      // exclusion the applications-list endpoint already applies, for the
      // same reason: an abandoned draft's PII (name/email/WhatsApp) has no
      // business in an admin's downloaded report.
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

  const workbook = new ExcelJS.Workbook();
  const filenamePrefix = format === 'pf' ? 'socialcheck-pf' : 'socialcheck';

  if (format === 'pf') {
    // "Excel ПФ" — a fixed external report format (see the reference
    // template this was built against): no header row, 4 columns
    // (email, a literal constant, discount %, discount limit in months).
    // One row per student — if the same student has multiple applications
    // in the selected range (e.g. a renewal), only their most recently
    // submitted one is kept, so the same email never appears twice.
    const latestByEmail = new Map<string, (typeof applications)[number]>();
    for (const a of applications) {
      const email = a.user.email;
      const existing = latestByEmail.get(email);
      if (!existing || (a.submittedAt?.getTime() ?? 0) > (existing.submittedAt?.getTime() ?? 0)) {
        latestByEmail.set(email, a);
      }
    }

    const sheet = workbook.addWorksheet('Өтінімдер');
    sheet.columns = [{ width: 26 }, { width: 22 }, { width: 12 }, { width: 18 }];

    for (const a of latestByEmail.values()) {
      const limit = a.manualLimitMonths ?? discountLimitMonths(a.documents);
      sheet.addRow([a.user.email, 'Барлық пәндер', discountPercentFor(a.benefitTypes), limit ?? DEFAULT_UNKNOWN_LIMIT_MONTHS]);
    }
  } else {
    const sheet = workbook.addWorksheet('Өтінімдер');
    sheet.columns = [
      { header: 'Дата және уақыт', key: 'date', width: 20 },
      { header: 'ФИО', key: 'fullName', width: 28 },
      { header: 'Email', key: 'email', width: 26 },
      { header: 'WhatsApp', key: 'whatsapp', width: 16 },
      { header: 'Әлеуметтік статус', key: 'benefit', width: 30 },
      { header: 'Жеңілдік %', key: 'discount', width: 12 },
      { header: 'Жеңілдік лимиті (ай)', key: 'limit', width: 18 },
      { header: 'Статус', key: 'status', width: 22 },
    ];

    for (const a of applications) {
      const limit = a.manualLimitMonths ?? discountLimitMonths(a.documents);
      sheet.addRow({
        date: a.submittedAt ? formatAlmatyDateTime(a.submittedAt) : '—',
        fullName: a.user.fullName,
        email: a.user.email,
        whatsapp: a.user.whatsapp,
        benefit: benefitLabels(a.benefitTypes),
        discount: `${discountPercentFor(a.benefitTypes)}%`,
        // discountLimitMonths returns null when no document has an expiry
        // date at all (nothing to bound the limit by) — the report needs a
        // concrete number rather than a blank dash here, so it falls back
        // to DEFAULT_UNKNOWN_LIMIT_MONTHS. This is a display-only
        // fallback: it doesn't get written back to the application, so
        // re-exporting later (once manualLimitMonths might be set, or a
        // document gets an expiry) reflects the real value again.
        limit: limit ?? DEFAULT_UNKNOWN_LIMIT_MONTHS,
        status: a.status,
      });
    }
    sheet.getRow(1).font = { bold: true };
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filenamePrefix}-${filenameStamp(dateFrom)}_${filenameStamp(dateTo)}.xlsx"`,
    },
  });
}

// "YYYY-MM-DDTHH:mm" -> "YYYYMMDDHHmm", filesystem-safe (no ":" or "T");
// an unset end of the range is labelled "barlyk" (Kazakh "all").
function filenameStamp(dateTimeLocal: string | null): string {
  return dateTimeLocal ? dateTimeLocal.replace(/[-T:]/g, '') : 'barlyk';
}
